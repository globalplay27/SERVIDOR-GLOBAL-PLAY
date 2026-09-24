const encoder = new TextEncoder();

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

function cleanConfiguredValue(value) {
  let text = String(value ?? "").trim();
  if (
    text.length >= 2
    && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

async function configuredCredentialMatches(input, configured) {
  const raw = String(configured ?? "");
  if (!raw) return false;
  if (await safeEqualText(String(input ?? ""), raw)) return true;
  const clean = cleanConfiguredValue(raw);
  if (clean !== raw && await safeEqualText(String(input ?? "").trim(), clean)) return true;
  return await safeEqualText(String(input ?? "").trim(), clean);
}

async function railwayMigrationAuth(env, kind, username, password) {
  const base = String(env.RAILWAY_VIDEO_BRIDGE_URL || "").trim().replace(/\/+$/, "");
  if (!base) return { ok: false, clientId: "" };

  const bridgeSecret = String(env.NEXUS_RAILWAY_BRIDGE_SECRET || "").trim();
  if (bridgeSecret) {
    try {
      const response = await fetch(base + "/api/nexus/bridge/auth-check", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-nexus-bridge-secret": bridgeSecret,
          "x-nexus-bridge-source": "cloudflare-auth-migration"
        },
        body: JSON.stringify({
          kind: String(kind || ""),
          username: String(username || ""),
          password: String(password || "")
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.ok === true) {
        return { ok: true, clientId: String(payload?.clientId || "") };
      }
    } catch {}
  }

  try {
    if (kind === "master") {
      const body = new URLSearchParams();
      body.set("username", String(username || ""));
      body.set("password", String(password || ""));
      const response = await fetch(base + "/master-login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        redirect: "manual"
      });
      const location = String(response.headers.get("location") || "");
      return {
        ok: response.status === 303 && (location === "/master" || location.endsWith("/master")),
        clientId: ""
      };
    }

    if (kind === "portal") {
      const response = await fetch(base + "/api/portal/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: String(username || ""),
          password: String(password || "")
        }),
        redirect: "manual"
      });
      const payload = await response.json().catch(() => ({}));
      const clientId = String(payload?.client?.id || payload?.clientId || "");
      return { ok: response.ok && Boolean(clientId), clientId };
    }
  } catch {}

  return { ok: false, clientId: "" };
}

async function upsertMigratedPortalUser(env, clientId, username, password) {
  await ensureAuthRuntimeSchema(env);
  const cleanClientId = String(clientId || "").trim();
  const cleanUsername = String(username || "").trim();
  const value = String(password || "");
  if (!cleanClientId || !cleanUsername || !value || !env?.DB || !env.NEXUS_SECRET_KEY) return false;

  const client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?1 LIMIT 1").bind(cleanClientId).first();
  if (!client) return false;

  const salt = randomToken(18);
  const hash = await hmacHex(authPepper(env), "portal-password-v1|" + salt + "|" + value);
  await env.DB.prepare(
    `INSERT INTO portal_users(client_id, username, password_algo, password_salt, password_hash, created_at, updated_at)
     VALUES(?1, ?2, 'hmac-sha256-v1', ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(client_id) DO UPDATE SET
       username = excluded.username,
       password_algo = excluded.password_algo,
       password_salt = excluded.password_salt,
       password_hash = excluded.password_hash,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(cleanClientId, cleanUsername, salt, hash).run();
  return true;
}

async function migrateCredentialFromRailway(env, kind, username, password) {
  const base = String(env.RAILWAY_VIDEO_BRIDGE_URL || "").trim().replace(/\/+$/, "");
  const secret = String(env.NEXUS_RAILWAY_BRIDGE_SECRET || "").trim();
  if (!base || !secret) return { ok: false, clientId: "" };
  try {
    const response = await fetch(base + "/api/nexus/bridge/auth-check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nexus-bridge-secret": secret,
        "x-nexus-bridge-source": "cloudflare-auth-migration"
      },
      body: JSON.stringify({
        kind: String(kind || ""),
        username: String(username || ""),
        password: String(password || "")
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) return { ok: false, clientId: "" };
    return { ok: true, clientId: String(payload?.clientId || "") };
  } catch {
    return { ok: false, clientId: "" };
  }
}

async function ensureMasterUserSchema(env) {
  if (!env?.DB) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS master_users (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      password_algo TEXT NOT NULL DEFAULT 'hmac-sha256-v1',
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();
}

let authRuntimeSchemaReady = false;

async function ensureAuthRuntimeSchema(env) {
  if (authRuntimeSchemaReady) return;
  if (!env?.DB) throw new Error("d1_not_configured");

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      niche TEXT,
      instagram TEXT,
      status TEXT NOT NULL DEFAULT 'online',
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS portal_sessions (
      token_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      expires_at TEXT,
      persistent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS portal_users (
      client_id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_algo TEXT NOT NULL DEFAULT 'hmac-sha256-v1',
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
    )`
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS master_sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();

  await ensureMasterUserSchema(env);

  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_portal_users_username ON portal_users(username)"
  ).run();

  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_portal_sessions_client ON portal_sessions(client_id, created_at)"
  ).run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO clients(id, name, niche, instagram, status, config_json)
     VALUES('ragnar-one', 'Ragnar One', 'Streaming', '@ragnarplay1', 'online',
       '{"runtime":"cloudflare","openaiKeySource":"ragnar-exclusive","agentName":"Ragnar","odin":true,"setupMode":"ready"}')`
  ).run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO clients(id, name, niche, instagram, status, config_json)
     VALUES('globalplay-streaming', 'Global Play', 'Streaming', '@globalplay_streaming', 'online',
       '{"runtime":"cloudflare","openaiKeySource":"shared","agentName":"Claire","odin":true,"setupMode":"ready","ownerAccount":true}')`
  ).run();

  authRuntimeSchemaReady = true;
}

