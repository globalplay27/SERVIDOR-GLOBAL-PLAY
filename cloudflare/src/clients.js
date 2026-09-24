function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function rowToClient(row) {
  if (!row) return null;
  return {
    id: String(row.id || ""),
    name: String(row.name || ""),
    niche: row.niche ? String(row.niche) : "",
    instagram: row.instagram ? String(row.instagram) : "",
    status: String(row.status || "online"),
    config: parseJson(row.config_json, {}),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

export async function listClients(env) {
  const result = await env.DB.prepare(
    `SELECT id, name, niche, instagram, status, config_json, created_at, updated_at
     FROM clients
     ORDER BY name COLLATE NOCASE ASC`
  ).all();
  return (result?.results || []).map(rowToClient);
}

export async function getClient(env, clientId) {
  const row = await env.DB.prepare(
    `SELECT id, name, niche, instagram, status, config_json, created_at, updated_at
     FROM clients WHERE id = ?1 LIMIT 1`
  ).bind(String(clientId)).first();
  return rowToClient(row);
}

export async function upsertClient(env, client) {
  const id = String(client?.id || "").trim();
  const name = String(client?.name || "").trim();
  if (!id || !name) throw new Error("client_id_and_name_required");

  const existing = await getClient(env, id);
  const config = {
    ...(existing?.config || {}),
    ...(client?.config && typeof client.config === "object" ? client.config : {})
  };

  if (id === String(env.RAGNAR_CLIENT_ID || "ragnar-one")) {
    config.openaiKeySource = "ragnar-exclusive";
  } else {
    config.openaiKeySource = "shared";
  }
  config.runtime = "cloudflare";

  await env.DB.prepare(
    `INSERT INTO clients(id, name, niche, instagram, status, config_json, created_at, updated_at)
     VALUES(?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       niche = excluded.niche,
       instagram = excluded.instagram,
       status = excluded.status,
       config_json = excluded.config_json,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    id,
    name,
    String(client?.niche ?? existing?.niche ?? ""),
    String(client?.instagram ?? existing?.instagram ?? ""),
    String(client?.status ?? existing?.status ?? "online"),
    JSON.stringify(config)
  ).run();

  return getClient(env, id);
}


export function portalClientView(client) {
  if (!client) return null;
  const config = client.config && typeof client.config === "object" ? client.config : {};
  const postingProfile = config.postingProfile && typeof config.postingProfile === "object"
    ? config.postingProfile
    : {};
  const agentProfile = config.agentProfile && typeof config.agentProfile === "object"
    ? config.agentProfile
    : {};
  const agentCore = config.agentCore && typeof config.agentCore === "object"
    ? config.agentCore
    : {};
  return {
    id: client.id,
    name: client.name,
    niche: client.niche,
    instagram: client.instagram,
    status: client.status,
    theme: config.theme || "nexus",
    primaryColor: config.primaryColor || (client.id === "ragnar-one" ? "#19c563" : "#22c55e"),
    secondaryColor: config.secondaryColor || "#050807",
    odin: config.odin !== false,
    postTimes: Array.isArray(config.postTimes) ? config.postTimes : ["09:00", "12:00", "18:00"],
    leads: config.leads && typeof config.leads === "object"
      ? config.leads
      : { total: 0, hot: 0, warm: 0, cold: 0 },
    usage: config.usage && typeof config.usage === "object"
      ? config.usage
      : { openaiPercent: 0, railwayPercent: 0 },
    aiMode: client.id === "ragnar-one" ? "own-key" : "shared",
    aiMonthlyImageLimit: Number(config.aiMonthlyImageLimit || 0),
    aiImagesUsed: Number(config.aiImagesUsed || 0),
    managedInfrastructure: true,
    onboarding: config.onboarding && typeof config.onboarding === "object" ? config.onboarding : {},
    setupMode: config.setupMode || "ready",
    integrationState: config.integrationState && typeof config.integrationState === "object"
      ? config.integrationState
      : { github: "pending", railway: "migration", openai: "configured", meta: "pending" },
    postingProfile,
    agentProfile,
    agentCore,
    connections: config.connections && typeof config.connections === "object" ? config.connections : {}
  };
}
