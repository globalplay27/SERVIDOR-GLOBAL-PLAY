
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const RAGNAR_PORTAL_USERNAME = "ragnar-one";
const RAGNAR_PORTAL_PASSWORD_HASH = "1cbc2275dd868000ae0fc093c2bcb5aa05e75156a0681e0a7a52dc13e9bd14e3";
const EMPTY_SEED = [];

fs.mkdirSync(DATA_DIR, { recursive: true });

const seedFile = path.join(__dirname, "data", "clients.json");
const runtimeFile = path.join(DATA_DIR, "runtime.json");
const connectionsFile = path.join(DATA_DIR, "connections.json");
const oauthStateFile = path.join(DATA_DIR, "oauth-states.json");
const portalUsersFile = path.join(DATA_DIR, "portal-users.json");
const portalSessions = new Map();

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : fallback;
  } catch (error) {
    console.warn(`Ignoring invalid JSON in ${file}: ${error.message}`);
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const tempFile = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(value, null, 2));
  fs.renameSync(tempFile, file);
}

if (!fs.existsSync(runtimeFile)) {
  const seed = readJsonFile(seedFile, EMPTY_SEED);
  writeJsonAtomic(runtimeFile, seed);
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  const raw = Buffer.isBuffer(body)
    ? body
    : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(status, {
    "content-type": type,
    "content-length": raw.length,
    "cache-control": type.startsWith("text/html") ? "no-store" : "no-cache",
    "x-content-type-options": "nosniff"
  });
  res.end(raw);
}

function readFormBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      resolve(Object.fromEntries(params.entries()));
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    const raw = part.slice(index + 1).trim();
    try { result[key] = decodeURIComponent(raw); } catch { result[key] = raw; }
  }
  return result;
}

function redirectWithCookie(res, location, cookie = "") {
  const headers = { location, "cache-control": "no-store", "content-length": "0" };
  if (cookie) headers["set-cookie"] = cookie;
  res.writeHead(303, headers);
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function loadClients() {
  return readJsonFile(runtimeFile, EMPTY_SEED);
}

function saveClients(items) {
  writeJsonAtomic(runtimeFile, items);
}

function readObjectFile(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  } catch (error) {
    console.warn(`Ignoring invalid object JSON in ${file}: ${error.message}`);
    return fallback;
  }
}

function loadConnections() {
  return readObjectFile(connectionsFile, {});
}

function saveConnections(value) {
  writeJsonAtomic(connectionsFile, value);
}

function loadOauthStates() {
  return readObjectFile(oauthStateFile, {});
}

function saveOauthStates(value) {
  writeJsonAtomic(oauthStateFile, value);
}

function loadPortalUsers() {
  return readObjectFile(portalUsersFile, {});
}

function savePortalUsers(value) {
  writeJsonAtomic(portalUsersFile, value);
}

function createPortalPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 32).toString("hex");
  return { salt, hash };
}

function verifyPortalPassword(password, record) {
  if (!record?.salt || !record?.hash) return false;
  try {
    const supplied = crypto.scryptSync(String(password), String(record.salt), 32);
    const expected = Buffer.from(String(record.hash), "hex");
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}

function secretKey() {
  const raw = String(process.env.NEXUS_SECRET_KEY || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
  return Buffer.from(raw, "hex");
}

function encryptSecret(value) {
  const key = secretKey();
  if (!key) throw new Error("secure_storage_not_configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

function decryptSecret(value) {
  const key = secretKey();
  if (!key || !value) return "";
  const parts = String(value).split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return "";
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    return "";
  }
}

function directConnection(clientId, provider) {
  const all = loadConnections();
  return all?.[clientId]?.[provider] || null;
}

function providerLooksConnected(value) {
  return ["connected","configured","active","ready"].includes(String(value || "").toLowerCase());
}

function connectionSummary(client) {
  const direct = loadConnections()?.[client.id] || {};
  const legacy = {
    github: client.github,
    railway: client.railway,
    openai: client.openai,
    meta: client.meta
  };
  const result = {};
  for (const provider of ["github","railway","openai","meta"]) {
    const record = direct[provider];
    result[provider] = {
      connected: Boolean(record) || providerLooksConnected(legacy[provider]),
      direct: Boolean(record),
      source: record ? "direct" : (providerLooksConnected(legacy[provider]) ? "agent" : "none"),
      label: record?.meta?.label || record?.meta?.login || record?.meta?.name || "",
      connectedAt: record?.connectedAt || null
    };
  }
  return result;
}

function markProviderConnected(clientId, provider) {
  const clients = loadClients();
  const client = clients.find(item => item.id === clientId);
  if (!client) return null;
  client.onboarding = client.onboarding && typeof client.onboarding === "object" ? client.onboarding : {};
  if (["github","railway","openai"].includes(provider)) client.onboarding[provider] = true;
  if (provider === "github") client.github = "connected";
  if (provider === "railway") client.railway = "connected";
  if (provider === "openai") client.openai = "configured";
  saveClients(clients);
  return client;
}

function saveProviderConnection(clientId, provider, record) {
  const all = loadConnections();
  all[clientId] = all[clientId] && typeof all[clientId] === "object" ? all[clientId] : {};
  all[clientId][provider] = { ...record, connectedAt: new Date().toISOString() };
  saveConnections(all);
}

async function validateGithubToken(token) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      authorization: "Bearer " + token,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2026-03-10",
      "user-agent": "NEXUS-AI/1.0"
    }
  });
  if (!response.ok) throw new Error("github_auth_failed");
  return response.json();
}

