import { listClients } from "./clients.js";

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

let schemaReady = false;

export async function ensureLeadSchema(env) {
  if (schemaReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      instagram_username TEXT,
      instagram_user_id TEXT,
      temperature TEXT NOT NULL DEFAULT 'cold',
      score INTEGER NOT NULL DEFAULT 0,
      stage TEXT NOT NULL DEFAULT 'new',
      intent TEXT,
      needs_human INTEGER NOT NULL DEFAULT 0,
      last_message TEXT,
      last_contact_at TEXT,
      source TEXT,
      source_url TEXT,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS lead_hunter_runs (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'success',
      started_at TEXT,
      finished_at TEXT,
      analyzed INTEGER NOT NULL DEFAULT 0,
      new_leads INTEGER NOT NULL DEFAULT 0,
      updated_leads INTEGER NOT NULL DEFAULT 0,
      ignored INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      cost_usd REAL NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_leads_client_updated ON leads(client_id, updated_at)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_leads_client_score ON leads(client_id, score DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_lead_runs_client_finished ON lead_hunter_runs(client_id, finished_at)").run();
  schemaReady = true;
}

function leadView(row, client = null) {
  const payload = parseJson(row.payload_json, {});
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: client?.name || payload.clientName || row.client_id,
    instagram: client?.instagram || payload.instagram || "",
    instagramUsername: row.instagram_username || "",
    instagramUserId: row.instagram_user_id || "",
    temperature: row.temperature || "cold",
    score: Number(row.score || 0),
    stage: row.stage || "new",
    intent: row.intent || "",
    needsHuman: Number(row.needs_human || 0) === 1,
    lastMessage: row.last_message || "",
    lastContactAt: row.last_contact_at || null,
    updatedAt: row.updated_at || null,
    source: row.source || "",
    sourceUrl: row.source_url || "",
    evidenceCount: Number(row.evidence_count || 0),
    ...payload
  };
}

export async function leadsForClient(env, clientId, limit = 200) {
  await ensureLeadSchema(env);
  const result = await env.DB.prepare(
    `SELECT * FROM leads
     WHERE client_id = ?1
     ORDER BY score DESC, updated_at DESC
     LIMIT ?2`
  ).bind(String(clientId), Math.max(1, Math.min(1000, Number(limit || 200)))).all();
  return (result?.results || []).map(row => leadView(row));
}

export function summarizeLeads(leads = []) {
  return leads.reduce((acc, lead) => {
    acc.total += 1;
    const temp = ["hot","warm","cold"].includes(String(lead.temperature)) ? String(lead.temperature) : "cold";
    acc[temp] += 1;
    if (lead.needsHuman) acc.needsHuman += 1;
    return acc;
  }, { total: 0, hot: 0, warm: 0, cold: 0, needsHuman: 0 });
}

export async function leadHunterSummary(env, clientId) {
  await ensureLeadSchema(env);
  const leads = await leadsForClient(env, clientId, 1000);
  const last = await env.DB.prepare(
    `SELECT * FROM lead_hunter_runs
     WHERE client_id = ?1 ORDER BY COALESCE(finished_at, created_at) DESC LIMIT 1`
  ).bind(String(clientId)).first();
  const payload = last ? parseJson(last.payload_json, {}) : {};
  return {
    ...summarizeLeads(leads),
    lastRunAt: last?.finished_at || null,
    lastRunStatus: last?.status || "idle",
    lastAnalyzed: Number(last?.analyzed || 0),
    lastNew: Number(last?.new_leads || 0),
    lastUpdated: Number(last?.updated_leads || 0),
    lastSources: payload.sources || {},
    lastErrors: Array.isArray(payload.errors) ? payload.errors : []
  };
}

export async function masterLeadSummary(env) {
  await ensureLeadSchema(env);
  const clients = await listClients(env);
  const clientMap = new Map(clients.map(client => [client.id, client]));
  const result = await env.DB.prepare(
    `SELECT * FROM leads ORDER BY updated_at DESC LIMIT 1000`
  ).all();
  const leads = (result?.results || []).map(row => leadView(row, clientMap.get(row.client_id)));
  const summary = summarizeLeads(leads);
  const byClient = [];
  for (const client of clients) {
    const own = leads.filter(lead => lead.clientId === client.id);
    byClient.push({
      clientId: client.id,
      clientName: client.name || client.id,
      instagram: client.instagram || "",
      source: "cloudflare-d1",
      ...summarizeLeads(own)
    });
  }
  return { summary, byClient, leads };
}

export async function upsertLead(env, client, lead) {
  await ensureLeadSchema(env);
  const username = String(lead.instagramUsername || "").replace(/^@/, "").trim();
  const external = String(lead.instagramUserId || "").trim();
  const id = String(lead.id || (client.id + ":" + (external || username || crypto.randomUUID())));
  const payload = {
    clientName: client.name || client.id,
    instagram: client.instagram || "",
    sources: Array.isArray(lead.sources) ? lead.sources : [],
    evidence: Array.isArray(lead.evidence) ? lead.evidence.slice(-20) : []
  };
  await env.DB.prepare(
    `INSERT INTO leads(
       id, client_id, instagram_username, instagram_user_id, temperature, score,
       stage, intent, needs_human, last_message, last_contact_at, source,
       source_url, evidence_count, payload_json, created_at, updated_at
     ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       instagram_username=excluded.instagram_username,
       instagram_user_id=excluded.instagram_user_id,
       temperature=excluded.temperature,
       score=excluded.score,
       stage=excluded.stage,
       intent=excluded.intent,
       needs_human=excluded.needs_human,
       last_message=excluded.last_message,
       last_contact_at=excluded.last_contact_at,
       source=excluded.source,
       source_url=excluded.source_url,
       evidence_count=excluded.evidence_count,
       payload_json=excluded.payload_json,
       updated_at=CURRENT_TIMESTAMP`
  ).bind(
    id, client.id, username, external,
    ["hot","warm","cold"].includes(String(lead.temperature)) ? String(lead.temperature) : "cold",
    Math.max(0, Math.min(100, Number(lead.score || 0))),
    String(lead.stage || "new").slice(0,80),
    String(lead.intent || "").slice(0,300),
    lead.needsHuman ? 1 : 0,
    String(lead.lastMessage || "").slice(0,1000),
    lead.lastContactAt || new Date().toISOString(),
    String(lead.source || "").slice(0,100),
    String(lead.sourceUrl || "").slice(0,1000),
    Math.max(0, Number(lead.evidenceCount || payload.evidence.length)),
    JSON.stringify(payload)
  ).run();
  return id;
}
