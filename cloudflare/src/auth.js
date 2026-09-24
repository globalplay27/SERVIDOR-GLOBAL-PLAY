const encoder = new TextEncoder();

async function railwayAuthCheck(env, kind, username, password) {
  const base = String(env.RAILWAY_VIDEO_BRIDGE_URL || "").trim().replace(/\/+$/, "");
  const secret = String(env.NEXUS_RAILWAY_BRIDGE_SECRET || "").trim();
  if (!base || !secret) return { ok: false, clientId: "" };

  try {
    const response = await fetch(base + "/api/nexus/bridge/auth-check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nexus-bridge-secret": secret,
        "x-nexus-bridge-source": "cloudflare-auth"
      },
      body: JSON.stringify({
        kind: String(kind || ""),
        username: String(username || ""),
        password: String(password || "")
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) return { ok: false, clientId: "" };
    return {
      ok: true,
      clientId: String(payload?.clientId || "")
    };
  } catch {
    return { ok: false, clientId: "" };
  }
}


export const PORTAL_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MASTER_SESSION_TTL_SECONDS = 12 * 60 * 60;

function bytesToHex(bytes) {
  return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Bytes(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value))));
}

export async function sha256Hex(value) {
  return bytesToHex(await sha256Bytes(value));
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(String(value))));
  return bytesToHex(signature);
}

