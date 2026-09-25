import { leadHunterConfig } from "./lead-hunter.js";
import { ensureLeadSchema } from "./leads.js";

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
  const modules = {
    radar: current.modules?.radar !== false,
    estrategista: current.modules?.estrategista !== false,
    creator: current.modules?.creator !== false,
    publisher: current.modules?.publisher !== false,
    auditor: current.modules?.auditor !== false,
    odin: current.modules?.odin !== false
  };
  return {
    enabled: current.enabled !== false,
    autoPublish: current.autoPublish === true,
    approvalRequired: current.autoPublish === true ? current.approvalRequired === true : true,
    cycleMinutes: Math.max(15, Math.min(1440, Number(current.cycleMinutes || 60))),
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

async function enqueue(env, clientId, kind, dueAt, payload = {}) {
  const bucket = minuteBucket(new Date(dueAt));
  const id = [kind, clientId, bucket].join(":");
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO scheduled_jobs(
       id, client_id, kind, due_at, status, attempts, payload_json, created_at, updated_at
     ) VALUES(?1, ?2, ?3, ?4, 'scheduled', 0, ?5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(id, clientId, kind, new Date(dueAt).toISOString(), JSON.stringify(payload)).run();
  return Number(result?.meta?.changes || 0) > 0;
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


const LIVE_AGENT_TEST_TAG = "live-agent-test-20260925-1720";

async function queueOneTimeLiveAgentTests(env, now) {
  let queued = 0;
  for (const clientId of ["globalplay-streaming", "ragnar-one"]) {
    const id = LIVE_AGENT_TEST_TAG + ":" + clientId;
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO scheduled_jobs(
         id, client_id, kind, due_at, status, attempts, payload_json, created_at, updated_at
       )
       SELECT ?1, id, 'agent-core-cycle', ?2, 'scheduled', 0, ?3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       FROM clients WHERE id = ?4 LIMIT 1`
    ).bind(
      id,
      now.toISOString(),
      JSON.stringify({ trigger: "manual", agent: "all", testTag: LIVE_AGENT_TEST_TAG }),
      clientId
    ).run();
    queued += Number(result?.meta?.changes || 0);
  }
  return queued;
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
    leadHunterRuns: 0,
    liveTestsQueued: 0
  };

  summary.liveTestsQueued = await queueOneTimeLiveAgentTests(env, now);

  for (const raw of rows?.results || []) {
    const client = rowClient(raw);
    const config = agentCoreConfig(client);
    if (!config.enabled) continue;
    summary.clients += 1;

    const state = await schedulerState(env, client.id);
    const next = { ...state };
    const cycleIsDue = due(state.lastCycleQueuedAt, config.cycleMinutes, nowMs);

    const hunterConfig = await leadHunterConfig(env, client);
    let lastHunterAt = null;
    if (hunterConfig.enabled && hunterConfig.autoRun) {
      await ensureLeadSchema(env);
      const lastHunter = await env.DB.prepare(
        "SELECT finished_at FROM lead_hunter_runs WHERE client_id = ?1 ORDER BY COALESCE(finished_at, created_at) DESC LIMIT 1"
      ).bind(client.id).first();
      lastHunterAt = lastHunter?.finished_at || null;
      if (due(lastHunterAt || state.lastHunterQueuedAt, hunterConfig.scanIntervalMinutes, nowMs)) {
        if (await enqueue(env, client.id, "lead-hunter", now, { trigger: "scheduler" })) {
          summary.queued += 1;
          summary.leadHunterRuns += 1;
        }
        next.lastHunterQueuedAt = now.toISOString();
      }
    }

    if (cycleIsDue) {
      if (await enqueue(env, client.id, "agent-core-cycle", now, {
        trigger: "scheduler",
        agent: "all"
      })) {
        summary.queued += 1;
        summary.cycles += 1;
      }
      next.lastCycleQueuedAt = now.toISOString();
    } else if (config.modules.publisher && due(state.lastPublisherQueuedAt, 5, nowMs)) {
      if (await enqueue(env, client.id, "publisher-sweep", now, {
        trigger: "scheduler"
      })) {
        summary.queued += 1;
        summary.publisherSweeps += 1;
      }
      next.lastPublisherQueuedAt = now.toISOString();
    }

    next.lastCronAt = now.toISOString();
    next.runtime = "cloudflare";
    await saveSchedulerState(env, client.id, next);
  }

  await writeHeartbeat(env, now, summary);
  return summary;
}
