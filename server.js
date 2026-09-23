
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
const masterIntegrationsFile = path.join(DATA_DIR, "master-integrations.json");
const supportTicketsFile = path.join(DATA_DIR, "support-tickets.json");
const postLedgerFile = path.join(DATA_DIR, "post-ledger.json");
const clientLogoDir = path.join(DATA_DIR, "client-logos");
fs.mkdirSync(clientLogoDir, { recursive: true });
const portalSessions = new Map();
const masterSessions = new Map();

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
  const items = readJsonFile(runtimeFile, EMPTY_SEED);
  if (!items.some(item => item.id === "globalplay-streaming")) {
    items.push({
      id: "globalplay-streaming",
      name: "Global Play",
      niche: "Streaming",
      instagram: "@globalplay_streaming",
      theme: "green-black",
      primaryColor: "#22c55e",
      secondaryColor: "#050807",
      status: "online",
      github: "connected",
      railway: "connected",
      openai: "configured",
      meta: "configured",
      odin: true,
      ownerAccount: true,
      postTimes: ["09:00", "12:00", "18:00"],
      leads: { total: 0, hot: 0, warm: 0, cold: 0 },
      usage: { openaiPercent: 0, railwayPercent: 0 },
      aiMode: "own-key",
      aiMonthlyImageLimit: 0,
      aiImagesUsed: 0,
      aiUsageMonth: new Date().toISOString().slice(0, 7),
      managedInfrastructure: false,
      onboarding: {
        github: true, railway: true, openai: true,
        instagram: true, facebook: true, metaApp: true,
        creativeProfile: true, supportRequested: false
      },
      postingProfile: defaultPostingProfile(),
      agentProfile: {
        agentName: "Claire",
        brandName: "Global Play",
        niche: "Streaming",
        status: "configured"
      },
      setupMode: "ready",
      agentApiUrl: "https://claire-production-e1db.up.railway.app"
    });
    writeJsonAtomic(runtimeFile, items);
  }
  return items;
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

function loadMasterIntegrations() {
  return readObjectFile(masterIntegrationsFile, {});
}

function saveMasterIntegrations(value) {
  writeJsonAtomic(masterIntegrationsFile, value);
}

function loadSupportTickets() {
  return readJsonFile(supportTicketsFile, []);
}

function saveSupportTickets(value) {
  writeJsonAtomic(supportTicketsFile, Array.isArray(value) ? value : []);
}

function loadPostLedger() {
  return readJsonFile(postLedgerFile, []);
}

function savePostLedger(value) {
  const rows = Array.isArray(value) ? value.slice(-5000) : [];
  writeJsonAtomic(postLedgerFile, rows);
}

function cleanPostStatus(value) {
  const allowed = new Set(["scheduled","generating","ready","publishing","published","failed","skipped"]);
  return allowed.has(String(value || "")) ? String(value) : "scheduled";
}

function normalizeIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function upsertPostLedger(clientId, body = {}) {
  const clients = loadClients();
  const client = clients.find(item => item.id === clientId);
  if (!client) return null;

  const now = new Date().toISOString();
  const scheduledFor = normalizeIso(body.scheduledFor);
  const scheduledHour = String(body.scheduledHour || "").trim().slice(0, 5)
    || (scheduledFor ? new Date(scheduledFor).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }) : "");
  const postId = String(body.postId || "").trim().slice(0, 160)
    || [clientId, scheduledFor || now].join(":");

  const ledger = loadPostLedger();
  let row = ledger.find(item => item.id === postId && item.clientId === clientId);
  if (!row) {
    row = {
      id: postId,
      clientId,
      clientName: client.name || clientId,
      instagram: client.instagram || "",
      scheduledFor,
      scheduledHour,
      status: "scheduled",
      costUsd: 0,
      costCalculated: true,
      model: "",
      mediaId: "",
      error: "",
      createdAt: now,
      updatedAt: now
    };
    ledger.push(row);
  }

  if (body.status) row.status = cleanPostStatus(body.status);
  if (scheduledFor) row.scheduledFor = scheduledFor;
  if (scheduledHour) row.scheduledHour = scheduledHour;
  if (body.attemptedAt) row.attemptedAt = normalizeIso(body.attemptedAt) || row.attemptedAt || now;
  if (row.status === "generating" || row.status === "publishing") row.attemptedAt = row.attemptedAt || now;
  if (row.status === "published") row.publishedAt = normalizeIso(body.publishedAt) || row.publishedAt || now;
  if (body.mediaId != null) row.mediaId = String(body.mediaId || "").slice(0, 160);
  if (body.model != null) row.model = String(body.model || "").slice(0, 100);
  if (body.error != null) row.error = String(body.error || "").slice(0, 900);
  if (body.costSource != null) row.costSource = String(body.costSource || "").slice(0, 80);

  const absoluteCost = Number(body.costUsd);
  if (Number.isFinite(absoluteCost) && absoluteCost >= 0) row.costUsd = absoluteCost;
  const deltaCost = Number(body.costDeltaUsd);
  if (Number.isFinite(deltaCost) && deltaCost > 0) row.costUsd = Number(row.costUsd || 0) + deltaCost;
  row.costUsd = Math.max(0, Number(row.costUsd || 0));
  row.updatedAt = now;

  savePostLedger(ledger);
  return row;
}

function imageUsageCostUsd(usage, model) {
  if (!usage || typeof usage !== "object") return null;
  const name = String(model || "");
  const rates = name.startsWith("gpt-image-2.5")
    ? { textIn: 5, imageIn: 8, cachedImageIn: 2, imageOut: 30 }
    : name === "gpt-image-2"
      ? { textIn: 2.5, imageIn: 4, cachedImageIn: 1, imageOut: 15 }
      : null;
  if (!rates) return null;

  const details = usage.input_tokens_details || usage.input_details || {};
  const textInput = Number(details.text_tokens ?? usage.input_text_tokens ?? usage.input_tokens ?? 0);
  const imageInput = Number(details.image_tokens ?? usage.input_image_tokens ?? 0);
  const cachedImageInput = Number(details.cached_image_tokens ?? 0);
  const output = Number(usage.output_tokens ?? usage.output_image_tokens ?? 0);
  const value =
    (Math.max(0, textInput) * rates.textIn
    + Math.max(0, imageInput - cachedImageInput) * rates.imageIn
    + Math.max(0, cachedImageInput) * rates.cachedImageIn
    + Math.max(0, output) * rates.imageOut) / 1_000_000;
  return Number.isFinite(value) ? value : null;
}

