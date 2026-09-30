import { autonomyOverallHealthy } from "./health-policy.js";

export const EXPECTED_AUTONOMY_AGENTS = Object.freeze([
  "RADAR","ESTRATEGISTA","PESQUISADOR","ANALISTA","CREATOR","COPY CHIEF",
  "DESIGNER","VIDEO","PUBLISHER","ODIN","SUPORTE","AUDITOR","GROWTH"
]);

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function moduleKey(agent) {
  return String(agent || "").toLowerCase();
}

export function summarizeClientState(client, stateRow, now = Date.now()) {
  const state = parseJson(stateRow?.value_json, {});
  const modules = state?.modules && typeof state.modules === "object" ? state.modules : {};
  const agents = EXPECTED_AUTONOMY_AGENTS.map(agent => {
    const entry = modules[moduleKey(agent)] || {};
    const lastRunAt = entry.lastExecutionAt || null;
    const ageMinutes = lastRunAt && Number.isFinite(Date.parse(lastRunAt))
      ? Math.max(0, Math.round((now - Date.parse(lastRunAt)) / 60000))
      : null;
    return {
      agent,
      status: String(entry.status || "never"),
      lastRunAt,
      ageMinutes
    };
  });
  const missingAgents = agents.filter(item => item.status === "never").map(item => item.agent);
  const nextCycleMs = Date.parse(String(state?.nextCycleAt || ""));
  const delayed = Number.isFinite(nextCycleMs) && now - nextCycleMs > 5 * 60 * 1000;
  return {
    status: String(client?.status || "online"),
    agents,
    allAgentsSeen: missingAgents.length === 0,
    missingAgents,
    instagramConnection: {
      connected: null,
      tokenValid: null,
      accountMatches: null,
      validation: "not_checked_public"
    },
    cycleHealth: {
      status: String(state?.lastCycleStatus || "unknown"),
      delayed,
      stage: String(state?.lastCycleStage || "unknown"),
      errorCode: (() => {
        const raw = String(state?.lastCycleError || "").trim();
        if (!raw) return "";
        return /^[a-z_0-9:-]+$/i.test(raw) ? raw.slice(0, 120) : "cycle_execution_error";
      })()
    }
  };
}

export async function buildAutonomyHealthSummary(env, now = Date.now()) {
  const [heartbeatRow, clientsResult, statesResult] = await Promise.all([
    env.DB.prepare(
      "SELECT value_json,updated_at FROM nexus_state WHERE namespace='scheduler' AND item_key='heartbeat' AND client_id='' LIMIT 1"
    ).first(),
    env.DB.prepare(
      "SELECT id,status FROM clients WHERE status='online' ORDER BY id"
    ).all(),
    env.DB.prepare(
      "SELECT client_id,value_json,updated_at FROM nexus_state WHERE namespace='agent-core' AND item_key='state'"
    ).all()
  ]);

  const heartbeat = parseJson(heartbeatRow?.value_json, {});
  const heartbeatMs = Date.parse(String(heartbeatRow?.updated_at || heartbeat?.at || ""));
  const heartbeatAgeSeconds = Number.isFinite(heartbeatMs)
    ? Math.max(0, Math.round((now - heartbeatMs) / 1000))
    : null;
  const schedulerHealthy = heartbeatAgeSeconds !== null
    && heartbeatAgeSeconds <= 180
    && heartbeat?.failed !== true;

  const states = new Map((statesResult?.results || []).map(row => [String(row.client_id), row]));
  const clients = (clientsResult?.results || []).map(client =>
    summarizeClientState(client, states.get(String(client.id)), now)
  );

  return {
    ok: autonomyOverallHealthy({ schedulerHealthy, clients }),
    runtime: "cloudflare-workers",
    automationActive: String(env.CLOUDFLARE_AUTOMATION_ACTIVE || "").toLowerCase() === "true",
    expectedAgents: EXPECTED_AUTONOMY_AGENTS.length,
    instagramCentral: { configured: null, checked: false },
    scheduler: {
      healthy: schedulerHealthy,
      lastHeartbeatAt: heartbeatRow?.updated_at || heartbeat?.at || null,
      ageSeconds: heartbeatAgeSeconds,
      errorCode: String(heartbeat?.errorCode || ""),
      summary: {
        runtime: String(heartbeat?.runtime || "cloudflare-cron"),
        at: heartbeat?.at || null,
        clients: Number(heartbeat?.clients || 0),
        queued: Number(heartbeat?.queued || 0),
        cycles: Number(heartbeat?.cycles || 0),
        publisherSweeps: Number(heartbeat?.publisherSweeps || 0),
        leadHunterRuns: Number(heartbeat?.leadHunterRuns || 0),
        failed: heartbeat?.failed === true
      }
    },
    clients
  };
}
