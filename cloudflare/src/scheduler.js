import { leadHunterConfig } from "./lead-hunter.js";
import { ensureLeadSchema } from "./leads.js";
import { isPublishingWindow, saoPauloDay } from "./publishing-policy.js";

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function agentCoreConfig(client) {
  const config = client?.config && typeof client.config === "object" ? client.config : {};
  const current = config.agentCore && typeof config.agentCore === "object" ? config.agentCore : {};
  const autonomousClient = ["ragnar-one", "globalplay-streaming"].includes(String(client?.id || ""));
  const autoPublish = current.autoPublish === undefined ? autonomousClient : current.autoPublish === true;
  const modules = {
    radar: current.modules?.radar !== false,
    estrategista: current.modules?.estrategista !== false,
    pesquisador: current.modules?.pesquisador !== false,
    analista: current.modules?.analista !== false,
    creator: current.modules?.creator !== false,
    "copy-chief": current.modules?.["copy-chief"] !== false,
    designer: current.modules?.designer !== false,
    video: current.modules?.video !== false,
    publisher: current.modules?.publisher !== false,
    odin: current.modules?.odin !== false,
    suporte: current.modules?.suporte !== false,
    auditor: current.modules?.auditor !== false,
    growth: current.modules?.growth !== false
  };
  return {
    enabled: current.enabled !== false,
    autoPublish,
    approvalRequired: autoPublish ? current.approvalRequired === true : true,
    cycleMinutes: Math.max(15, Math.min(1440, Number(current.cycleMinutes || 30))),
    modules
  };
}

function rowClient(row) {
  return {
    id: String(row.id || ""),
    name: String(row.name || ""),
    niche: String(row.niche || ""),
    instagram: String(row.instagram || ""),
    status: String(row.status || "online"),
    config: parseJson(row.config_json, {})
  };
}

function minuteBucket(date) {
  return new Date(Math.floor(date.getTime() / 60000) * 60000).toISOString();
}

function due(lastIso, intervalMinutes, nowMs) {
  const last = lastIso ? new Date(lastIso).getTime() : 0;
  if (!Number.isFinite(last) || last <= 0) return true;
  return nowMs - last >= intervalMinutes * 60000;
}