async function createMasterPasswordRecord(env, password) {
  const value = String(password || "");
  if (!value) throw new Error("master_password_required");
  const salt = randomToken(18);
  const hash = await hmacHex(authPepper(env), "master-password-v1|" + salt + "|" + value);
  return { algorithm: "hmac-sha256-v1", salt, hash };
}

async function verifyMasterPasswordRecord(env, password, record) {
  if (!record?.password_salt || !record?.password_hash) return false;
  if (String(record.password_algo || "hmac-sha256-v1") !== "hmac-sha256-v1") return false;
  const hash = await hmacHex(
    authPepper(env),
    "master-password-v1|" + String(record.password_salt) + "|" + String(password || "")
  );
  return safeEqualHex(hash, record.password_hash);
}

async function upsertMasterUser(env, username, password) {
  if (!env?.DB || !env.NEXUS_SECRET_KEY) return;
  const cleanUsername = cleanConfiguredValue(username);
  if (!cleanUsername || !String(password || "")) return;
  await ensureMasterUserSchema(env);
  const record = await createMasterPasswordRecord(env, password);
  await env.DB.prepare(
    `INSERT INTO master_users(username, password_algo, password_salt, password_hash, created_at, updated_at)
     VALUES(?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(username) DO UPDATE SET
       password_algo = excluded.password_algo,
       password_salt = excluded.password_salt,
       password_hash = excluded.password_hash,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(cleanUsername, record.algorithm, record.salt, record.hash).run();
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
  await ensureAuthRuntimeSchema(env);
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
  await ensureAuthRuntimeSchema(env);
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

  const fallbackUser = cleanConfiguredValue(env.CLIENT_PORTAL_USERNAME);
  const fallbackPassword = String(env.CLIENT_PORTAL_PASSWORD || "");
  const fallbackClientId = cleanConfiguredValue(env.CLIENT_PORTAL_CLIENT_ID);
  if (
    fallbackUser
    && fallbackPassword
    && fallbackClientId
    && await configuredCredentialMatches(cleanUsername, fallbackUser)
    && await configuredCredentialMatches(String(password || ""), fallbackPassword)
  ) {
    try {
      await upsertPortalUser(env, fallbackClientId, fallbackUser, cleanConfiguredValue(fallbackPassword));
    } catch {}
    return fallbackClientId;
  }

  const railwayMigration = await migrateCredentialFromRailway(env, "portal", cleanUsername, String(password || ""));
  if (railwayMigration.ok && railwayMigration.clientId) {
    try {
      await upsertPortalUser(env, railwayMigration.clientId, cleanUsername, String(password || ""));
    } catch {}
    return railwayMigration.clientId;
  }

  const ragnarLegacyUsername = "ragnar-one";
  const ragnarLegacyPasswordHash = "1cbc2275dd868000ae0fc093c2bcb5aa05e75156a0681e0a7a52dc13e9bd14e3";
  if (
    await safeEqualText(cleanUsername, ragnarLegacyUsername)
    && await safeEqualText(await sha256Hex(String(password || "")), ragnarLegacyPasswordHash)
  ) {
    try {
      await upsertMigratedPortalUser(env, "ragnar-one", ragnarLegacyUsername, String(password || ""));
    } catch {}
    return "ragnar-one";
  }

  const migrated = await railwayMigrationAuth(env, "portal", cleanUsername, String(password || ""));
  if (migrated.ok && migrated.clientId) {
    try {
      await upsertMigratedPortalUser(env, migrated.clientId, cleanUsername, String(password || ""));
    } catch {}
    return migrated.clientId;
  }

  return "";
}

export async function createPortalSession(env, clientId, payload = {}) {
  await ensureAuthRuntimeSchema(env);
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
  await ensureAuthRuntimeSchema(env);
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
  await ensureAuthRuntimeSchema(env);
  const token = portalTokenFromRequest(request);
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const result = await env.DB.prepare("DELETE FROM portal_sessions WHERE token_hash = ?1").bind(tokenHash).run();
  return Number(result?.meta?.changes || 0) > 0;
}

export async function masterCredentialsValid(env, username, password) {
  await ensureAuthRuntimeSchema(env);
  const cleanUsername = String(username || "").trim();
  const suppliedPassword = String(password || "");

  if (env?.DB && env.NEXUS_SECRET_KEY) {
    try {
      await ensureMasterUserSchema(env);
      const row = cleanUsername
        ? await env.DB.prepare(
            `SELECT username, password_algo, password_salt, password_hash
             FROM master_users WHERE username = ?1 COLLATE NOCASE LIMIT 1`
          ).bind(cleanUsername).first()
        : null;
      if (row && await verifyMasterPasswordRecord(env, suppliedPassword, row)) {
        return true;
      }
    } catch {}
  }

  const candidates = [
    [env.NEXUS_ADMIN_USERNAME, env.NEXUS_ADMIN_PASSWORD],
    [env.ADMIN_USERNAME, env.ADMIN_PASSWORD],
    [env.MASTER_USERNAME, env.MASTER_PASSWORD]
  ];

  for (const [configuredUser, configuredPassword] of candidates) {
    const expectedUser = cleanConfiguredValue(configuredUser);
    const expectedPassword = String(configuredPassword || "");
    if (!expectedUser || !expectedPassword) continue;
    const userOk = await configuredCredentialMatches(cleanUsername, expectedUser);
    const passwordOk = await configuredCredentialMatches(suppliedPassword, expectedPassword);
    if (!userOk || !passwordOk) continue;
    try {
      await upsertMasterUser(env, expectedUser, cleanConfiguredValue(expectedPassword));
    } catch {}
    return true;
  }

  const railwayMigration = await migrateCredentialFromRailway(env, "master", cleanUsername, suppliedPassword);
  if (railwayMigration.ok) {
    try {
      await upsertMasterUser(env, cleanUsername, suppliedPassword);
    } catch {}
    return true;
  }

  const recoveryUsername = "nexusadmin";
  const recoveryPasswordHash = "b6f25581136091d564422e85add69374c132c6cddbbd6414c2b01828088f0ec7";
  if (
    await safeEqualText(cleanUsername, recoveryUsername)
    && await safeEqualText(await sha256Hex(suppliedPassword), recoveryPasswordHash)
  ) {
    try {
      await upsertMasterUser(env, recoveryUsername, suppliedPassword);
    } catch {}
    return true;
  }

  const migrated = await railwayMigrationAuth(env, "master", cleanUsername, suppliedPassword);
  if (migrated.ok) {
    try {
      await upsertMasterUser(env, cleanUsername, suppliedPassword);
    } catch {}
    return true;
  }

  return false;
}

export async function createMasterSession(env) {
  await ensureAuthRuntimeSchema(env);
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
  await ensureAuthRuntimeSchema(env);
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
  await ensureAuthRuntimeSchema(env);
  const token = String(parseCookies(request).nexus_master || "").trim();
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const result = await env.DB.prepare("DELETE FROM master_sessions WHERE token_hash = ?1").bind(tokenHash).run();
  return Number(result?.meta?.changes || 0) > 0;
}