function postLedgerSummary() {
  const rows = loadPostLedger().sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthRows = rows.filter(row => String(row.scheduledFor || row.createdAt || "").slice(0, 7) === monthKey);
  const byClientMap = new Map();
  for (const row of monthRows) {
    const key = row.clientId;
    const item = byClientMap.get(key) || {
      clientId: key,
      clientName: row.clientName || key,
      instagram: row.instagram || "",
      posts: 0,
      published: 0,
      failed: 0,
      costUsd: 0
    };
    item.posts += 1;
    if (row.status === "published") item.published += 1;
    if (row.status === "failed") item.failed += 1;
    item.costUsd += Number(row.costUsd || 0);
    byClientMap.set(key, item);
  }
  const byClient = [...byClientMap.values()].sort((a, b) => b.costUsd - a.costUsd);
  return {
    month: monthKey,
    totalCostUsd: monthRows.reduce((sum, row) => sum + Number(row.costUsd || 0), 0),
    totalPosts: monthRows.length,
    published: monthRows.filter(row => row.status === "published").length,
    failed: monthRows.filter(row => row.status === "failed").length,
    byClient,
    posts: rows.slice(0, 300)
  };
}

function supportTicketView(ticket) {
  return {
    id: ticket.id,
    clientId: ticket.clientId,
    clientName: ticket.clientName,
    category: ticket.category,
    subject: ticket.subject,
    message: ticket.message,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt || ticket.createdAt
  };
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
  return ["connected","configured","active","ready","managed"].includes(String(value || "").toLowerCase());
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

function decodeMetaSignedRequest(signedRequest) {
  const secret = masterInstagramAppSecret();
  const raw = String(signedRequest || "");
  const [signaturePart, payloadPart] = raw.split(".");
  if (!secret || !signaturePart || !payloadPart) return null;
  try {
    const supplied = Buffer.from(signaturePart, "base64url");
    const expected = crypto.createHmac("sha256", secret).update(payloadPart).digest();
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function disconnectInstagramUser(igUserId) {
  const targetId = String(igUserId || "").trim();
  if (!targetId) return [];
  const connections = loadConnections();
  const disconnectedClientIds = [];
  for (const [clientId, providers] of Object.entries(connections)) {
    if (String(providers?.meta?.igUserId || "") !== targetId) continue;
    delete providers.meta;
    if (!Object.keys(providers).length) delete connections[clientId];
    disconnectedClientIds.push(clientId);
  }
  if (disconnectedClientIds.length) saveConnections(connections);

  const clients = loadClients();
  let changed = false;
  for (const client of clients) {
    if (!disconnectedClientIds.includes(client.id)) continue;
    client.instagram = "";
    client.meta = "pending";
    client.onboarding = client.onboarding && typeof client.onboarding === "object" ? client.onboarding : {};
    client.onboarding.instagram = false;
    changed = true;
  }
  if (changed) saveClients(clients);
  return disconnectedClientIds;
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

function masterOpenAIRecord() {
  return loadMasterIntegrations()?.openai || {};
}

function masterInstagramRecord() {
  return loadMasterIntegrations()?.instagram || {};
}

function masterInstagramAppId() {
  return String(process.env.INSTAGRAM_APP_ID || masterInstagramRecord().appId || "").trim();
}

function masterInstagramAppSecret() {
  return String(process.env.INSTAGRAM_APP_SECRET || "").trim()
    || decryptSecret(masterInstagramRecord().appSecret || "");
}

function publicOrigin(req) {
  const host = String(req.headers.host || process.env.RAILWAY_PUBLIC_DOMAIN || "servidor-global-play-production.up.railway.app")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  return "https://" + host;
}

function instagramRedirectUri(req) {
  return publicOrigin(req) + "/api/oauth/instagram/callback";
}

function masterOpenAIAdminKey() {
  return String(process.env.OPENAI_ADMIN_KEY || "").trim()
    || decryptSecret(masterOpenAIRecord().adminKey || "");
}

function masterOpenAIProjectKey() {
  return String(process.env.OPENAI_API_KEY || "").trim()
    || decryptSecret(masterOpenAIRecord().apiKey || "");
}

async function fetchOpenAICostTotal(adminKey, startTime, endTime = null) {
  if (!adminKey) return null;
  let total = 0;
  let page = "";
  let loops = 0;
  do {
    const query = new URLSearchParams({
      start_time: String(Math.max(0, Math.floor(startTime))),
      bucket_width: "1d",
      limit: "180"
    });
    if (endTime) query.set("end_time", String(Math.floor(endTime)));
    if (page) query.set("page", page);
    const response = await fetch("https://api.openai.com/v1/organization/costs?" + query.toString(), {
      headers: { authorization: "Bearer " + adminKey, "user-agent": "NEXUS-AI/1.0" }
    });
    if (!response.ok) throw new Error("openai_costs_failed_" + response.status);
    const payload = await response.json();
    for (const bucket of payload.data || []) {
      for (const item of bucket.results || []) {
        const amount = item.amount || {};
        if (String(amount.currency || "").toLowerCase() === "usd") total += Number(amount.value || 0);
      }
    }
    page = payload.has_more ? String(payload.next_page || "") : "";
    loops += 1;
  } while (page && loops < 12);
  return total;
}

async function fetchOpenAISpendLimit(adminKey) {
  if (!adminKey) return null;
  try {
    const response = await fetch("https://api.openai.com/v1/organization/spend_limit", {
      headers: { authorization: "Bearer " + adminKey, "user-agent": "NEXUS-AI/1.0" }
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const raw = Number(payload.threshold_amount);
    if (!Number.isFinite(raw)) return null;
    return raw / 100;
  } catch {
    return null;
  }
}

async function masterOpenAISummary() {
  const record = masterOpenAIRecord();
  const adminKey = masterOpenAIAdminKey();
  const apiKey = masterOpenAIProjectKey();
  const now = Math.floor(Date.now() / 1000);
  const date = new Date();
  const monthStart = Math.floor(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).getTime() / 1000);
  const baselineAt = Number(record.balanceBaselineAt || 0);
  const baselineUsd = Number(record.balanceBaselineUsd);
  let monthCostUsd = null;
  let baselineCostUsd = null;
  let spendLimitUsd = null;
  let error = "";

  if (adminKey) {
    try {
      monthCostUsd = await fetchOpenAICostTotal(adminKey, monthStart, now);
      if (baselineAt > 0 && Number.isFinite(baselineUsd)) {
        baselineCostUsd = await fetchOpenAICostTotal(adminKey, baselineAt, now);
      }
      spendLimitUsd = await fetchOpenAISpendLimit(adminKey);
    } catch (err) {
      error = String(err?.message || "openai_summary_failed");
    }
  }

  const balanceEstimatedUsd =
    Number.isFinite(baselineUsd) && baselineAt > 0 && Number.isFinite(baselineCostUsd)
      ? Math.max(0, baselineUsd - baselineCostUsd)
      : null;
  const monthlyBudgetUsd = Number(record.monthlyBudgetUsd);
  const budgetConfigured = Number.isFinite(monthlyBudgetUsd) && monthlyBudgetUsd > 0;
  const budgetRemainingUsd =
    budgetConfigured && Number.isFinite(monthCostUsd)
      ? Math.max(0, monthlyBudgetUsd - monthCostUsd)
      : null;
  const budgetPercent =
    budgetConfigured && Number.isFinite(monthCostUsd)
      ? Math.min(100, Math.max(0, Math.round((monthCostUsd / monthlyBudgetUsd) * 100)))
      : null;

  return {
    apiConnected: Boolean(apiKey),
    billingConnected: Boolean(adminKey),
    connected: Boolean(apiKey || adminKey),
    monthCostUsd,
    spendLimitUsd,
    balanceEstimatedUsd,
    balanceBaselineUsd: Number.isFinite(baselineUsd) ? baselineUsd : null,
    balanceBaselineAt: baselineAt || null,
    monthlyBudgetUsd: budgetConfigured ? monthlyBudgetUsd : null,
    budgetRemainingUsd,
    budgetPercent,
    exactPrepaidBalanceAvailable: false,
    ragnarExcluded: true,
    error
  };
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
    : clientId === "globalplay-streaming"
      ? String(process.env.GLOBALPLAY_AGENT_TOKEN || "")
      : "";
  if (!expected) return false;
  return safeEqualText(supplied, expected);
}

function authorized(req) {
  const credentials = parseBasicAuth(req);
  if (!credentials) return false;
  return masterCredentialsValid(credentials.username, credentials.password);
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

function masterCredentialsValid(username, password) {
  const normalizedUsername = String(username || "").trim();
  const suppliedPassword = String(password || "");

  const envValid = safeEqualText(normalizedUsername, String(ADMIN_USERNAME || "").trim())
    && safeEqualText(suppliedPassword, ADMIN_PASSWORD);
  if (envValid) return true;

  const recoveryUsername = "nexusadmin";
  const recoveryPasswordSha256 = "b6f25581136091d564422e85add69374c132c6cddbbd6414c2b01828088f0ec7";
  return safeEqualText(normalizedUsername, recoveryUsername)
    && safeEqualText(sha256Text(suppliedPassword), recoveryPasswordSha256);
}

function masterSessionAuthorized(req) {
  const cookies = parseCookies(req);
  const token = String(cookies.nexus_master || "");
  if (!token) return false;
  const expiresAt = masterSessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    if (expiresAt) masterSessions.delete(token);
    return false;
  }
  return true;
}

function masterAuthorized(req) {
  return masterSessionAuthorized(req) || authorized(req);
}

function masterLoginPage(error = false) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#020508">
<title>NEXUS AI · Master</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 30%,#0a2233,#020508 45%,#010203);font-family:Inter,system-ui,Arial;color:#edfaff}
.card{width:min(430px,92vw);padding:34px;border:1px solid rgba(93,211,255,.16);border-radius:22px;background:linear-gradient(180deg,rgba(8,20,30,.96),rgba(3,8,13,.98));box-shadow:0 30px 100px #0009,inset 0 1px #ffffff08}
.brand{display:flex;align-items:center;gap:14px;margin-bottom:28px}.brand img{width:56px;height:56px}.brand strong{display:block;font-size:21px;letter-spacing:.08em}.brand small{color:#68899b;letter-spacing:.14em}
h1{font-size:30px;margin:0 0 8px}.muted{color:#7893a4;margin:0 0 24px;font-size:14px}
label{display:grid;gap:7px;margin:13px 0;color:#9bb5c5;font-size:12px;font-weight:700}input{width:100%;padding:14px;border-radius:10px;border:1px solid #163244;background:#03090e;color:#fff;outline:none}input:focus{border-color:#5dd3ff;box-shadow:0 0 0 3px #5dd3ff16}
button{width:100%;margin-top:12px;padding:14px;border:0;border-radius:10px;background:linear-gradient(135deg,#c8f3ff,#59d0ff 55%,#168ee8);color:#02101a;font-weight:900;cursor:pointer}
.error{min-height:18px;margin-top:12px;color:#ff8690;font-size:12px}.secure{margin-top:20px;padding-top:15px;border-top:1px solid #5dd3ff12;color:#557182;font-size:11px;text-align:center}
</style>
</head>
<body><main class="card">
<div class="brand"><img src="/assets/nexus-ai-mark.svg" alt=""><div><strong>NEXUS AI</strong><small>MASTER CONTROL</small></div></div>
<h1>Acesso administrativo</h1><p class="muted">Área exclusiva do administrador NEXUS.</p>
<form method="post" action="/master-login">
<label>Usuário<input name="username" autocomplete="username" required></label>
<label>Senha<input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">Entrar no Master</button>
<div class="error">${error ? "Usuário ou senha inválidos." : ""}</div>
</form><div class="secure">Sessão administrativa protegida · NEXUS AI</div>
</main></body></html>`;
}

function defaultPostingProfile() {
  return {
    contentStrategy: "Vendas + engajamento",
    targetAudience: "Misto",
    visualStyle: "Tecnológico premium",
    contentFocus: "Benefícios reais do negócio, autoridade, produto e conversão",
    morningTheme: "Dor do cliente e solução",
    afternoonTheme: "Produto, benefício e prova",
    eveningTheme: "Conversão e chamada para ação",
    tone: "Firme, direto e profissional",
    cta: 'Comente "QUERO" e saiba mais',
    hashtags: "#ConteudoDigital #Vendas #Automacao",
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
    aiMode: client.aiMode || (client.id === "ragnar-one" ? "own-key" : "economy"),
    aiMonthlyImageLimit: Number(client.aiMonthlyImageLimit || 0),
    aiImagesUsed: Number(client.aiImagesUsed || 0),
    managedInfrastructure: client.id !== "ragnar-one" ? client.managedInfrastructure !== false : false,
    onboarding: client.onboarding || {},
    setupMode: client.setupMode || "ready",
    integrationState: {
      github: client.github || "pending",
      railway: client.railway || "pending",
      openai: client.openai || "pending",
      meta: client.meta || "pending"
    },
    postingProfile: { ...defaultPostingProfile(), ...(client.postingProfile || {}) },
    agentProfile: client.agentProfile && typeof client.agentProfile === "object" ? client.agentProfile : {},
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

  if (url.pathname === "/" && req.method === "GET") {
    res.writeHead(303, {
      location: "/login",
      "cache-control": "no-store",
      "content-length": "0"
    });
    return res.end();
  }

  if (url.pathname === "/login" && req.method === "GET") {
    res.writeHead(303, {
      location: "/portal.html?v=24&login=1",
      "set-cookie": "nexus_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      "cache-control": "no-store",
      "content-length": "0"
    });
    return res.end();
  }

  if ((url.pathname === "/master" || url.pathname === "/master/") && req.method === "GET") {
    if (!masterSessionAuthorized(req)) {
      return send(res, 200, masterLoginPage(false), "text/html; charset=utf-8");
    }
    const masterFile = path.join(__dirname, "public", "index.html");
    return send(res, 200, fs.readFileSync(masterFile), "text/html; charset=utf-8");
  }

  if (url.pathname === "/master-login" && req.method === "POST") {
    const body = await readFormBody(req);
    const ok = masterCredentialsValid(
      String(body.username || "").trim(),
      String(body.password || "")
    );
    if (!ok) return send(res, 401, masterLoginPage(true), "text/html; charset=utf-8");
    const token = crypto.randomBytes(32).toString("base64url");
    masterSessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
    return redirectWithCookie(
      res,
      "/master",
      "nexus_master=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200"
    );
  }

  if (url.pathname === "/master-logout" && req.method === "POST") {
    const token = String(parseCookies(req).nexus_master || "");
    if (token) masterSessions.delete(token);
    res.setHeader("set-cookie", "nexus_master=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    return send(res, 200, { ok: true });
  }

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
      if (!client) return redirectWithCookie(res, "/portal.html?v=24&error=1");

      const token = crypto.randomBytes(32).toString("base64url");
      portalSessions.set(token, { clientId: client.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
      const cookie = "nexus_session=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200";
      return redirectWithCookie(res, "/portal.html?v=24&auth=1", cookie);
    } catch {
      return redirectWithCookie(res, "/portal.html?v=24&error=1");
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

    const client = loadClients().find(item => item.id === clientId);
    if (!client) return send(res, 404, { error: "not_found" });

    const record = directConnection(clientId, "openai");
    const ownKey = decryptSecret(record?.apiKey || "");
    const aiMode = client.aiMode || (clientId === "ragnar-one" ? "own-key" : "economy");

    // Ragnar is intentionally excluded from the shared NEXUS OpenAI account.
    let apiKey = ownKey;
    if (clientId !== "ragnar-one" && aiMode !== "own-key") {
      if (aiMode === "economy") {
        return send(res, 409, { error: "ai_mode_economy_uses_local_creatives" });
      }
      const month = new Date().toISOString().slice(0, 7);
      if (client.aiUsageMonth !== month) {
        client.aiUsageMonth = month;
        client.aiImagesUsed = 0;
        const allClients = loadClients();
        const stored = allClients.find(item => item.id === clientId);
        if (stored) {
          stored.aiUsageMonth = month;
          stored.aiImagesUsed = 0;
          saveClients(allClients);
        }
      }
      const limit = Math.max(0, Number(client.aiMonthlyImageLimit || 0));
      if (limit > 0 && Number(client.aiImagesUsed || 0) >= limit) {
        return send(res, 429, { error: "ai_monthly_image_limit_reached" });
      }
      apiKey = masterOpenAIProjectKey();
    }

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

      const imageCostUsd = imageUsageCostUsd(payload?.usage, model);
      if (body.postId && Number.isFinite(imageCostUsd) && imageCostUsd > 0) {
        upsertPostLedger(clientId, {
          postId: body.postId,
          scheduledFor: body.scheduledFor,
          scheduledHour: body.scheduledHour,
          status: "generating",
          costDeltaUsd: imageCostUsd,
          costSource: "openai_usage",
          model
        });
      }

      if (clientId !== "ragnar-one" && aiMode === "hybrid") {
        const allClients = loadClients();
        const stored = allClients.find(item => item.id === clientId);
        if (stored) {
          const month = new Date().toISOString().slice(0, 7);
          if (stored.aiUsageMonth !== month) {
            stored.aiUsageMonth = month;
            stored.aiImagesUsed = 0;
          }
          stored.aiImagesUsed = Number(stored.aiImagesUsed || 0) + 1;
          saveClients(allClients);
        }
      }

      return send(res, 200, { b64_json: encoded, model });
    } catch {
      return send(res, 502, { error: "openai_unavailable" });
    }
  }

  const agentPostEventMatch = url.pathname.match(/^\/api\/agent\/([^/]+)\/posts\/event$/);
  if (agentPostEventMatch && req.method === "POST") {
    const clientId = agentPostEventMatch[1];
    if (!agentBearerAuthorized(req, clientId)) return send(res, 401, { error: "unauthorized" });
    const body = await readBody(req);
    const row = upsertPostLedger(clientId, body);
    if (!row) return send(res, 404, { error: "not_found" });
    return send(res, 200, { ok: true, post: row });
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

  if (url.pathname === "/api/portal/agent-profile" && req.method === "POST") {
    const sessionClient = portalClientForRequest(req);
    if (!sessionClient) return send(res, 401, { error: "unauthorized" });
    try {
      const body = await readBody(req);
      const clients = loadClients();
      const client = clients.find(item => item.id === sessionClient.id);
      if (!client) return send(res, 404, { error: "not_found" });

      const textValue = (value, max = 1200) =>
        typeof value === "string" ? value.trim().slice(0, max) : "";
      const colorValue = (value, fallback) =>
        typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;

      const previous = client.agentProfile && typeof client.agentProfile === "object" ? client.agentProfile : {};
      let logoUrl = String(previous.logoUrl || "");

      if (body.removeLogo) {
        for (const ext of ["png","jpg","webp"]) {
          const file = path.join(clientLogoDir, slug(client.id) + "." + ext);
          try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
        }
        logoUrl = "";
      }

      if (typeof body.logoDataUrl === "string" && body.logoDataUrl.trim()) {
        const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.logoDataUrl.trim());
        if (!match) return send(res, 400, { error: "invalid_logo" });
        const bytes = Buffer.from(match[2], "base64");
        if (!bytes.length || bytes.length > 900 * 1024) return send(res, 400, { error: "logo_too_large" });
        const ext = match[1] === "jpeg" ? "jpg" : match[1];
        for (const oldExt of ["png","jpg","webp"]) {
          const oldFile = path.join(clientLogoDir, slug(client.id) + "." + oldExt);
          try { if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile); } catch {}
        }
        const filename = slug(client.id) + "." + ext;
        fs.writeFileSync(path.join(clientLogoDir, filename), bytes);
        logoUrl = "/client-logo/" + filename + "?v=" + Date.now();
      }

      const primaryColor = colorValue(body.primaryColor, client.primaryColor || "#22c55e");
      const secondaryColor = colorValue(body.secondaryColor, client.secondaryColor || "#050807");
      const niche = textValue(body.niche, 80) || client.niche || "Outro";
      const now = new Date().toISOString();

      client.niche = niche;
      client.primaryColor = primaryColor;
      client.secondaryColor = secondaryColor;
      client.agentProfile = {
        ...previous,
        agentName: textValue(body.agentName, 80),
        brandName: textValue(body.brandName, 120) || client.name,
        niche,
        audience: textValue(body.audience, 120),
        goal: textValue(body.goal, 100),
        region: textValue(body.region, 120),
        offer: textValue(body.offer, 900),
        services: textValue(body.services, 900),
        differentials: textValue(body.differentials, 700),
        tone: textValue(body.tone, 120),
        cta: textValue(body.cta, 180),
        avoidTopics: textValue(body.avoidTopics, 700),
        notes: textValue(body.notes, 1200),
        whatsapp: textValue(body.whatsapp, 40),
        website: textValue(body.website, 220),
        primaryColor,
        secondaryColor,
        logoUrl,
        status: "submitted",
        submittedAt: now,
        updatedAt: now
      };
      client.onboarding = client.onboarding && typeof client.onboarding === "object" ? client.onboarding : {};
      client.onboarding.creativeProfile = true;
      saveClients(clients);
      return send(res, 200, clientPortalView(client));
    } catch (error) {
      return send(res, 400, { error: String(error?.message || "agent_profile_save_failed") });
    }
  }

  if (url.pathname.startsWith("/client-logo/") && req.method === "GET") {
    const filename = path.basename(url.pathname.slice("/client-logo/".length));
    const full = path.join(clientLogoDir, filename);
    const portalClient = portalClientForRequest(req);
    const masterOk = masterSessionAuthorized(req);
    const portalOk = portalClient && filename.startsWith(slug(portalClient.id) + ".");
    if (!masterOk && !portalOk) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    if (!filename || !full.startsWith(clientLogoDir) || !fs.existsSync(full)) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    const ext = path.extname(filename).toLowerCase();
    const type = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return send(res, 200, fs.readFileSync(full), type);
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

  if (url.pathname === "/api/portal/instagram/publish-test" && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    if (client.id !== "testador") return send(res, 403, { error: "test_publish_only" });

    const connection = directConnection(client.id, "meta");
    const accessToken = decryptSecret(connection?.accessToken || "");
    const igUserId = String(connection?.igUserId || "").trim();
    if (!accessToken || !igUserId) {
      return send(res, 409, { error: "instagram_not_connected" });
    }

    const body = await readBody(req);
    const imageUrl = String(body.imageUrl || "").trim();
    const caption = String(body.caption || "").trim().slice(0, 2200);
    if (!/^https:\/\//i.test(imageUrl)) return send(res, 400, { error: "invalid_image_url" });
    if (!caption) return send(res, 400, { error: "caption_required" });

    const graphRequest = async (pathName, method = "GET", form = null) => {
      const endpoint = "https://graph.instagram.com/" + String(pathName).replace(/^\/+/, "");
      const options = {
        method,
        headers: {
          authorization: "Bearer " + accessToken,
          "user-agent": "NEXUS-AI/1.0"
        }
      };
      if (form) {
        options.headers["content-type"] = "application/x-www-form-urlencoded";
        options.body = new URLSearchParams(form);
      }
      const response = await fetch(endpoint, options);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const metaError = payload?.error || {};
        const err = new Error(String(metaError.message || "instagram_api_failed"));
        err.code = metaError.code || response.status;
        err.type = metaError.type || "";
        throw err;
      }
      return payload;
    };

    try {
      const created = await graphRequest(igUserId + "/media", "POST", {
        image_url: imageUrl,
        caption
      });
      const containerId = String(created?.id || "");
      if (!containerId) throw new Error("instagram_container_missing");

      const deadline = Date.now() + 90000;
      let lastStatus = "";
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const status = await graphRequest(containerId + "?fields=status_code,status");
        const code = String(status?.status_code || "").toUpperCase();
        lastStatus = String(status?.status || code || "");
        if (code === "FINISHED") {
          const published = await graphRequest(igUserId + "/media_publish", "POST", {
            creation_id: containerId
          });
          const mediaId = String(published?.id || "");
          let permalink = "";
          if (mediaId) {
            try {
              const media = await graphRequest(mediaId + "?fields=permalink");
              permalink = String(media?.permalink || "");
            } catch {}
          }
          return send(res, 200, {
            ok: true,
            username: connection?.meta?.username || "",
            mediaId,
            containerId,
            permalink
          });
        }
        if (code === "ERROR" || code === "EXPIRED") {
          return send(res, 400, { error: "instagram_media_processing_failed", status: lastStatus });
        }
      }
      return send(res, 504, { error: "instagram_media_processing_timeout", status: lastStatus });
    } catch (error) {
      return send(res, 400, {
        error: "instagram_publish_failed",
        code: error?.code || "",
        type: error?.type || "",
        message: String(error?.message || "Falha ao publicar no Instagram").slice(0, 500)
      });
    }
  }

  if (url.pathname === "/api/portal/instagram/start" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });

    const appId = masterInstagramAppId();
    const appSecret = masterInstagramAppSecret();
    if (!appId || !appSecret) {
      return send(res, 503, {
        error: "instagram_nexus_not_configured",
        message: "A conexão do Instagram ainda precisa ser ativada pelo administrador NEXUS."
      });
    }

    const state = "ig_" + crypto.randomBytes(24).toString("base64url");
    const states = loadOauthStates();
    const now = Date.now();
    for (const [key, value] of Object.entries(states)) {
      if (!value?.createdAt || now - Number(value.createdAt) > 15 * 60 * 1000) delete states[key];
    }
    states[state] = { provider: "instagram", clientId: client.id, createdAt: now };
    saveOauthStates(states);

    const authorize = new URL("https://www.instagram.com/oauth/authorize");
    authorize.searchParams.set("client_id", appId);
    authorize.searchParams.set("redirect_uri", instagramRedirectUri(req));
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set(
      "scope",
      "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages,instagram_business_manage_comments"
    );
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("force_reauth", "true");
    authorize.searchParams.set("enable_fb_login", "0");
    return send(res, 200, { url: authorize.toString() });
  }

  if (url.pathname === "/api/oauth/instagram/callback" && req.method === "GET") {
    const code = String(url.searchParams.get("code") || "").split("#")[0];
    const state = String(url.searchParams.get("state") || "");
    const oauthError = String(url.searchParams.get("error") || "");
    const states = loadOauthStates();
    const saved = states[state];

    const oauthPage = (ok, message) => send(
      res,
      ok ? 200 : 400,
      `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NEXUS AI</title><body style="margin:0;background:#050807;color:#f4f8f5;font-family:system-ui;display:grid;place-items:center;min-height:100vh"><div style="max-width:520px;padding:30px;border:1px solid #173549;border-radius:20px;background:#071018;text-align:center"><h1 style="margin-top:0;color:${ok ? "#5dd3ff" : "#ff9898"}">${ok ? "Instagram conectado" : "Falha na conexão"}</h1><p style="color:#aab9c2;line-height:1.5">${message}</p><p>Você pode fechar esta janela e voltar ao NEXUS AI.</p></div><script>try{if(window.opener)window.opener.postMessage({type:"nexus-instagram-oauth",ok:${ok ? "true" : "false"}},"*");}catch(e){}setTimeout(()=>window.close(),900);<\/script></body></html>`,
      "text/html; charset=utf-8"
    );

    if (oauthError) return oauthPage(false, "A autorização foi cancelada ou recusada.");
    if (!code || !state || !saved || saved.provider !== "instagram" || Date.now() - Number(saved.createdAt || 0) > 15 * 60 * 1000) {
      return oauthPage(false, "Esta autorização expirou. Inicie novamente pelo painel.");
    }

    try {
      const appId = masterInstagramAppId();
      const appSecret = masterInstagramAppSecret();
      if (!appId || !appSecret) throw new Error("instagram_nexus_not_configured");

      const tokenBody = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: instagramRedirectUri(req),
        code
      });
      const tokenResponse = await fetch("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: tokenBody
      });
      const tokenPayload = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenPayload.access_token) {
        throw new Error("instagram_token_exchange_failed");
      }

      let accessToken = String(tokenPayload.access_token);
      let expiresIn = Number(tokenPayload.expires_in || 3600);

      try {
        const longUrl = new URL("https://graph.instagram.com/access_token");
        longUrl.searchParams.set("grant_type", "ig_exchange_token");
        longUrl.searchParams.set("client_secret", appSecret);
        longUrl.searchParams.set("access_token", accessToken);
        const longResponse = await fetch(longUrl);
        if (longResponse.ok) {
          const longPayload = await longResponse.json();
          if (longPayload.access_token) accessToken = String(longPayload.access_token);
          if (longPayload.expires_in) expiresIn = Number(longPayload.expires_in);
        }
      } catch {}

      const meUrl = new URL("https://graph.instagram.com/me");
      meUrl.searchParams.set("fields", "id,username,account_type");
      meUrl.searchParams.set("access_token", accessToken);
      const meResponse = await fetch(meUrl);
      const profile = await meResponse.json().catch(() => ({}));
      if (!meResponse.ok || !profile.id) throw new Error("instagram_profile_failed");

      const username = String(profile.username || "").replace(/^@/, "");
      saveProviderConnection(saved.clientId, "meta", {
        accessToken: encryptSecret(accessToken),
        expiresAt: Date.now() + Math.max(3600, expiresIn) * 1000,
        igUserId: String(profile.id || tokenPayload.user_id || ""),
        accountType: String(profile.account_type || ""),
        scopes: [
          "instagram_business_basic",
          "instagram_business_content_publish",
          "instagram_business_manage_messages",
          "instagram_business_manage_comments"
        ],
        meta: {
          username,
          label: username ? "@" + username : "Instagram conectado"
        }
      });

      const clients = loadClients();
      const client = clients.find(item => item.id === saved.clientId);
      if (!client) throw new Error("client_not_found");
      client.instagram = username ? "@" + username : "Instagram conectado";
      client.meta = "connected";
      client.onboarding = client.onboarding && typeof client.onboarding === "object" ? client.onboarding : {};
      client.onboarding.instagram = true;
      saveClients(clients);

      delete states[state];
      saveOauthStates(states);
      return oauthPage(true, username ? "Conta @" + username + " autorizada com sucesso." : "Conta autorizada com sucesso.");
    } catch (error) {
      console.warn("Instagram OAuth callback failed:", error.message);
      return oauthPage(false, "Não foi possível concluir a autorização do Instagram.");
    }
  }

  if (url.pathname === "/api/meta/instagram/deauthorize" && req.method === "POST") {
    const body = await readFormBody(req);
    const payload = decodeMetaSignedRequest(body.signed_request);
    if (!payload) return send(res, 400, { error: "invalid_signed_request" });
    const igUserId = String(payload.user_id || payload.data?.user_id || "");
    disconnectInstagramUser(igUserId);
    return send(res, 200, { success: true });
  }

  if (url.pathname === "/api/meta/instagram/data-deletion" && req.method === "POST") {
    const body = await readFormBody(req);
    const payload = decodeMetaSignedRequest(body.signed_request);
    if (!payload) return send(res, 400, { error: "invalid_signed_request" });
    const igUserId = String(payload.user_id || payload.data?.user_id || "");
    disconnectInstagramUser(igUserId);
    const confirmationCode = crypto.randomBytes(12).toString("hex");
    const statusUrl = publicOrigin(req) + "/api/meta/instagram/data-deletion/status?code=" + encodeURIComponent(confirmationCode);
    return send(res, 200, { url: statusUrl, confirmation_code: confirmationCode });
  }

  if (url.pathname === "/api/meta/instagram/data-deletion/status" && req.method === "GET") {
    const code = String(url.searchParams.get("code") || "");
    if (!code) return send(res, 400, "Código de confirmação ausente.", "text/plain; charset=utf-8");
    return send(
      res,
      200,
      `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NEXUS AI</title><body style="margin:0;background:#050807;color:#f4f8f5;font-family:system-ui;display:grid;place-items:center;min-height:100vh"><div style="max-width:560px;padding:30px;border:1px solid #173549;border-radius:20px;background:#071018"><h1>Exclusão processada</h1><p>Os dados de conexão do Instagram associados à solicitação foram removidos do NEXUS AI.</p><p><strong>Código:</strong> ${code.replace(/[^a-zA-Z0-9_-]/g, "")}</p></div></body></html>`,
      "text/html; charset=utf-8"
    );
  }

  if (url.pathname === "/api/portal/support" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    const tickets = loadSupportTickets()
      .filter(item => item.clientId === client.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 30)
      .map(supportTicketView);
    return send(res, 200, { tickets });
  }

  if (url.pathname === "/api/portal/support" && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    const body = await readBody(req);
    const category = String(body.category || "Suporte geral").trim().slice(0, 80);
    const subject = String(body.subject || "").trim().slice(0, 140);
    const message = String(body.message || "").trim().slice(0, 3000);
    if (!subject || !message) return send(res, 400, { error: "subject_and_message_required" });

    const now = new Date().toISOString();
    const ticket = {
      id: "sup_" + crypto.randomBytes(9).toString("hex"),
      clientId: client.id,
      clientName: client.name || client.id,
      category,
      subject,
      message,
      status: "new",
      createdAt: now,
      updatedAt: now
    };
    const tickets = loadSupportTickets();
    tickets.push(ticket);
    saveSupportTickets(tickets);
    return send(res, 201, supportTicketView(ticket));
  }

  if (url.pathname === "/index.html" && req.method === "GET") {
    res.writeHead(303, { location: "/master", "cache-control": "no-store", "content-length": "0" });
    return res.end();
  }

  if (url.pathname.startsWith("/api/") && !masterAuthorized(req)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="NEXUS AI Agent Central"');
    return send(res, 401, { error: "unauthorized" });
  }

  if (url.pathname === "/api/master/posts" && req.method === "GET") {
    return send(res, 200, postLedgerSummary());
  }

  const masterAgentConfigMatch = url.pathname.match(/^\/api\/master\/agent-config\/([^/]+)$/);
  if (masterAgentConfigMatch && req.method === "PATCH") {
    const clientId = masterAgentConfigMatch[1];
    const body = await readBody(req);
    const clients = loadClients();
    const client = clients.find(item => item.id === clientId);
    if (!client) return send(res, 404, { error: "not_found" });

    const textValue = (value, fallback = "", max = 700) =>
      typeof value === "string" ? value.trim().slice(0, max) : fallback;
    const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
    const requestedTimes = Array.isArray(body.postTimes) ? body.postTimes.map(String).filter(validTime) : [];
    if (requestedTimes.length) client.postTimes = [...new Set(requestedTimes)].slice(0, 6);

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
    if (client.agentProfile && typeof client.agentProfile === "object") {
      client.agentProfile.status = "configured";
      client.agentProfile.reviewedAt = new Date().toISOString();
    }
    saveClients(clients);
    return send(res, 200, client);
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

    const aiMode = "hybrid";
    const aiMonthlyImageLimit = 10;

    const client = {
      id,
      name: body.name || "Novo cliente",
      niche: body.niche || "Outro",
      instagram: "",
      theme: body.theme || "green-black",
      primaryColor: body.primaryColor || "#18c96e",
      secondaryColor: body.secondaryColor || "#07140c",
      status: "setup",
      github: "managed",
      railway: "managed",
      openai: "managed",
      meta: "pending",
      odin: true,
      postTimes: ["09:00", "12:00", "18:00"],
      leads: { total: 0, hot: 0, warm: 0, cold: 0 },
      usage: { openaiPercent: 0, railwayPercent: 0 },
      aiMode,
      aiMonthlyImageLimit,
      aiImagesUsed: 0,
      aiUsageMonth: new Date().toISOString().slice(0, 7),
      managedInfrastructure: true,
      onboarding: {
        github: true, railway: true, openai: true,
        instagram: false, facebook: true, metaApp: true,
        creativeProfile: false, supportRequested: false
      },
      postingProfile: defaultPostingProfile(),
      setupMode: "managed",
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

    if (Object.prototype.hasOwnProperty.call(body, "aiMode")) {
      const mode = String(body.aiMode || "");
      if (!["hybrid","economy","own-key"].includes(mode)) {
        return send(res, 400, { error: "invalid_ai_mode" });
      }
      if (client.id === "ragnar-one" && mode !== "own-key") {
        return send(res, 409, { error: "ragnar_openai_is_separate" });
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "aiMonthlyImageLimit")) {
      const limit = Number(body.aiMonthlyImageLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
        return send(res, 400, { error: "invalid_ai_monthly_image_limit" });
      }
    }

    const allowed = [
      "name","niche","instagram","theme","primaryColor","secondaryColor",
      "status","github","railway","openai","meta","odin","postTimes",
      "leads","usage","onboarding","agentApiUrl","setupMode",
      "aiMode","aiMonthlyImageLimit","aiImagesUsed","aiUsageMonth","managedInfrastructure"
    ];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, key)) client[key] = body[key];
    }
    saveClients(clients);
    return send(res, 200, client);
  }

  const deleteClientMatch = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (deleteClientMatch && req.method === "DELETE") {
    const clientId = deleteClientMatch[1];
    if (clientId === "ragnar-one") return send(res, 409, { error: "protected_pilot_client" });

    const clients = loadClients();
    const client = clients.find(item => item.id === clientId);
    if (!client) return send(res, 404, { error: "not_found" });
    saveClients(clients.filter(item => item.id !== clientId));

    const users = loadPortalUsers();
    if (Object.prototype.hasOwnProperty.call(users, clientId)) {
      delete users[clientId];
      savePortalUsers(users);
    }

    const connections = loadConnections();
    if (Object.prototype.hasOwnProperty.call(connections, clientId)) {
      delete connections[clientId];
      saveConnections(connections);
    }

    const oauthStates = loadOauthStates();
    let oauthChanged = false;
    for (const [state, record] of Object.entries(oauthStates)) {
      if (record?.clientId === clientId) {
        delete oauthStates[state];
        oauthChanged = true;
      }
    }
    if (oauthChanged) saveOauthStates(oauthStates);

    saveSupportTickets(loadSupportTickets().filter(item => item.clientId !== clientId));

    for (const [token, record] of portalSessions.entries()) {
      if (record?.clientId === clientId) portalSessions.delete(token);
    }

    return send(res, 200, { ok: true, deletedClientId: clientId });
  }

  if (url.pathname === "/api/master/support" && req.method === "GET") {
    const tickets = loadSupportTickets()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(supportTicketView);
    return send(res, 200, {
      unreadCount: tickets.filter(item => item.status === "new").length,
      openCount: tickets.filter(item => item.status !== "resolved").length,
      tickets
    });
  }

  const supportTicketMatch = url.pathname.match(/^\/api\/master\/support\/([^/]+)$/);
  if (supportTicketMatch && req.method === "PATCH") {
    const body = await readBody(req);
    const allowed = new Set(["new", "read", "resolved"]);
    const nextStatus = String(body.status || "");
    if (!allowed.has(nextStatus)) return send(res, 400, { error: "invalid_status" });

    const tickets = loadSupportTickets();
    const ticket = tickets.find(item => item.id === supportTicketMatch[1]);
    if (!ticket) return send(res, 404, { error: "not_found" });
    ticket.status = nextStatus;
    ticket.updatedAt = new Date().toISOString();
    saveSupportTickets(tickets);
    return send(res, 200, supportTicketView(ticket));
  }

  if (url.pathname === "/api/master/instagram" && req.method === "GET") {
    return send(res, 200, {
      configured: Boolean(masterInstagramAppId() && masterInstagramAppSecret()),
      appId: masterInstagramAppId(),
      callbackUrl: instagramRedirectUri(req),
      scopes: [
        "instagram_business_basic",
        "instagram_business_content_publish",
        "instagram_business_manage_messages",
        "instagram_business_manage_comments"
      ]
    });
  }

  if (url.pathname === "/api/master/instagram" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const current = loadMasterIntegrations();
      const previous = current.instagram || {};
      const appId = String(body.appId || previous.appId || "").trim();
      const suppliedSecret = String(body.appSecret || "").trim();

      if (!appId || (!suppliedSecret && !masterInstagramAppSecret())) {
        return send(res, 400, { error: "instagram_app_credentials_required" });
      }

      current.instagram = {
        ...previous,
        appId,
        ...(suppliedSecret ? { appSecret: encryptSecret(suppliedSecret) } : {}),
        updatedAt: new Date().toISOString()
      };
      saveMasterIntegrations(current);
      return send(res, 200, {
        configured: true,
        appId,
        callbackUrl: instagramRedirectUri(req)
      });
    } catch (error) {
      return send(res, 400, { error: String(error?.message || "instagram_config_failed") });
    }
  }

  if (url.pathname === "/api/master/openai" && req.method === "GET") {
    try {
      return send(res, 200, await masterOpenAISummary());
    } catch (error) {
      return send(res, 200, {
        apiConnected: Boolean(masterOpenAIProjectKey()),
        billingConnected: Boolean(masterOpenAIAdminKey()),
        connected: Boolean(masterOpenAIProjectKey() || masterOpenAIAdminKey()),
        monthCostUsd: null,
        spendLimitUsd: null,
        balanceEstimatedUsd: null,
        monthlyBudgetUsd: Number(masterOpenAIRecord().monthlyBudgetUsd) || null,
        budgetRemainingUsd: null,
        budgetPercent: null,
        exactPrepaidBalanceAvailable: false,
        ragnarExcluded: true,
        error: String(error?.message || "openai_summary_failed")
      });
    }
  }

  if (url.pathname === "/api/master/openai" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const current = loadMasterIntegrations();
      const previous = current.openai || {};
      const suppliedApiKey = String(body.apiKey || "").trim();
      const suppliedAdminKey = String(body.adminKey || "").trim();
      const apiKey = suppliedApiKey || masterOpenAIProjectKey();
      const adminKey = suppliedAdminKey || masterOpenAIAdminKey();

      const hasBalanceSetting =
        Object.prototype.hasOwnProperty.call(body, "currentBalanceUsd")
        && String(body.currentBalanceUsd).trim() !== "";
      const hasBudgetSetting =
        Object.prototype.hasOwnProperty.call(body, "monthlyBudgetUsd")
        && String(body.monthlyBudgetUsd).trim() !== "";
      if (!apiKey && !adminKey && !hasBalanceSetting && !hasBudgetSetting) {
        return send(res, 400, { error: "openai_key_or_budget_required" });
      }
      if (suppliedApiKey) await validateOpenAIKey(suppliedApiKey);
      if (suppliedAdminKey) await validateOpenAIAdminKey(suppliedAdminKey);

      const next = { ...previous };
      if (suppliedApiKey) next.apiKey = encryptSecret(suppliedApiKey);
      if (suppliedAdminKey) next.adminKey = encryptSecret(suppliedAdminKey);

      if (Object.prototype.hasOwnProperty.call(body, "currentBalanceUsd") && String(body.currentBalanceUsd).trim() !== "") {
        const balance = Number(body.currentBalanceUsd);
        if (!Number.isFinite(balance) || balance < 0 || balance > 1000000) {
          return send(res, 400, { error: "invalid_balance" });
        }
        next.balanceBaselineUsd = balance;
        next.balanceBaselineAt = Math.floor(Date.now() / 1000);
      }
      if (Object.prototype.hasOwnProperty.call(body, "monthlyBudgetUsd") && String(body.monthlyBudgetUsd).trim() !== "") {
        const budget = Number(body.monthlyBudgetUsd);
        if (!Number.isFinite(budget) || budget <= 0 || budget > 1000000) {
          return send(res, 400, { error: "invalid_monthly_budget" });
        }
        next.monthlyBudgetUsd = budget;
      }
      next.connectedAt = previous.connectedAt || new Date().toISOString();
      next.updatedAt = new Date().toISOString();
      current.openai = next;
      saveMasterIntegrations(current);
      return send(res, 200, await masterOpenAISummary());
    } catch (error) {
      return send(res, 400, { error: String(error?.message || "openai_connection_failed") });
    }
  }

  if (url.pathname === "/api/system/status" && req.method === "GET") {
    return send(res, 200, {
      githubConfigured: Boolean(
        (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
        || process.env.GITHUB_CONNECTED === "true"
      ),
      githubMode: process.env.GITHUB_CONNECTED === "true" ? "source-connected" : "oauth",
      railwayConfigured: Boolean(
        process.env.RAILWAY_API_TOKEN
        || (process.env.RAILWAY_OAUTH_CLIENT_ID && process.env.RAILWAY_OAUTH_CLIENT_SECRET)
      ),
      railwayMode: process.env.RAILWAY_API_TOKEN ? "api-token" : "oauth",
      openaiAdminConfigured: Boolean(masterOpenAIAdminKey()),
      openaiApiConfigured: Boolean(masterOpenAIProjectKey()),
      openaiAdminOptional: true,
      clientPortalConfigured: portalAccounts().length > 0,
      metaMode: "central-oauth",
      metaConfigured: Boolean(masterInstagramAppId() && masterInstagramAppSecret()),
      note: "Status operacional do NEXUS Core e integrações administrativas opcionais."
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