function saoPauloDayRange(now) {
  const day = saoPauloDay(now);
  const [y,m,d] = day.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function queueTimestamp(previousIso, now, enqueued) {
  if (!enqueued) return previousIso || null;
  const value = now instanceof Date ? now : new Date(now);
  return Number.isFinite(value.getTime()) ? value.toISOString() : (previousIso || null);
}

async function schedulerState(env, clientId) {
  const row = await env.DB.prepare(
    `SELECT value_json FROM nexus_state
     WHERE namespace = 'agent-core' AND item_key = 'scheduler' AND client_id = ?1
     LIMIT 1`
  ).bind(clientId).first();
  return row ? parseJson(row.value_json, {}) : {};
}

async function saveSchedulerState(env, clientId, value) {
  await env.DB.prepare(
    `INSERT INTO nexus_state(namespace, item_key, client_id, value_json, updated_at)
     VALUES('agent-core', 'scheduler', ?1, ?2, CURRENT_TIMESTAMP)
     ON CONFLICT(namespace, item_key, client_id) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(clientId, JSON.stringify(value)).run();
}

export async function enqueue(env, clientId, kind, dueAt, payload = {}) {
  const pending = await env.DB.prepare(
    `SELECT id FROM scheduled_jobs
     WHERE client_id = ?1 AND kind = ?2 AND status IN ('scheduled','running')
     LIMIT 1`
  ).bind(clientId, kind).first();
  if (pending) return false;

  const bucket = minuteBucket(new Date(dueAt));
  const id = [kind, clientId, bucket].join(":");
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO scheduled_jobs(
       id, client_id, kind, due_at, status, attempts, payload_json, created_at, updated_at
     ) VALUES(?1, ?2, ?3, ?4, 'scheduled', 0, ?5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(id, clientId, kind, new Date(dueAt).toISOString(), JSON.stringify(payload)).run();
  return Number(result?.meta?.changes || 0) > 0;
}

export function schedulerErrorCode(error) {
  const raw = String(error?.message || error || "").toLowerCase();
  if (/no such (table|column)|has no column|schema/.test(raw)) return "d1_schema_error";
  if (/d1|sqlite|database|query/.test(raw)) return "d1_query_error";
  if (/timeout|timed out/.test(raw)) return "scheduler_timeout";
  if (/subrequest|too many requests|rate limit/.test(raw)) return "scheduler_resource_limit";
  return "scheduler_tick_error";
}

async function writeHeartbeat(env, now, summary) {
  await env.DB.prepare(
    `INSERT INTO nexus_state(namespace, item_key, client_id, value_json, updated_at)
     VALUES('scheduler', 'heartbeat', '', ?1, CURRENT_TIMESTAMP)
     ON CONFLICT(namespace, item_key, client_id) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(JSON.stringify({
    runtime: "cloudflare-cron",
    at: now.toISOString(),
    ...summary
  })).run();
}

export async function recordSchedulerFailure(env, scheduledAt, error) {
  const now = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt || Date.now());
  const code = schedulerErrorCode(error);
  await writeHeartbeat(env, now, {
    clients: 0,
    queued: 0,
    cycles: 0,
    publisherSweeps: 0,
    leadHunterRuns: 0,
    failed: true,
    errorCode: code
  });
  return code;
}

export async function runSchedulerTick(env, scheduledAt = new Date()) {
  const now = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt || Date.now());
  const nowMs = now.getTime();
  const rows = await env.DB.prepare(
    `SELECT id, name, niche, instagram, status, config_json FROM clients
     WHERE status = 'online' ORDER BY id`
  ).all();

  const summary = {
    clients: 0,
    queued: 0,
    cycles: 0,
    publisherSweeps: 0,
    leadHunterRuns: 0
  };

  for (const raw of rows?.results || []) {
    const client = rowClient(raw);
    const config = agentCoreConfig(client);
    if (!config.enabled) continue;
    summary.clients += 1;

    const state = await schedulerState(env, client.id);
    const next = { ...state };

    const expired = await env.DB.prepare(
      `UPDATE post_ledger
       SET status='expired',error='stale_ready_expired',updated_at=CURRENT_TIMESTAMP
       WHERE client_id=?1
         AND status IN ('ready','scheduled','failed')
         AND scheduled_for IS NOT NULL
         AND scheduled_for<=?2
         AND created_at<datetime(?2,'-24 hours')`
    ).bind(client.id,now.toISOString()).run();
    next.expiredStaleDrafts = Number(expired?.meta?.changes || 0);

    let cycleIsDue = due(state.lastCycleQueuedAt, config.cycleMinutes, nowMs);

    // OpenAI strategy refreshes once per Sao Paulo day, or immediately after
    // an explicit event invalidation (for example a new HOT lead).
    const aiState = await env.DB.prepare(
      `SELECT
         json_extract(CASE WHEN json_valid(value_json) THEN value_json ELSE '{}' END,'$.aiGrowth.dayKey') AS day_key,
         json_extract(CASE WHEN json_valid(value_json) THEN value_json ELSE '{}' END,'$.aiGrowth.generatedAt') AS generated_at,
         json_extract(CASE WHEN json_valid(value_json) THEN value_json ELSE '{}' END,'$.aiGrowthInvalidation.reason') AS invalidation_reason
       FROM nexus_state
       WHERE namespace='agent-core' AND item_key='state' AND client_id=?1
       LIMIT 1`
    ).bind(client.id).first();
    const aiInvalidated=Boolean(String(aiState?.invalidation_reason||"").trim());
    if (String(aiState?.day_key||"")!==saoPauloDay(now) || aiInvalidated) {
      cycleIsDue = true;
      next.aiRefreshDue = true;
      next.aiRefreshReason = aiInvalidated ? "event_invalidation" : "new_local_day";
    } else {
      next.aiRefreshDue = false;
      next.aiRefreshReason = "";
      next.lastAiGrowthAt = aiState?.generated_at || null;
    }

    if (["ragnar-one", "globalplay-streaming"].includes(client.id)) {
      const dayRange = saoPauloDayRange(now);
      const publishedToday = await env.DB.prepare(
        `SELECT COUNT(*) AS published_count,
                MAX(COALESCE(
                  json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.publishedAt'),
                  updated_at, scheduled_for, created_at
                )) AS last_published_at
         FROM post_ledger
         WHERE client_id=?1 AND status='published'
           AND updated_at>=?2 AND updated_at<?3`
      ).bind(client.id, dayRange.start, dayRange.end).first();
      const publishedCount = Math.max(0, Number(publishedToday?.published_count || 0));
      const lastPublishedMs = Date.parse(String(publishedToday?.last_published_at || ""));
      const spacingReady = publishedCount === 0
        || (Number.isFinite(lastPublishedMs) && nowMs - lastPublishedMs >= 90 * 60 * 1000);
      const recoveryIntervalMinutes = Math.min(config.cycleMinutes, 15);

      // Three posts/day is the target, while RADAR still chooses the preferred
      // windows. If the account is behind and the last publication is at least
      // 90 minutes old, run a bounded catch-up cycle instead of waiting until
      // tomorrow. The 15-minute recovery throttle prevents token/cron storms.
      const inPublishingWindow = isPublishingWindow(now);
      if (publishedCount < 3 && spacingReady && inPublishingWindow
        && due(state.lastCycleQueuedAt, recoveryIntervalMinutes, nowMs)) {
        cycleIsDue = true;
      }
      next.publishedToday = publishedCount;
      next.lastPublishedAt = Number.isFinite(lastPublishedMs)
        ? new Date(lastPublishedMs).toISOString() : null;

      // Reliable catch-up: when the account is below the daily target and the
      // last post is sufficiently spaced, pull forward exactly one already
      // approved creative. Normal days still use RADAR's adaptive schedule;
      // this path only prevents a silent day when the queue has valid content.
      if (publishedCount < 3 && spacingReady && inPublishingWindow) {
        const dueReady = await env.DB.prepare(
          `SELECT id FROM post_ledger
           WHERE client_id=?1
             AND status IN ('ready','scheduled','failed')
             AND approval_status='approved'
             AND scheduled_for<=?2
             AND date(scheduled_for,'-3 hours')=date(?2,'-3 hours')
             AND COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.retryCount'),0)<3
             AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.copyChief')='approved'
             AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.designer')='approved'
             AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.visualReview.status')='approved'
             AND COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.imageUrl'),'')<>''
           LIMIT 1`
        ).bind(client.id, now.toISOString()).first();

        if (!dueReady) {
          const promoted = await env.DB.prepare(
            `SELECT id,payload_json FROM post_ledger
             WHERE client_id=?1
               AND status IN ('ready','scheduled','failed')
               AND approval_status='approved'
               AND scheduled_for>?2
               AND date(scheduled_for,'-3 hours')=date(?2,'-3 hours')
               AND COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.retryCount'),0)<3
               AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.copyChief')='approved'
               AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.designer')='approved'
               AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.visualReview.status')='approved'
               AND COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.imageUrl'),'')<>''
             ORDER BY scheduled_for ASC
             LIMIT 1`
          ).bind(client.id, now.toISOString()).first();

          if (promoted?.id) {
            let payload = {};
            try { payload = JSON.parse(String(promoted.payload_json || "{}")); } catch {}
            payload.scheduledRecoveryAt = now.toISOString();
            payload.scheduledRecoveryReason = "daily_target_catch_up";
            await env.DB.prepare(
              "UPDATE post_ledger SET scheduled_for=?2,payload_json=?3,error='',updated_at=CURRENT_TIMESTAMP WHERE id=?1"
            ).bind(promoted.id, now.toISOString(), JSON.stringify(payload)).run();
            next.lastCatchUpPromotedAt = now.toISOString();
            next.lastCatchUpPostId = String(promoted.id);
          }
        }
      }
    }

    const hunterConfig = await leadHunterConfig(env, client);
    let lastHunterAt = null;
    if (hunterConfig.enabled && hunterConfig.autoRun) {
      await ensureLeadSchema(env);
      const lastHunter = await env.DB.prepare(
        "SELECT finished_at FROM lead_hunter_runs WHERE client_id = ?1 ORDER BY COALESCE(finished_at, created_at) DESC LIMIT 1"
      ).bind(client.id).first();
      lastHunterAt = lastHunter?.finished_at || null;
      if (due(lastHunterAt || state.lastHunterQueuedAt, hunterConfig.scanIntervalMinutes, nowMs)) {
        const hunterQueued = await enqueue(env, client.id, "lead-hunter", now, { trigger: "scheduler" });
        if (hunterQueued) {
          summary.queued += 1;
          summary.leadHunterRuns += 1;
        }
        next.lastHunterQueuedAt = queueTimestamp(state.lastHunterQueuedAt, now, hunterQueued);
      }
    } else {
      await env.DB.prepare(
        `UPDATE scheduled_jobs SET status='failed', last_error='lead_hunter_automatic_disabled', updated_at=CURRENT_TIMESTAMP
         WHERE client_id=?1 AND kind='lead-hunter' AND status IN ('scheduled','running')`
      ).bind(client.id).run();
    }

    // Missing/duplicate media is owned by CREATOR. It now generates a fresh
    // original image through the configured OpenAI image tool. Do not inject
    // owner-pinned fallback artwork here, because that recreates the same feed.
    const needsFreshMedia = await env.DB.prepare(
      `SELECT id FROM post_ledger
       WHERE client_id=?1
         AND status IN ('ready','scheduled','failed')
         AND approval_status='approved'
         AND scheduled_for<=?2
         AND date(scheduled_for,'-3 hours')=date(?2,'-3 hours')
         AND error IN ('media_generation_required','duplicate_media_blocked','duplicate_media_content_blocked')
       LIMIT 1`
    ).bind(client.id,now.toISOString()).first();
    if (needsFreshMedia?.id) cycleIsDue = true;

    // A slow full cycle must not suppress publishing content that already
    // passed both quality gates. Queue the sweep independently.
    if (config.modules.publisher
      && (!["globalplay-streaming","ragnar-one"].includes(client.id) || isPublishingWindow(now))
      && due(state.lastPublisherQueuedAt, 1, nowMs)) {
      // Self-heal a stale Designer flag only when the actual image has already
      // passed visual-review-v3 for the exact same media URL. This does not
      // bypass review; it repairs a gate that was left pending after recovery.
      if (["ragnar-one", "globalplay-streaming"].includes(client.id)) {
        const staleGate = await env.DB.prepare(
          `SELECT id,payload_json FROM post_ledger
           WHERE client_id=?1
             AND status IN ('ready','scheduled','failed')
             AND approval_status='approved'
             AND scheduled_for<=?2
             AND date(scheduled_for,'-3 hours')=date(?2,'-3 hours')
             AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.copyChief')='approved'
             AND COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.designer'),'pending')<>'approved'
             AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.visualReview.version')='visual-review-v3'
             AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.visualReview.status')='approved'
             AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.visualReview.media')
                 = json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.imageUrl')
             AND COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.imageUrl'),'')<>''
           ORDER BY scheduled_for ASC LIMIT 1`
        ).bind(client.id, now.toISOString()).first();

        if (staleGate?.id) {
          let payload = {};
          try { payload = JSON.parse(String(staleGate.payload_json || "{}")); } catch {}
          payload.qualityGates = {
            ...(payload.qualityGates || {}),
            designer: "approved",
            designerAt: now.toISOString()
          };
          payload.designerGateRecoveredAt = now.toISOString();
          await env.DB.prepare(
            "UPDATE post_ledger SET payload_json=?2,error='',updated_at=CURRENT_TIMESTAMP WHERE id=?1"
          ).bind(staleGate.id, JSON.stringify(payload)).run();
        }
      }

      const ready = await env.DB.prepare(
        `SELECT id FROM post_ledger WHERE client_id=?1
         AND status IN ('ready','scheduled','failed') AND approval_status='approved'
         AND scheduled_for<=?2
         AND date(scheduled_for,'-3 hours')=date(?2,'-3 hours')
         AND COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.retryCount'),0)<3
         AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.copyChief')='approved'
         AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.designer')='approved'
         AND COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.imageUrl'),'')<>''
         LIMIT 1`
      ).bind(client.id, now.toISOString()).first();
      const publisherQueued = ready
        ? await enqueue(env, client.id, "publisher-sweep", now, { trigger: "scheduler" })
        : false;
      if (publisherQueued) {
        summary.queued += 1;
        summary.publisherSweeps += 1;
      }
      next.lastPublisherQueuedAt = queueTimestamp(state.lastPublisherQueuedAt, now, publisherQueued);
    }

    if (cycleIsDue) {
      const cycleQueued = await enqueue(env, client.id, "agent-core-cycle", now, {
        trigger: "scheduler",
        agent: "all"
      });
      if (cycleQueued) {
        summary.queued += 1;
        summary.cycles += 1;
      }
      next.lastCycleQueuedAt = queueTimestamp(state.lastCycleQueuedAt, now, cycleQueued);
    }

    next.lastCronAt = now.toISOString();
    next.runtime = "cloudflare";
    await saveSchedulerState(env, client.id, next);
  }

  await writeHeartbeat(env, now, summary);
  return summary;
}
