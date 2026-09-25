import { decryptSecret } from "./secrets.js";

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function coreSecretPair(env, clientId) {
  const id = String(clientId || "");
  if (id === "ragnar-one") {
    return {
      accessToken: String(env.INSTAGRAM_ACCESS_TOKEN_RAGNAR || "").trim(),
      igUserId: String(env.INSTAGRAM_ACCOUNT_ID_RAGNAR || "").trim(),
      source: "cloudflare-secret"
    };
  }
  if (id === "globalplay-streaming") {
    return {
      accessToken: String(env.INSTAGRAM_ACCESS_TOKEN_GLOBALPLAY || "").trim(),
      igUserId: String(env.INSTAGRAM_ACCOUNT_ID_GLOBALPLAY || "").trim(),
      source: "cloudflare-secret"
    };
  }
  return { accessToken: "", igUserId: "", source: "" };
}

export async function resolveInstagramCredentials(env, clientId) {
  const core = coreSecretPair(env, clientId);
  if (core.accessToken && core.igUserId) {
    return {
      ...core,
      connected: true,
      expiresAt: null,
      expired: false,
      username: "",
      accountType: "",
      scopes: []
    };
  }

  const row = await env.DB.prepare(
    `SELECT provider, payload_json, connected_at, updated_at
     FROM connections
     WHERE client_id = ?1 AND provider IN ('meta','instagram')
     ORDER BY CASE provider WHEN 'meta' THEN 0 ELSE 1 END
     LIMIT 1`
  ).bind(String(clientId)).first();

  if (!row) {
    return {
      connected: false,
      accessToken: "",
      igUserId: "",
      source: "none",
      expiresAt: null,
      expired: false,
      username: "",
      accountType: "",
      scopes: [],
      connectedAt: null
    };
  }

  const payload = parseJson(row.payload_json, {});
  const accessToken = payload?.accessToken
    ? await decryptSecret(env, payload.accessToken).catch(() => "")
    : "";
  const igUserId = String(payload?.igUserId || "").trim();
  const expiresAt = payload?.expiresAt || null;
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : 0;
  const expired = Boolean(expiresMs && Number.isFinite(expiresMs) && expiresMs <= Date.now());

  return {
    connected: Boolean(accessToken && igUserId && !expired),
    accessToken,
    igUserId,
    source: "d1-oauth",
    expiresAt,
    expired,
    username: String(payload?.username || ""),
    label: String(payload?.label || ""),
    accountType: String(payload?.accountType || ""),
    scopes: Array.isArray(payload?.scopes) ? payload.scopes : [],
    connectedAt: row.connected_at || row.updated_at || null
  };
}
