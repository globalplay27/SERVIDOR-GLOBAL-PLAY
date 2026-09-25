import { getClient, listClients, upsertClient } from "./clients.js";

export const AGENT_CORE_MODULES = Object.freeze([
  { id: "radar", name: "RADAR", skills: ["ig-viral","ig-audit","ig-profile","lead-hunter"] },
  { id: "estrategista", name: "ESTRATEGISTA", skills: ["ig-plan"] },
  { id: "creator", name: "CREATOR", skills: ["ig-reel","ig-caption","ig-carousel","ig-story","ig-repurpose"] },
  { id: "publisher", name: "PUBLISHER", skills: ["delivery","schedule","meta-publish"] },
  { id: "auditor", name: "AUDITOR", skills: ["ig-human","ig-audit"] },
  { id: "odin", name: "ODIN", skills: ["ig-comment","ig-reply","ig-dm","lead-scoring"] }
]);

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

export function normalizeAgentCoreConfig(client) {
  const config = client?.config && typeof client.config === "object" ? client.config : {};
  const current = config.agentCore && typeof config.agentCore === "object" ? config.agentCore : {};
  const autonomousClient = ["ragnar-one","globalplay-streaming"].includes(String(client?.id || ""));
  const autoPublish = current.autoPublish === undefined
    ? autonomousClient
    : current.autoPublish === true;
  const modules = {};
  for (const module of AGENT_CORE_MODULES) modules[module.id] = current.modules?.[module.id] !== false;
  return {
    enabled: current.enabled !== false,
    approvalRequired: autoPublish
      ? (current.approvalRequired === undefined ? false : current.approvalRequired === true)
      : true,
    autoPublish,
    cycleMinutes: Math.max(15, Math.min(1440, Number(current.cycleMinutes || 30))),
    modules
  };
}

export async function agentCoreState(env, clientId) {
  const row = await env.DB.prepare(
    `SELECT value_json, updated_at FROM nexus_state
     WHERE namespace = 'agent-core' AND item_key = 'state' AND client_id = ?1
     LIMIT 1`
  ).bind(String(clientId)).first();
  const value = row ? parseJson(row.value_json, {}) : {};
  return { ...value, updatedAt: row?.updated_at || value.updatedAt || null };
}

