import { visualApproval } from "./visual-review.js";
import { publishInstagramImage } from "./publisher.js";
import { runLeadHunter, leadHunterConfig } from "./lead-hunter.js";
import { runAgentCoreCycle } from "./agent-runtime.js";
import { getClient } from "./clients.js";

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function automationEnabled(env) {
  return String(env.CLOUDFLARE_AUTOMATION_ACTIVE || "").toLowerCase() === "true";
}

const MAX_PUBLISH_RETRIES = 3;

const JOB_KIND_PRIORITY = Object.freeze({
  "publisher-sweep": 0,
  "agent-core-cycle": 1,
  "lead-hunter": 2
});

export function compareDueJobs(a = {}, b = {}) {
  const aDue = Date.parse(String(a.due_at || ""));
  const bDue = Date.parse(String(b.due_at || ""));
  const aTime = Number.isFinite(aDue) ? aDue : Number.MAX_SAFE_INTEGER;
  const bTime = Number.isFinite(bDue) ? bDue : Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;

  const aPriority = JOB_KIND_PRIORITY[String(a.kind || "")] ?? 99;
  const bPriority = JOB_KIND_PRIORITY[String(b.kind || "")] ?? 99;
  if (aPriority !== bPriority) return aPriority - bPriority;

  return String(a.id || "").localeCompare(String(b.id || ""));
}

function publishGuard(payload = {}, clientId) {
  const quality = payload?.qualityGates && typeof payload.qualityGates === "object"
    ? payload.qualityGates : {};
  const retryCount = Math.max(0, Number(payload?.retryCount || 0));
  if (quality.copyChief !== "approved" || quality.designer !== "approved" || !visualApproval(clientId, payload)) {
    return { ok: false, error: "quality_gate_pending", retryCount };
  }
  if (retryCount >= MAX_PUBLISH_RETRIES) {
    return { ok: false, error: "publish_retry_limit_reached", retryCount };
  }
  return { ok: true, error: "", retryCount };
}

async function duePosts(env, clientId, nowIso) {
  const result = await env.DB.prepare(
    `SELECT id, client_id, scheduled_for, status, approval_status, caption,
            image_object_key, payload_json
     FROM post_ledger
     WHERE client_id = ?1
       AND approval_status = 'approved'
       AND status IN ('ready', 'scheduled', 'failed')
       AND COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.retryCount'),0) < ${MAX_PUBLISH_RETRIES}
       AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.copyChief') = 'approved'
       AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.designer') = 'approved'
       AND scheduled_for IS NOT NULL
       AND scheduled_for <= ?2
     ORDER BY scheduled_for ASC
     LIMIT 8`
  ).bind(clientId, nowIso).all();
  return result?.results || [];
}

async function savePostResult(env, row, patch) {
  const current = parseJson(row.payload_json, {});
  const payload = {
    ...current,
    ...(patch.payload && typeof patch.payload === "object" ? patch.payload : {})
  };

  await env.DB.prepare(
    `UPDATE post_ledger
     SET status = ?2,
         media_id = ?3,
         error = ?4,
         payload_json = ?5,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1`
  ).bind(
    row.id,
    String(patch.status || row.status || "scheduled"),
    String(patch.mediaId || ""),
    String(patch.error || "").slice(0, 900),
    JSON.stringify(payload)
  ).run();
}

async function runPublisherSweep(env, clientId, now) {
  const rows = await duePosts(env, clientId, now.toISOString());
  const summary = { candidates: rows.length, published: 0, failed: 0, skipped: 0 };

  for (const row of rows) {
    const payload = parseJson(row.payload_json, {});
    const guard = publishGuard(payload, clientId);
    if (!guard.ok) {
      await savePostResult(env, row, { status: row.status, error: guard.error, payload });
      summary.skipped += 1;
      continue;
    }
    const imageUrl = String(payload.imageUrl || payload.publicImageUrl || "");
    if (!imageUrl || !row.caption) {
      summary.skipped += 1;
      continue;
    }

    try {
      await env.DB.prepare(
        "UPDATE post_ledger SET status = 'publishing', error = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?1"
      ).bind(row.id).run();

      const result = await publishInstagramImage(
        env,
        clientId,
        imageUrl,
        String(row.caption || "")
      );

      await savePostResult(env, row, {
        status: "published",
        mediaId: result.mediaId,
        payload: {
          ...payload,
          permalink: result.permalink || "",
          publishedAt: new Date().toISOString(),
          containerId: result.containerId || ""
        }
      });
      summary.published += 1;
    } catch (error) {
      const retries = Math.max(0, Number(payload.retryCount || 0)) + 1;
      await savePostResult(env, row, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        payload: {
          ...payload,
          retryCount: retries,
          lastPublishAttemptAt: new Date().toISOString()
        }
      });
      summary.failed += 1;
    }
  }
  return summary;
}