function safeEqualHex(left, right) {
  const a = String(left || "").toLowerCase();
  const b = String(right || "").toLowerCase();
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export async function safeEqualText(left, right) {
  const [a, b] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  return safeEqualHex(a, b);
}

export function parseCookies(request) {
  const cookie = String(request.headers.get("cookie") || "");
  const result = {};
  for (const part of cookie.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try { result[key] = decodeURIComponent(value); } catch { result[key] = value; }
  }
  return result;
}

export function portalSessionCookie(token) {
  return "nexus_session=" + encodeURIComponent(String(token))
    + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + PORTAL_SESSION_TTL_SECONDS;
}

export function clearPortalSessionCookie() {
  return "nexus_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

export function masterSessionCookie(token) {
  return "nexus_master=" + encodeURIComponent(String(token))
    + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + MASTER_SESSION_TTL_SECONDS;
}

export function clearMasterSessionCookie() {
  return "nexus_master=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

function authPepper(env) {
  const secret = String(env.NEXUS_SECRET_KEY || "").trim();
  if (!secret) throw new Error("nexus_secret_not_configured");
  return secret;
}

export async function createPortalPasswordRecord(env, password) {
  const value = String(password || "");
  if (value.length < 8) throw new Error("portal_password_too_short");
  const salt = randomToken(18);
  const hash = await hmacHex(authPepper(env), "portal-password-v1|" + salt + "|" + value);
  return { algorithm: "hmac-sha256-v1", salt, hash };
}

export async function verifyPortalPasswordRecord(env, password, record) {
  if (!record?.password_salt || !record?.password_hash) return false;
  const algorithm = String(record.password_algo || "hmac-sha256-v1");
  if (algorithm !== "hmac-sha256-v1") return false;
  const hash = await hmacHex(
    authPepper(env),
    "portal-password-v1|" + String(record.password_salt) + "|" + String(password || "")
  );
  return safeEqualHex(hash, record.password_hash);
}

export async function upsertPortalUser(env, clientId, username, password) {
  const cleanClientId = String(clientId || "").trim();
  const cleanUsername = String(username || "").trim();
  if (!cleanClientId || !cleanUsername) throw new Error("client_id_and_username_required");
  const client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?1 LIMIT 1").bind(cleanClientId).first();
  if (!client) throw new Error("client_not_found");
  const record = await createPortalPasswordRecord(env, password);
  await env.DB.prepare(
    `INSERT INTO portal_users(client_id, username, password_algo, password_salt, password_hash, created_at, updated_at)
     VALUES(?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(client_id) DO UPDATE SET
       username = excluded.username,
       password_algo = excluded.password_algo,
       password_salt = excluded.password_salt,
       password_hash = excluded.password_hash,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(cleanClientId, cleanUsername, record.algorithm, record.salt, record.hash).run();
  return { clientId: cleanClientId, username: cleanUsername };
}

export async function authenticatePortalUser(env, username, password) {
  const cleanUsername = String(username || "").trim();
  const row = cleanUsername
    ? await env.DB.prepare(
        `SELECT client_id, username, password_algo, password_salt, password_hash
         FROM portal_users WHERE username = ?1 COLLATE NOCASE LIMIT 1`
      ).bind(cleanUsername).first()
    : null;

  if (row && await verifyPortalPasswordRecord(env, password, row)) {
    return String(row.client_id);
  }

  const fallbackUser = String(env.CLIENT_PORTAL_USERNAME || "").trim();
  const fallbackPassword = String(env.CLIENT_PORTAL_PASSWORD || "");
  const fallbackClientId = String(env.CLIENT_PORTAL_CLIENT_ID || "").trim();
  if (
    fallbackUser
    && fallbackPassword
    && fallbackClientId
    && await safeEqualText(cleanUsername, fallbackUser)
    && await safeEqualText(String(password || ""), fallbackPassword)
  ) {
    return fallbackClientId;
  }

  const railway = await railwayAuthCheck(env, "portal", cleanUsername, password);
  if (railway.ok && railway.clientId) return railway.clientId;

  return "";
}

export async function createPortalSession(env, clientId, payload = {}) {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + PORTAL_SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO portal_sessions(token_hash, client_id, payload_json, expires_at, persistent, created_at)
     VALUES(?1, ?2, ?3, ?4, 1, CURRENT_TIMESTAMP)`
  ).bind(tokenHash, String(clientId), JSON.stringify(payload || {}), expiresAt).run();
  return { token, expiresAt };
}

function portalTokenFromRequest(request) {
  const cookies = parseCookies(request);
  return String(cookies.nexus_session || request.headers.get("x-nexus-session") || "").trim();
}

export async function resolvePortalSession(env, request) {
  const token = portalTokenFromRequest(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT token_hash, client_id, payload_json, expires_at, persistent, created_at
     FROM portal_sessions WHERE token_hash = ?1 LIMIT 1`
  ).bind(tokenHash).first();
  if (!row) return null;
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expires && expires < Date.now()) {
    await env.DB.prepare("DELETE FROM portal_sessions WHERE token_hash = ?1").bind(tokenHash).run().catch(() => {});
    return null;
  }
  let payload = {};
  try { payload = JSON.parse(String(row.payload_json || "{}")); } catch {}
  return {
    token,
    tokenHash,
    clientId: String(row.client_id || ""),
    expiresAt: row.expires_at || null,
    persistent: Number(row.persistent || 0) === 1,
    payload
  };
}

export async function deletePortalSession(env, request) {
  const token = portalTokenFromRequest(request);
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const result = await env.DB.prepare("DELETE FROM portal_sessions WHERE token_hash = ?1").bind(tokenHash).run();
  return Number(result?.meta?.changes || 0) > 0;
}

export async function masterCredentialsValid(env, username, password) {
  const expectedUser = String(env.NEXUS_ADMIN_USERNAME || "").trim();
  const expectedPassword = String(env.NEXUS_ADMIN_PASSWORD || "");
  if (
    expectedUser
    && expectedPassword
    && await safeEqualText(String(username || "").trim(), expectedUser)
    && await safeEqualText(String(password || ""), expectedPassword)
  ) {
    return true;
  }

  const railway = await railwayAuthCheck(env, "master", username, password);
  return railway.ok === true;
}

export async function createMasterSession(env) {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + MASTER_SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO master_sessions(token_hash, expires_at, created_at)
     VALUES(?1, ?2, CURRENT_TIMESTAMP)`
  ).bind(tokenHash, expiresAt).run();
  return { token, expiresAt };
}

export async function resolveMasterSession(env, request) {
  const authorization = String(request.headers.get("authorization") || "");
  const internalSecret = String(env.NEXUS_SECRET_KEY || "");
  if (internalSecret && authorization === "Bearer " + internalSecret) {
    return { internal: true };
  }

  const token = String(parseCookies(request).nexus_master || "").trim();
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT token_hash, expires_at FROM master_sessions WHERE token_hash = ?1 LIMIT 1"
  ).bind(tokenHash).first();
  if (!row) return null;
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (!expires || expires < Date.now()) {
    await env.DB.prepare("DELETE FROM master_sessions WHERE token_hash = ?1").bind(tokenHash).run().catch(() => {});
    return null;
  }
  return { token, tokenHash, expiresAt: row.expires_at };
}

export async function deleteMasterSession(env, request) {
  const token = String(parseCookies(request).nexus_master || "").trim();
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const result = await env.DB.prepare("DELETE FROM master_sessions WHERE token_hash = ?1").bind(tokenHash).run();
  return Number(result?.meta?.changes || 0) > 0;
}