export async function patchAgentCoreState(env, clientId, patch = {}) {
  const current = await agentCoreState(env, clientId);
  const next = { ...current, ...(patch && typeof patch === "object" ? patch : {}), updatedAt: new Date().toISOString() };
  await env.DB.prepare(
    `INSERT INTO nexus_state(namespace, item_key, client_id, value_json, updated_at)
     VALUES('agent-core', 'state', ?1, ?2, CURRENT_TIMESTAMP)
     ON CONFLICT(namespace, item_key, client_id) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(String(clientId), JSON.stringify(next)).run();
  return next;
}

export async function agentExecutions(env, clientId, limit = 100) {
  const result = await env.DB.prepare(
    `SELECT id, client_id, agent, status, detail_json, created_at
     FROM agent_executions
     WHERE client_id = ?1
     ORDER BY created_at DESC
     LIMIT ?2`
  ).bind(String(clientId), Math.max(1, Math.min(500, Number(limit || 100)))).all();

  return (result?.results || []).map(row => {
    const detail = parseJson(row.detail_json, {});
    return {
      id: row.id,
      clientId: row.client_id,
      agent: row.agent,
      status: row.status,
      ...detail,
      createdAt: row.created_at || detail.finishedAt || detail.startedAt || null
    };
  });
}

export async function recordAgentExecution(env, client, agent, details = {}) {
  const finishedAt = details.finishedAt || new Date().toISOString();
  const startedAt = details.startedAt || finishedAt;
  const detail = {
    clientName: client?.name || client?.id || "",
    function: String(details.function || "cycle").slice(0, 120),
    trigger: String(details.trigger || "scheduler").slice(0, 80),
    model: String(details.model || "cloudflare-worker").slice(0, 120),
    quantity: Math.max(0, Number(details.quantity || 0)),
    costUsd: Math.max(0, Number(details.costUsd || 0)),
    message: String(details.message || "").slice(0, 1000),
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Number(details.durationMs || (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) || 0)),
    metadata: details.metadata && typeof details.metadata === "object" ? details.metadata : {}
  };
  const id = crypto.randomUUID();
  const status = ["success","warning","failed","blocked"].includes(String(details.status))
    ? String(details.status)
    : "success";

  await env.DB.prepare(
    `INSERT INTO agent_executions(id, client_id, agent, status, detail_json, created_at)
     VALUES(?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)`
  ).bind(id, String(client.id), String(agent || "").toUpperCase(), status, JSON.stringify(detail)).run();

  const state = await agentCoreState(env, client.id);
  const modules = state.modules && typeof state.modules === "object" ? { ...state.modules } : {};
  modules[String(agent || "").toLowerCase()] = {
    status,
    lastExecutionAt: finishedAt,
    message: detail.message
  };
  await patchAgentCoreState(env, client.id, { modules });
  return { id, clientId: client.id, agent: String(agent || "").toUpperCase(), status, ...detail };
}

export async function saveAgentCoreConfig(env, clientId, patch = {}) {
  const client = await getClient(env, clientId);
  if (!client) throw new Error("client_not_found");
  const current = normalizeAgentCoreConfig(client);
  const nextModules = { ...current.modules };
  if (patch.modules && typeof patch.modules === "object") {
    for (const module of AGENT_CORE_MODULES) {
      if (Object.prototype.hasOwnProperty.call(patch.modules, module.id)) {
        nextModules[module.id] = patch.modules[module.id] !== false;
      }
    }
  }
  const autoPublish = patch.autoPublish === undefined ? current.autoPublish : patch.autoPublish === true;
  const next = {
    enabled: patch.enabled === undefined ? current.enabled : patch.enabled !== false,
    autoPublish,
    approvalRequired: autoPublish
      ? (patch.approvalRequired === undefined ? current.approvalRequired : patch.approvalRequired === true)
      : true,
    cycleMinutes: Math.max(15, Math.min(1440, Number(patch.cycleMinutes || current.cycleMinutes || 60))),
    modules: nextModules
  };
  await upsertClient(env, {
    ...client,
    config: { ...client.config, agentCore: next }
  });
  return next;
}

export async function agentCoreClientView(env, client) {
  const [state, executions] = await Promise.all([
    agentCoreState(env, client.id),
    agentExecutions(env, client.id, 200)
  ]);
  return {
    clientId: client.id,
    clientName: client.name || client.id,
    config: normalizeAgentCoreConfig(client),
    state,
    lastExecutions: executions
  };
}

function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export async function agentCoreDashboard(env) {
  const clients = await listClients(env);
  const views = [];
  for (const client of clients) views.push(await agentCoreClientView(env, client));

  const all = await env.DB.prepare(
    `SELECT status, detail_json, created_at FROM agent_executions
     ORDER BY created_at DESC LIMIT 5000`
  ).all();
  const today = dayKey();
  const month = today.slice(0, 7);
  let totalExecutionsToday = 0;
  let totalCostTodayUsd = 0;
  let totalCostMonthUsd = 0;

  for (const row of all?.results || []) {
    const detail = parseJson(row.detail_json, {});
    const created = String(row.created_at || detail.finishedAt || detail.startedAt || "");
    const localDay = created ? dayKey(new Date(created)) : "";
    const cost = Math.max(0, Number(detail.costUsd || 0));
    if (localDay === today) {
      totalExecutionsToday += 1;
      totalCostTodayUsd += cost;
    }
    if (localDay.slice(0, 7) === month) totalCostMonthUsd += cost;
  }

  return {
    ok: true,
    modules: AGENT_CORE_MODULES,
    clients: views,
    totalExecutionsToday,
    totalCostTodayUsd,
    totalCostMonthUsd,
    runtime: "cloudflare-workers"
  };
}

export async function queueManualAgentRun(env, clientId, agent = "all") {
  const client = await getClient(env, clientId);
  if (!client) throw new Error("client_not_found");
  const requested = String(agent || "all").toLowerCase();
  if (requested !== "all" && !AGENT_CORE_MODULES.some(item => item.id === requested)) {
    throw new Error("invalid_agent");
  }
  const id = "manual:" + client.id + ":" + crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO scheduled_jobs(id, client_id, kind, due_at, status, attempts, payload_json, created_at, updated_at)
     VALUES(?1, ?2, 'agent-core-cycle', ?3, 'scheduled', 0, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(
    id,
    client.id,
    new Date().toISOString(),
    JSON.stringify({ trigger: "manual", agent: requested })
  ).run();

  return {
    ok: true,
    queued: true,
    jobId: id,
    clientId: client.id,
    agent: requested,
    mode: String(env.CLOUDFLARE_AUTOMATION_ACTIVE || "").toLowerCase() === "true" ? "active" : "shadow"
  };
}