async function validateOpenAIKey(key) {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { authorization: "Bearer " + key, "user-agent": "NEXUS-AI/1.0" }
  });
  if (!response.ok) throw new Error("openai_auth_failed");
  return true;
}

async function validateOpenAIAdminKey(key) {
  const start = Math.floor(Date.now() / 1000) - 86400;
  const response = await fetch("https://api.openai.com/v1/organization/costs?start_time=" + start + "&limit=1", {
    headers: { authorization: "Bearer " + key, "user-agent": "NEXUS-AI/1.0" }
  });
  if (!response.ok) throw new Error("openai_admin_auth_failed");
  return true;
}

function railwayRedirectUri(req) {
  const host = process.env.RAILWAY_PUBLIC_DOMAIN || req.headers.host || "servidor-global-play-production.up.railway.app";
  return "https://" + host + "/api/oauth/railway/callback";
}

async function railwayAccessTokenFor(clientId) {
  const all = loadConnections();
  const record = all?.[clientId]?.railway;
  if (!record) return "";
  const current = decryptSecret(record.accessToken);
  if (current && Number(record.expiresAt || 0) > Date.now() + 60000) return current;
  const refresh = decryptSecret(record.refreshToken);
  const clientIdEnv = process.env.RAILWAY_OAUTH_CLIENT_ID;
  const clientSecret = process.env.RAILWAY_OAUTH_CLIENT_SECRET;
  if (!refresh || !clientIdEnv || !clientSecret) return current;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh
  });
  const response = await fetch("https://backboard.railway.com/oauth/token", {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(clientIdEnv + ":" + clientSecret).toString("base64"),
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  if (!response.ok) return current;
  const tokens = await response.json();
  record.accessToken = encryptSecret(tokens.access_token || "");
  if (tokens.refresh_token) record.refreshToken = encryptSecret(tokens.refresh_token);
  record.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
  all[clientId].railway = record;
  saveConnections(all);
  return tokens.access_token || current;
}

function parseBasicAuth(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
}

function safeEqualText(left, right) {
  const supplied = Buffer.from(String(left || ""));
  const expected = Buffer.from(String(right || ""));
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function agentBearerAuthorized(req, clientId) {
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) return false;
  const supplied = auth.slice(7);
  const expected = clientId === "ragnar-one"
    ? String(process.env.RAGNAR_AGENT_TOKEN || "")
    : "";
  if (!expected) return false;
  return safeEqualText(supplied, expected);
}

function authorized(req) {
  const credentials = parseBasicAuth(req);
  if (!credentials) return false;
  return safeEqualText(credentials.username, ADMIN_USERNAME)
    && safeEqualText(credentials.password, ADMIN_PASSWORD);
}

function portalAccounts() {
  const accounts = [];

  if (process.env.CLIENT_PORTAL_ACCOUNTS) {
    try {
      const parsed = JSON.parse(process.env.CLIENT_PORTAL_ACCOUNTS);
      if (Array.isArray(parsed)) {
        for (const account of parsed) {
          if (account?.clientId && account?.username && account?.password) {
            accounts.push({
              clientId: String(account.clientId),
              username: String(account.username),
              password: String(account.password)
            });
          }
        }
      }
    } catch (error) {
      console.warn(`Ignoring invalid CLIENT_PORTAL_ACCOUNTS: ${error.message}`);
    }
  }

  if (
    process.env.CLIENT_PORTAL_CLIENT_ID
    && process.env.CLIENT_PORTAL_USERNAME
    && process.env.CLIENT_PORTAL_PASSWORD
  ) {
    accounts.push({
      clientId: process.env.CLIENT_PORTAL_CLIENT_ID,
      username: process.env.CLIENT_PORTAL_USERNAME,
      password: process.env.CLIENT_PORTAL_PASSWORD
    });
  }

  return accounts;
}

function clientFromCredentials(username, password) {
  const clients = loadClients();
  const account = portalAccounts().find(item =>
    safeEqualText(username, item.username)
    && safeEqualText(password, item.password)
  );
  if (account) {
    return clients.find(client => client.id === account.clientId) || null;
  }

  const storedUsers = loadPortalUsers();
  for (const [clientId, record] of Object.entries(storedUsers)) {
    if (
      safeEqualText(username, record?.username || "")
      && verifyPortalPassword(password, record)
    ) {
      return clients.find(client => client.id === clientId) || null;
    }
  }

  const ragnarFallback =
    safeEqualText(username, RAGNAR_PORTAL_USERNAME)
    && safeEqualText(sha256Text(password), RAGNAR_PORTAL_PASSWORD_HASH);

  if (ragnarFallback) {
    return clients.find(client => client.id === "ragnar-one") || null;
  }
  return null;
}

function tokenClientForRequest(req) {
  const cookies = parseCookies(req);
  const token = String(cookies.nexus_session || req.headers["x-nexus-session"] || "");
  if (!token) return null;
  const record = portalSessions.get(token);
  if (!record || record.expiresAt < Date.now()) {
    if (record) portalSessions.delete(token);
    return null;
  }
  return loadClients().find(client => client.id === record.clientId) || null;
}

function portalClientForRequest(req) {
  const tokenClient = tokenClientForRequest(req);
  if (tokenClient) return tokenClient;

  const credentials = parseBasicAuth(req);
  if (!credentials) return null;
  return clientFromCredentials(credentials.username, credentials.password);
}

function defaultPostingProfile() {
  return {
    contentStrategy: "Vendas + engajamento",
    targetAudience: "Misto",
    visualStyle: "Tecnológico premium",
    contentFocus: "Estabilidade, suporte, futebol, filmes e séries",
    morningTheme: "Dores do cliente e estabilidade",
    afternoonTheme: "Filmes, séries e entretenimento",
    eveningTheme: "Futebol e jogos ao vivo",
    tone: "Firme, direto e profissional",
    cta: 'Comente "QUERO" e saiba mais',
    hashtags: "#RagnarOne #Streaming #FutebolAoVivo #FilmesESeries #Entretenimento",
    avoidTopics: "Promessas irreais, informações não confirmadas e poluição visual"
  };
}

function clientPortalView(client) {
  return {
    id: client.id,
    name: client.name,
    niche: client.niche,
    instagram: client.instagram,
    theme: client.theme,
    primaryColor: client.primaryColor,
    secondaryColor: client.secondaryColor,
    status: client.status,
    odin: client.odin,
    postTimes: client.postTimes,
    leads: client.leads,
    usage: client.usage,
    onboarding: client.onboarding || {},
    setupMode: client.setupMode || "ready",
    integrationState: {
      github: client.github || "pending",
      railway: client.railway || "pending",
      openai: client.openai || "pending",
      meta: client.meta || "pending"
    },
    postingProfile: { ...defaultPostingProfile(), ...(client.postingProfile || {}) },
    connections: connectionSummary(client)
  };
}

function slug(value) {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    return send(res, 200, {
      ok: true,
      service: "nexus-ai-agent-central",
      version: "1.0.0"
    });
  }

  if (url.pathname === "/api/portal/login" && req.method === "POST") {
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const client = clientFromCredentials(username, password);
    if (!client) return send(res, 401, { error: "unauthorized" });

    const token = crypto.randomBytes(32).toString("base64url");
    portalSessions.set(token, {
      clientId: client.id,
      expiresAt: Date.now() + 12 * 60 * 60 * 1000
    });
    return send(res, 200, {
      token,
      client: clientPortalView(client)
    });
  }

  if (url.pathname === "/portal-login" && req.method === "POST") {
    try {
      const body = await readFormBody(req);
      const client = clientFromCredentials(String(body.username || "").trim(), String(body.password || ""));
      if (!client) return redirectWithCookie(res, "/portal.html?v=16&error=1");

      const token = crypto.randomBytes(32).toString("base64url");
      portalSessions.set(token, { clientId: client.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
      const cookie = "nexus_session=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200";
      return redirectWithCookie(res, "/portal.html?v=16&auth=1", cookie);
    } catch {
      return redirectWithCookie(res, "/portal.html?v=16&error=1");
    }
  }

  if (url.pathname === "/api/portal/diagnostic" && req.method === "GET") {
    const username = process.env.CLIENT_PORTAL_USERNAME || RAGNAR_PORTAL_USERNAME;
    const password = process.env.CLIENT_PORTAL_PASSWORD || "";
    const client = clientFromCredentials(username, password);
    return send(res, client ? 200 : 500, {
      ok: Boolean(client),
      clientId: client?.id || null,
      runtimeHasRagnar: loadClients().some(item => item.id === "ragnar-one"),
      version: "auth-diagnostic-v1"
    });
  }

  if (url.pathname === "/api/portal/session" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) {
      return send(res, 401, { error: "unauthorized" });
    }
    return send(res, 200, clientPortalView(client));
  }

  if (url.pathname === "/api/portal/logout" && req.method === "POST") {
    const token = String(parseCookies(req).nexus_session || req.headers["x-nexus-session"] || "");
    if (token) portalSessions.delete(token);
    res.setHeader("set-cookie", "nexus_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/api/portal/connections" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) {
      return send(res, 401, { error: "unauthorized" });
    }
    return send(res, 200, {
      connections: connectionSummary(client),
      onboarding: client.onboarding || {}
    });
  }

  if (url.pathname === "/api/portal/connect/github" && req.method === "POST") {
    const sessionClient = portalClientForRequest(req);
    if (!sessionClient) {
      return send(res, 401, { error: "unauthorized" });
    }
    try {
      const body = await readBody(req);
      const token = String(body.token || "").trim();
      if (token.length < 20) return send(res, 400, { error: "invalid_token" });
      const profile = await validateGithubToken(token);
      saveProviderConnection(sessionClient.id, "github", {
        token: encryptSecret(token),
        meta: {
          login: String(profile.login || ""),
          name: String(profile.name || ""),
          label: String(profile.login || profile.name || "GitHub")
        }
      });
      const client = markProviderConnected(sessionClient.id, "github");
      return send(res, 200, clientPortalView(client));
    } catch (error) {
      return send(res, 400, { error: error.message || "github_connection_failed" });
    }
  }

  if (url.pathname === "/api/portal/connect/openai" && req.method === "POST") {
    const sessionClient = portalClientForRequest(req);
    if (!sessionClient) {
      return send(res, 401, { error: "unauthorized" });
    }
    try {
      const body = await readBody(req);
      const apiKey = String(body.apiKey || "").trim();
      const adminKey = String(body.adminKey || "").trim();
      if (apiKey.length < 20) return send(res, 400, { error: "invalid_api_key" });
      await validateOpenAIKey(apiKey);
      if (adminKey) await validateOpenAIAdminKey(adminKey);
      saveProviderConnection(sessionClient.id, "openai", {
        apiKey: encryptSecret(apiKey),
        adminKey: adminKey ? encryptSecret(adminKey) : "",
        meta: {
          label: adminKey ? "OpenAI + custos" : "OpenAI API",
          hasAdminKey: Boolean(adminKey)
        }
      });
      const client = markProviderConnected(sessionClient.id, "openai");
      return send(res, 200, clientPortalView(client));
    } catch (error) {
      return send(res, 400, { error: error.message || "openai_connection_failed" });
    }
  }

  if (url.pathname === "/api/oauth/railway/start" && req.method === "GET") {
    const sessionClient = portalClientForRequest(req);
    if (!sessionClient) {
      return send(res, 401, { error: "unauthorized" });
    }
    const clientId = process.env.RAILWAY_OAUTH_CLIENT_ID;
    if (!clientId || !process.env.RAILWAY_OAUTH_CLIENT_SECRET) {
      return send(res, 503, { error: "railway_oauth_not_configured" });
    }

    const state = crypto.randomBytes(24).toString("base64url");
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const states = loadOauthStates();
    const now = Date.now();
    for (const [key, value] of Object.entries(states)) {
      if (!value?.createdAt || now - Number(value.createdAt) > 15 * 60 * 1000) delete states[key];
    }
    states[state] = { clientId: sessionClient.id, verifier, createdAt: now };
    saveOauthStates(states);

    const authorize = new URL("https://backboard.railway.com/oauth/auth");
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", railwayRedirectUri(req));
    authorize.searchParams.set("scope", "openid profile email offline_access project:viewer workspace:viewer");
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("prompt", "consent");
    return send(res, 200, { url: authorize.toString() });
  }

  if (url.pathname === "/api/oauth/railway/callback" && req.method === "GET") {
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const oauthError = url.searchParams.get("error") || "";
    const states = loadOauthStates();
    const saved = states[state];

    const oauthPage = (ok, message) => send(
      res,
      ok ? 200 : 400,
      `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NEXUS AI</title><body style="margin:0;background:#050807;color:#f4f8f5;font-family:system-ui;display:grid;place-items:center;min-height:100vh"><div style="max-width:520px;padding:30px;border:1px solid #26352c;border-radius:20px;background:#0b110e;text-align:center"><h1 style="margin-top:0;color:${ok ? "#21e47b" : "#ff9898"}">${ok ? "Railway conectado" : "Falha na conexão"}</h1><p style="color:#aab9b0;line-height:1.5">${message}</p><p>Você pode fechar esta janela e voltar ao Portal NEXUS AI.</p></div></body></html>`,
      "text/html; charset=utf-8"
    );

    if (oauthError) return oauthPage(false, "A autorização foi cancelada ou recusada.");
    if (!code || !state || !saved || Date.now() - Number(saved.createdAt || 0) > 15 * 60 * 1000) {
      return oauthPage(false, "Esta autorização expirou. Inicie a conexão novamente pelo portal.");
    }

    try {
      const clientId = process.env.RAILWAY_OAUTH_CLIENT_ID;
      const clientSecret = process.env.RAILWAY_OAUTH_CLIENT_SECRET;
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: railwayRedirectUri(req),
        code_verifier: saved.verifier
      });
      const tokenResponse = await fetch("https://backboard.railway.com/oauth/token", {
        method: "POST",
        headers: {
          authorization: "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64"),
          "content-type": "application/x-www-form-urlencoded"
        },
        body
      });
      if (!tokenResponse.ok) throw new Error("railway_token_exchange_failed");
      const tokens = await tokenResponse.json();

      let identity = {};
      try {
        const identityResponse = await fetch("https://backboard.railway.com/oauth/me", {
          headers: { authorization: "Bearer " + tokens.access_token }
        });
        if (identityResponse.ok) identity = await identityResponse.json();
      } catch {}

      saveProviderConnection(saved.clientId, "railway", {
        accessToken: encryptSecret(tokens.access_token || ""),
        refreshToken: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : "",
        expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
        scope: String(tokens.scope || ""),
        meta: {
          name: String(identity.name || identity.email || "Railway"),
          label: String(identity.name || identity.email || "Railway")
        }
      });
      markProviderConnected(saved.clientId, "railway");
      delete states[state];
      saveOauthStates(states);
      return oauthPage(true, "A conta Railway foi autorizada com sucesso.");
    } catch (error) {
      console.warn("Railway OAuth callback failed:", error.message);
      return oauthPage(false, "Não foi possível concluir a autorização. Tente novamente pelo portal.");
    }
  }

  if (url.pathname === "/api/portal/provider-usage" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) {
      return send(res, 401, { error: "unauthorized" });
    }

    const direct = loadConnections()?.[client.id] || {};
    const result = {
      github: { connected: Boolean(direct.github), login: direct.github?.meta?.login || "" },
      openai: { connected: Boolean(direct.openai), cost31dUsd: null, costAvailable: false },
      railway: { connected: Boolean(direct.railway), projects: [], projectCount: null }
    };

    if (direct.openai?.adminKey) {
      const adminKey = decryptSecret(direct.openai.adminKey);
      if (adminKey) {
        try {
          const start = Math.floor(Date.now() / 1000) - 31 * 86400;
          const response = await fetch("https://api.openai.com/v1/organization/costs?start_time=" + start + "&limit=31", {
            headers: { authorization: "Bearer " + adminKey, "user-agent": "NEXUS-AI/1.0" }
          });
          if (response.ok) {
            const payload = await response.json();
            let total = 0;
            for (const bucket of payload.data || []) {
              for (const item of bucket.results || []) {
                const amount = item.amount || {};
                if (String(amount.currency || "").toLowerCase() === "usd") total += Number(amount.value || 0);
              }
            }
            result.openai.cost31dUsd = total;
            result.openai.costAvailable = true;
          }
        } catch {}
      }
    }

    if (direct.railway) {
      const token = await railwayAccessTokenFor(client.id);
      if (token) {
        try {
          const response = await fetch("https://backboard.railway.com/graphql/v2", {
            method: "POST",
            headers: {
              authorization: "Bearer " + token,
              "content-type": "application/json"
            },
            body: JSON.stringify({
              query: "query { projects { edges { node { id name } } } }"
            })
          });
          if (response.ok) {
            const payload = await response.json();
            const projects = payload?.data?.projects?.edges || [];
            result.railway.projects = projects.map(item => ({
              id: item?.node?.id || "",
              name: item?.node?.name || ""
            })).filter(item => item.id);
            result.railway.projectCount = result.railway.projects.length;
          }
        } catch {}
      }
    }

    return send(res, 200, result);
  }

  const agentOpenAIImageMatch = url.pathname.match(/^\/api\/agent\/([^/]+)\/openai\/images$/);
  if (agentOpenAIImageMatch && req.method === "POST") {
    const clientId = agentOpenAIImageMatch[1];
    if (!agentBearerAuthorized(req, clientId)) {
      return send(res, 401, { error: "unauthorized" });
    }

    const record = directConnection(clientId, "openai");
    const apiKey = decryptSecret(record?.apiKey || "");
    if (!apiKey) {
      return send(res, 409, { error: "openai_not_connected" });
    }

    const body = await readBody(req);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 32000) : "";
    if (!prompt) return send(res, 400, { error: "prompt_required" });

    const allowedModels = new Set([
      "gpt-image-2.5-sunburst",
      "gpt-image-2.5-flare",
      "gpt-image-2",
      "gpt-image-1.5",
      "gpt-image-1"
    ]);
    const allowedSizes = new Set(["auto", "1024x1024", "1024x1536", "1536x1024"]);
    const allowedQualities = new Set(["auto", "low", "medium", "high", "xhigh", "max"]);

    const model = allowedModels.has(String(body.model || "")) ? String(body.model) : "gpt-image-2.5-flare";
    const size = allowedSizes.has(String(body.size || "")) ? String(body.size) : "1024x1536";
    const quality = allowedQualities.has(String(body.quality || "")) ? String(body.quality) : "medium";

    try {
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          authorization: "Bearer " + apiKey,
          "content-type": "application/json",
          "user-agent": "NEXUS-AI-Agent-Proxy/1.0"
        },
        body: JSON.stringify({ model, prompt, size, quality })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = payload?.error?.code || payload?.error?.type || "openai_image_failed";
        return send(res, response.status, { error: String(code) });
      }

      const encoded = payload?.data?.[0]?.b64_json;
      if (!encoded) return send(res, 502, { error: "image_data_missing" });
      return send(res, 200, { b64_json: encoded, model });
    } catch {
      return send(res, 502, { error: "openai_unavailable" });
    }
  }

  const agentConfigMatch = url.pathname.match(/^\/api\/agent-config\/([^/]+)$/);
  if (agentConfigMatch && req.method === "GET") {
    const clientId = agentConfigMatch[1];
    if (!agentBearerAuthorized(req, clientId)) {
      return send(res, 401, { error: "unauthorized" });
    }
    const client = loadClients().find(item => item.id === clientId);
    if (!client) return send(res, 404, { error: "not_found" });
    const view = clientPortalView(client);
    return send(res, 200, {
      id: view.id,
      name: view.name,
      niche: view.niche,
      instagram: view.instagram,
      primaryColor: view.primaryColor,
      secondaryColor: view.secondaryColor,
      postTimes: view.postTimes,
      postingProfile: view.postingProfile
    });
  }

  if (url.pathname === "/api/portal/settings" && req.method === "PATCH") {
    const sessionClient = portalClientForRequest(req);
    if (!sessionClient) {
      return send(res, 401, { error: "unauthorized" });
    }

    const body = await readBody(req);
    const clients = loadClients();
    const client = clients.find(item => item.id === sessionClient.id);
    if (!client) return send(res, 404, { error: "not_found" });

    const textValue = (value, fallback = "", max = 500) =>
      typeof value === "string" ? value.trim().slice(0, max) : fallback;
    const colorValue = (value, fallback) =>
      typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
    const timeValues = (value, fallback) => {
      if (!Array.isArray(value)) return fallback;
      const valid = [...new Set(value.map(String).filter(item => /^([01]\\d|2[0-3]):[0-5]\\d$/.test(item)))].sort();
      return valid.length ? valid.slice(0, 6) : fallback;
    };

    client.niche = textValue(body.niche, client.niche || "Outro", 80);
    client.primaryColor = colorValue(body.primaryColor, client.primaryColor || "#22c55e");
    client.secondaryColor = colorValue(body.secondaryColor, client.secondaryColor || "#050807");
    client.postTimes = timeValues(body.postTimes, client.postTimes || ["09:00", "12:00", "18:00"]);

    const defaults = defaultPostingProfile();
    const current = { ...defaults, ...(client.postingProfile || {}) };
    const incoming = body.postingProfile && typeof body.postingProfile === "object" ? body.postingProfile : {};
    client.postingProfile = {
      contentStrategy: textValue(incoming.contentStrategy, current.contentStrategy, 100),
      targetAudience: textValue(incoming.targetAudience, current.targetAudience, 100),
      visualStyle: textValue(incoming.visualStyle, current.visualStyle, 100),
      contentFocus: textValue(incoming.contentFocus, current.contentFocus, 400),
      morningTheme: textValue(incoming.morningTheme, current.morningTheme, 250),
      afternoonTheme: textValue(incoming.afternoonTheme, current.afternoonTheme, 250),
      eveningTheme: textValue(incoming.eveningTheme, current.eveningTheme, 250),
      tone: textValue(incoming.tone, current.tone, 180),
      cta: textValue(incoming.cta, current.cta, 180),
      hashtags: textValue(incoming.hashtags, current.hashtags, 350),
      avoidTopics: textValue(incoming.avoidTopics, current.avoidTopics, 500)
    };

    saveClients(clients);
    return send(res, 200, clientPortalView(client));
  }

  if (url.pathname === "/api/portal/onboarding" && req.method === "PATCH") {
    const sessionClient = portalClientForRequest(req);
    if (!sessionClient) {
      return send(res, 401, { error: "unauthorized" });
    }
    const body = await readBody(req);
    const clients = loadClients();
    const client = clients.find(item => item.id === sessionClient.id);
    if (!client) return send(res, 404, { error: "not_found" });

    const allowedSteps = ["github","railway","openai","facebook","instagram","metaApp","creativeProfile","supportRequested"];
    const current = client.onboarding && typeof client.onboarding === "object" ? client.onboarding : {};
    for (const step of allowedSteps) {
      if (Object.prototype.hasOwnProperty.call(body, step)) current[step] = Boolean(body[step]);
    }
    client.onboarding = current;
    if (body.setupMode === "new" || body.setupMode === "ready") client.setupMode = body.setupMode;
    saveClients(clients);
    return send(res, 200, clientPortalView(client));
  }

  if (url.pathname === "/api/portal/live-status" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) {
      return send(res, 401, { error: "unauthorized" });
    }

    const base = String(client.agentApiUrl || "").replace(/\/+$/, "");
    if (!base) return send(res, 200, { connected: false, reason: "agent_url_missing" });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const token = String(process.env.RAGNAR_AGENT_TOKEN || "");
      const response = await fetch(base + "/nexus/status", {
        headers: {
          "accept": "application/json",
          "user-agent": "NEXUS-AI-Control-Center/1.0",
          ...(token ? { authorization: "Bearer " + token } : {})
        },
        signal: controller.signal
      });
      if (!response.ok) return send(res, 200, { connected: false, reason: "agent_http_" + response.status });
      const payload = await response.json();
      return send(res, 200, { connected: true, ...payload });
    } catch (error) {
      return send(res, 200, { connected: false, reason: "agent_unavailable" });
    } finally {
      clearTimeout(timer);
    }
  }

  // Public entry always belongs to the client portal.
  if (url.pathname === "/" && req.method === "GET") {
    res.writeHead(302, {
      location: "/portal.html?v=21",
      "cache-control": "no-store",
      "content-length": "0"
    });
    return res.end();
  }

  // Master dashboard is never exposed on a client-branded hostname.
  const requestHost = String(req.headers.host || "").split(":")[0].toLowerCase();
  if (
    requestHost === "painel.ragnarplay.online"
    && (url.pathname === "/master" || url.pathname === "/master/" || url.pathname === "/index.html")
  ) {
    return send(res, 404, "Not found", "text/plain; charset=utf-8");
  }

  // Master dashboard is never public. Both the friendly route and the
  // underlying index.html require the administrator credentials.
  if ((url.pathname === "/master" || url.pathname === "/master/" || url.pathname === "/index.html") && req.method === "GET") {
    if (!authorized(req)) {
      res.setHeader("WWW-Authenticate", 'Basic realm="NEXUS AI Master"');
      return send(res, 401, "Acesso administrativo", "text/plain; charset=utf-8");
    }
    const masterFile = path.join(__dirname, "public", "index.html");
    return send(res, 200, fs.readFileSync(masterFile), "text/html; charset=utf-8");
  }

  if (url.pathname.startsWith("/api/") && !authorized(req)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="NEXUS AI Agent Central"');
    return send(res, 401, { error: "unauthorized" });
  }

  if (url.pathname === "/api/clients" && req.method === "GET") {
    return send(res, 200, loadClients());
  }

  if (url.pathname === "/api/clients" && req.method === "POST") {
    const body = await readBody(req);
    const clients = loadClients();
    let id = slug(body.id || body.name || "cliente");
    if (!id) id = crypto.randomUUID();
    if (clients.some(c => c.id === id)) id += "-" + String(Date.now()).slice(-5);

    const client = {
      id,
      name: body.name || "Novo cliente",
      niche: body.niche || "Outro",
      instagram: body.instagram || "",
      theme: body.theme || "green-black",
      primaryColor: body.primaryColor || "#18c96e",
      secondaryColor: body.secondaryColor || "#07140c",
      status: "setup",
      github: "",
      railway: "",
      openai: "pending",
      meta: "pending",
      odin: true,
      postTimes: ["09:00", "12:00", "18:00"],
      leads: { total: 0, hot: 0, warm: 0, cold: 0 },
      usage: { openaiPercent: 0, railwayPercent: 0 },
      onboarding: {
        github: false, railway: false, openai: false,
        instagram: false, facebook: false, metaApp: false
      },
      postingProfile: defaultPostingProfile(),
      setupMode: "new",
      agentApiUrl: ""
    };

    const existingUsers = loadPortalUsers();
    const takenUsernames = new Set([
      ...portalAccounts().map(item => String(item.username || "").toLowerCase()),
      ...Object.values(existingUsers).map(item => String(item?.username || "").toLowerCase())
    ]);
    let portalUsername = slug(body.username || id).replace(/-/g, ".") || id;
    const baseUsername = portalUsername;
    let suffix = 2;
    while (takenUsernames.has(portalUsername.toLowerCase())) {
      portalUsername = baseUsername + suffix;
      suffix += 1;
    }

    const initialPassword = String(body.password || "").trim()
      || crypto.randomBytes(12).toString("base64url");
    if (initialPassword.length < 8) {
      return send(res, 400, { error: "portal_password_too_short" });
    }

    clients.push(client);
    saveClients(clients);

    existingUsers[id] = {
      username: portalUsername,
      ...createPortalPasswordRecord(initialPassword),
      createdAt: new Date().toISOString()
    };
    savePortalUsers(existingUsers);

    return send(res, 201, {
      client,
      portalCredentials: {
        username: portalUsername,
        initialPassword,
        portalPath: "/"
      }
    });
  }

  const clientMatch = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (clientMatch && req.method === "PATCH") {
    const body = await readBody(req);
    const clients = loadClients();
    const client = clients.find(c => c.id === clientMatch[1]);
    if (!client) return send(res, 404, { error: "not_found" });

    const allowed = [
      "name","niche","instagram","theme","primaryColor","secondaryColor",
      "status","github","railway","openai","meta","odin","postTimes",
      "leads","usage","onboarding","agentApiUrl","setupMode"
    ];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, key)) client[key] = body[key];
    }
    saveClients(clients);
    return send(res, 200, client);
  }

  if (url.pathname === "/api/system/status" && req.method === "GET") {
    return send(res, 200, {
      githubConfigured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      railwayConfigured: Boolean(process.env.RAILWAY_API_TOKEN),
      openaiAdminConfigured: Boolean(process.env.OPENAI_ADMIN_KEY),
      clientPortalConfigured: portalAccounts().length > 0,
      metaMode: "manual-assisted",
      note: "A versão 1 organiza o onboarding e a administração. OAuth automático entra na próxima etapa."
    });
  }

  let requested = url.pathname;
  requested = path.normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const publicRoot = path.join(__dirname, "public");
  const target = path.join(publicRoot, requested);

  if (!target.startsWith(publicRoot) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    return send(res, 404, "Not found", "text/plain; charset=utf-8");
  }

  const ext = path.extname(target).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  };
  return send(res, 200, fs.readFileSync(target), types[ext] || "application/octet-stream");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NEXUS AI Agent Central listening on ${PORT}`);
});