async function updateJob(env, id, status, attempts, lastError = "") {
  await env.DB.prepare(
    `UPDATE scheduled_jobs
     SET status = ?2, attempts = ?3, last_error = ?4, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1`
  ).bind(id, status, attempts, String(lastError || "").slice(0, 900)).run();
}

export async function processDueJobs(env, scheduledAt = new Date()) {
  const active = automationEnabled(env);
  const now = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt || Date.now());

  if (!active) {
    const shadowed = await env.DB.prepare(
      "UPDATE scheduled_jobs SET status = 'shadow', updated_at = CURRENT_TIMESTAMP WHERE status = 'scheduled' AND due_at <= ?1"
    ).bind(now.toISOString()).run();
    return {
      active: false,
      mode: "shadow",
      shadowed: Number(shadowed?.meta?.changes || 0),
      message: "Cloudflare automation is staged; due jobs are shadowed and cannot run after cutover."
    };
  }

  await env.DB.prepare(
    `UPDATE scheduled_jobs
     SET status='failed', last_error='stale_running_job_recovered', updated_at=CURRENT_TIMESTAMP
     WHERE status='running' AND updated_at < datetime('now','-10 minutes')`
  ).run();

  const result = await env.DB.prepare(
    `SELECT id, client_id, kind, due_at, status, attempts, payload_json
     FROM scheduled_jobs
     WHERE status = 'scheduled' AND due_at <= ?1
     ORDER BY due_at ASC
     LIMIT 12`
  ).bind(now.toISOString()).all();

  const summary = { active: true, processed: 0, completed: 0, failed: 0, deferred: 0 };

  const dueJobs = [...(result?.results || [])].sort(compareDueJobs).slice(0, 1);

  for (const job of dueJobs) {
    const attempts = Math.max(0, Number(job.attempts || 0)) + 1;
    await updateJob(env, job.id, "running", attempts);

    try {
      if (job.kind === "publisher-sweep") {
        await runAgentCoreCycle(env, job.client_id, {
          trigger: "publisher-sweep",
          agent: "publisher"
        });
        await updateJob(env, job.id, "completed", attempts);
        summary.completed += 1;
      } else if (job.kind === "lead-hunter") {
        const client = await getClient(env, job.client_id);
        const hunter = client ? await leadHunterConfig(env, client) : null;
        if (!hunter?.enabled || !hunter?.autoRun) {
          await updateJob(env, job.id, "failed", attempts, "lead_hunter_automatic_disabled");
          summary.deferred += 1;
        } else {
          await runLeadHunter(env, job.client_id, { trigger: "scheduler", automatic: true });
          await updateJob(env, job.id, "completed", attempts);
          summary.completed += 1;
        }
      } else if (job.kind === "agent-core-cycle") {
        const payload = parseJson(job.payload_json, {});
        await runAgentCoreCycle(env, job.client_id, {
          trigger: String(payload.trigger || "scheduler"),
          agent: String(payload.agent || "all")
        });
        await updateJob(env, job.id, "completed", attempts);
        summary.completed += 1;
      } else {
        await updateJob(env, job.id, "failed", attempts, "unsupported_job_kind");
        summary.failed += 1;
      }
    } catch (error) {
      await updateJob(
        env,
        job.id,
        attempts < 3 ? "scheduled" : "failed",
        attempts,
        error instanceof Error ? error.message : String(error)
      );
      summary.failed += 1;
    }
    summary.processed += 1;
  }

  return summary;
}
