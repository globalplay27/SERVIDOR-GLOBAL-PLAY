
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildHookCandidates, captionAudit, classifyInteraction, estimateBeats, humanizeText, performanceAudit, profileAudit, repurposeCandidates, scoreHook, skillCoverageForAgent, suggestFormat } from "./instagram-intelligence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
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
const agentExecutionsFile = path.join(DATA_DIR, "agent-executions.json");
const agentCoreStateFile = path.join(DATA_DIR, "agent-core-state.json");
const leadHunterConfigFile = path.join(DATA_DIR, "lead-hunter-config.json");
const leadHunterLeadsFile = path.join(DATA_DIR, "lead-hunter-leads.json");
const leadHunterRunsFile = path.join(DATA_DIR, "lead-hunter-runs.json");
const leadHunterSeenFile = path.join(DATA_DIR, "lead-hunter-seen.json");
const videoJobsFile = path.join(DATA_DIR, "video-jobs.json");
const videoFoldersFile = path.join(DATA_DIR, "video-folders.json");
const clientLogoDir = path.join(DATA_DIR, "client-logos");
const manualPostDir = path.join(DATA_DIR, "manual-posts");
const clientVideoDir = path.join(DATA_DIR, "client-videos");
fs.mkdirSync(clientLogoDir, { recursive: true });
fs.mkdirSync(manualPostDir, { recursive: true });
fs.mkdirSync(clientVideoDir, { recursive: true });
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

function readLargeJsonBody(req, maxBytes = 14 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
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
      aiMode: "economy",
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
  let changed = false;
  for (const item of items) {
    if (item.id === "ragnar-one") continue;
    if (item.aiMode !== "economy" || Number(item.aiMonthlyImageLimit || 0) !== 0) {
      item.aiMode = "economy";
      item.aiMonthlyImageLimit = 0;
      item.aiImagesUsed = Number(item.aiImagesUsed || 0);
      changed = true;
    }
  }
  if (changed) writeJsonAtomic(runtimeFile, items);
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


const AGENT_CORE_MODULES = Object.freeze([
  { id: "radar", name: "RADAR", skills: ["ig-viral","ig-audit","ig-profile"] },
  { id: "estrategista", name: "ESTRATEGISTA", skills: ["ig-plan"] },
  { id: "creator", name: "CREATOR", skills: ["ig-reel","ig-caption","ig-carousel","ig-story","ig-repurpose"] },
  { id: "publisher", name: "PUBLISHER", skills: ["delivery","schedule","meta-publish"] },
  { id: "auditor", name: "AUDITOR", skills: ["ig-human","ig-audit"] },
  { id: "odin", name: "ODIN", skills: ["ig-comment","ig-reply","ig-dm"] }
]);

function loadAgentExecutions() {
  return readJsonFile(agentExecutionsFile, []);
}

function saveAgentExecutions(value) {
  writeJsonAtomic(agentExecutionsFile, Array.isArray(value) ? value.slice(-5000) : []);
}

function loadAgentCoreState() {
  return readObjectFile(agentCoreStateFile, {});
}

function saveAgentCoreState(value) {
  writeJsonAtomic(agentCoreStateFile, value && typeof value === "object" && !Array.isArray(value) ? value : {});
}

function defaultAgentCoreConfig() {
  return {
    enabled: true,
    approvalRequired: true,
    autoPublish: false,
    cycleMinutes: 60,
    modules: {
      radar: true,
      estrategista: true,
      creator: true,
      publisher: true,
      auditor: true,
      odin: true
    }
  };
}

function agentCoreConfig(client) {
  const defaults = defaultAgentCoreConfig();
  const current = client?.agentCore && typeof client.agentCore === "object" ? client.agentCore : {};
  const cycleMinutes = Math.max(15, Math.min(1440, Number(current.cycleMinutes || defaults.cycleMinutes)));
  const modules = {};
  for (const module of AGENT_CORE_MODULES) {
    modules[module.id] = current.modules?.[module.id] !== false;
  }
  const autoPublish = current.autoPublish === true;
  return {
    enabled: current.enabled !== false,
    approvalRequired: autoPublish ? current.approvalRequired === true : true,
    autoPublish,
    cycleMinutes,
    modules
  };
}

function agentCoreStateFor(clientId) {
  const state = loadAgentCoreState();
  return state[clientId] && typeof state[clientId] === "object" ? state[clientId] : {};
}

function patchAgentCoreState(clientId, patch) {
  const state = loadAgentCoreState();
  const current = state[clientId] && typeof state[clientId] === "object" ? state[clientId] : {};
  state[clientId] = { ...current, ...patch, updatedAt: new Date().toISOString() };
  saveAgentCoreState(state);
  return state[clientId];
}

function agentCoreExecutionView(row) {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    agent: row.agent,
    function: row.function,
    trigger: row.trigger,
    status: row.status,
    model: row.model,
    quantity: Number(row.quantity || 0),
    costUsd: Number(row.costUsd || 0),
    message: row.message || "",
    startedAt: row.startedAt || null,
    finishedAt: row.finishedAt || null,
    durationMs: Number(row.durationMs || 0),
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {}
  };
}

function recordAgentExecution(client, agent, details = {}) {
  const finishedAt = new Date().toISOString();
  const startedAt = details.startedAt || finishedAt;
  const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  const row = {
    id: crypto.randomUUID(),
    clientId: client.id,
    clientName: client.name || client.id,
    agent: String(agent || "").toUpperCase(),
    function: String(details.function || "cycle").slice(0, 120),
    trigger: String(details.trigger || "scheduler").slice(0, 80),
    status: ["success","warning","failed","blocked"].includes(String(details.status)) ? String(details.status) : "success",
    model: String(details.model || "local-rules").slice(0, 120),
    quantity: Math.max(0, Number(details.quantity || 0)),
    costUsd: Math.max(0, Number(details.costUsd || 0)),
    message: String(details.message || "").slice(0, 1000),
    startedAt,
    finishedAt,
    durationMs,
    metadata: details.metadata && typeof details.metadata === "object" ? details.metadata : {}
  };
  const rows = loadAgentExecutions();
  rows.push(row);
  saveAgentExecutions(rows);
  const state = agentCoreStateFor(client.id);
  const modules = state.modules && typeof state.modules === "object" ? state.modules : {};
  modules[String(agent || "").toLowerCase()] = {
    status: row.status,
    lastExecutionAt: row.finishedAt,
    message: row.message
  };
  patchAgentCoreState(client.id, { modules });
  return row;
}

function agentExecutionsForClient(clientId, limit = 80) {
  return loadAgentExecutions()
    .filter(item => item.clientId === clientId)
    .sort((a, b) => String(b.finishedAt || b.startedAt).localeCompare(String(a.finishedAt || a.startedAt)))
    .slice(0, Math.max(1, Math.min(300, Number(limit || 80))))
    .map(agentCoreExecutionView);
}

function agentCoreLocalDay(value = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(value instanceof Date ? value : new Date(value));
    const get = type => parts.find(item => item.type === type)?.value || "";
    return [get("year"), get("month"), get("day")].join("-");
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
}

function agentCoreScheduleIso(time, slotIndex = 0) {
  const clean = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || "")) ? String(time) : "09:00";
  const today = agentCoreLocalDay();
  let scheduled = new Date(today + "T" + clean + ":00-03:00");
  const minFuture = Date.now() + Math.max(0, slotIndex) * 60000;
  if (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= minFuture) {
    scheduled = new Date(scheduled.getTime() + 86400000);
  }
  return scheduled.toISOString();
}

function agentCoreTopTerms(texts, limit = 6) {
  const stop = new Set(["para","como","mais","uma","com","sem","que","dos","das","por","seu","sua","nos","nas","the","and","isso","este","esta","voce","você","hoje","agora","aqui","sobre","muito"]);
  const counts = new Map();
  for (const text of texts || []) {
    const words = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^a-z0-9#]+/g, " ")
      .split(/\s+/)
      .filter(word => word.length >= 4 && !stop.has(word));
    for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()].sort((a,b) => b[1]-a[1]).slice(0, limit).map(([term,count]) => ({ term, count }));
}


function loadLeadHunterConfigMap() {
  return readObjectFile(leadHunterConfigFile, {});
}

function saveLeadHunterConfigMap(value) {
  writeJsonAtomic(leadHunterConfigFile, value && typeof value === "object" && !Array.isArray(value) ? value : {});
}

function loadLeadHunterLeads() {
  return readJsonFile(leadHunterLeadsFile, []);
}

function saveLeadHunterLeads(value) {
  writeJsonAtomic(leadHunterLeadsFile, Array.isArray(value) ? value.slice(-10000) : []);
}

function loadLeadHunterRuns() {
  return readJsonFile(leadHunterRunsFile, []);
}

function saveLeadHunterRuns(value) {
  writeJsonAtomic(leadHunterRunsFile, Array.isArray(value) ? value.slice(-2000) : []);
}

function loadLeadHunterSeen() {
  return readObjectFile(leadHunterSeenFile, {});
}

function saveLeadHunterSeen(value) {
  const entries = Object.entries(value && typeof value === "object" ? value : {})
    .sort((a,b)=>Number(b[1] || 0)-Number(a[1] || 0))
    .slice(0, 20000);
  writeJsonAtomic(leadHunterSeenFile, Object.fromEntries(entries));
}

function defaultLeadHunterConfig(client) {
  const profile = client?.agentProfile && typeof client.agentProfile === "object" ? client.agentProfile : {};
  const posting = client?.postingProfile && typeof client.postingProfile === "object" ? client.postingProfile : {};
  const nicheTerms = [
    client?.niche,
    profile.niche,
    profile.brandName,
    profile.offer,
    profile.services,
    posting.targetAudience
  ].filter(Boolean).join(", ");
  return {
    enabled: true,
    autoRun: true,
    metaComments: true,
    publicTargets: true,
    aiQualification: true,
    scanIntervalMinutes: 60,
    lookbackDays: 7,
    maxResultsPerRun: 100,
    minScore: 35,
    targets: [],
    intentTerms: [
      "quanto custa","qual o valor","preço","valor","tem teste","quero","onde compro",
      "como assino","como contratar","manda o link","me chama","whatsapp","interessado",
      "orçamento","tem disponível","como funciona"
    ],
    nicheTerms: nicheTerms.split(",").map(item=>String(item).trim()).filter(Boolean).slice(0, 20)
  };
}

function normalizeInstagramTarget(value) {
  let raw = String(value || "").trim();
  if (!raw) return "";
  if (/^@[A-Za-z0-9._]{1,30}$/.test(raw)) {
    return "https://www.instagram.com/" + raw.slice(1) + "/";
  }
  if (/^#[A-Za-z0-9._-]{1,80}$/.test(raw)) {
    return "https://www.instagram.com/explore/tags/" + encodeURIComponent(raw.slice(1)) + "/";
  }
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase().replace(/^www\./,"");
    if (host !== "instagram.com") return "";
    parsed.protocol = "https:";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function leadHunterConfigFor(client) {
  const defaults = defaultLeadHunterConfig(client);
  const map = loadLeadHunterConfigMap();
  const current = map?.[client.id] && typeof map[client.id] === "object" ? map[client.id] : {};
  const targets = Array.isArray(current.targets) ? current.targets.map(normalizeInstagramTarget).filter(Boolean).slice(0,20) : defaults.targets;
  const terms = Array.isArray(current.intentTerms) ? current.intentTerms.map(x=>String(x).trim()).filter(Boolean).slice(0,40) : defaults.intentTerms;
  const nicheTerms = Array.isArray(current.nicheTerms) ? current.nicheTerms.map(x=>String(x).trim()).filter(Boolean).slice(0,30) : defaults.nicheTerms;
  return {
    enabled: current.enabled !== false,
    autoRun: current.autoRun !== false,
    metaComments: current.metaComments !== false,
    publicTargets: current.publicTargets !== false,
    aiQualification: current.aiQualification !== false,
    scanIntervalMinutes: Math.max(15, Math.min(1440, Number(current.scanIntervalMinutes || defaults.scanIntervalMinutes))),
    lookbackDays: Math.max(1, Math.min(30, Number(current.lookbackDays || defaults.lookbackDays))),
    maxResultsPerRun: Math.max(10, Math.min(250, Number(current.maxResultsPerRun || defaults.maxResultsPerRun))),
    minScore: Math.max(10, Math.min(90, Number(current.minScore || defaults.minScore))),
    targets,
    intentTerms: terms,
    nicheTerms
  };
}

function saveLeadHunterConfig(client, patch = {}) {
  const current = leadHunterConfigFor(client);
  const next = {
    ...current,
    enabled: patch.enabled === undefined ? current.enabled : Boolean(patch.enabled),
    autoRun: patch.autoRun === undefined ? current.autoRun : Boolean(patch.autoRun),
    metaComments: patch.metaComments === undefined ? current.metaComments : Boolean(patch.metaComments),
    publicTargets: patch.publicTargets === undefined ? current.publicTargets : Boolean(patch.publicTargets),
    aiQualification: patch.aiQualification === undefined ? current.aiQualification : Boolean(patch.aiQualification),
    scanIntervalMinutes: Math.max(15, Math.min(1440, Number(patch.scanIntervalMinutes ?? current.scanIntervalMinutes))),
    lookbackDays: Math.max(1, Math.min(30, Number(patch.lookbackDays ?? current.lookbackDays))),
    maxResultsPerRun: Math.max(10, Math.min(250, Number(patch.maxResultsPerRun ?? current.maxResultsPerRun))),
    minScore: Math.max(10, Math.min(90, Number(patch.minScore ?? current.minScore))),
    targets: Array.isArray(patch.targets)
      ? patch.targets.map(normalizeInstagramTarget).filter(Boolean).slice(0,20)
      : current.targets,
    intentTerms: Array.isArray(patch.intentTerms)
      ? patch.intentTerms.map(x=>String(x).trim()).filter(Boolean).slice(0,40)
      : current.intentTerms,
    nicheTerms: Array.isArray(patch.nicheTerms)
      ? patch.nicheTerms.map(x=>String(x).trim()).filter(Boolean).slice(0,30)
      : current.nicheTerms,
    updatedAt: new Date().toISOString()
  };
  const map = loadLeadHunterConfigMap();
  map[client.id] = next;
  saveLeadHunterConfigMap(map);
  return next;
}

function leadHunterLeadsForClient(clientId, limit = 1000) {
  return loadLeadHunterLeads()
    .filter(item => item.clientId === clientId && item.status !== "discarded")
    .sort((a,b)=>Number(b.score||0)-Number(a.score||0) || String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")))
    .slice(0, Math.max(1, Math.min(2000, Number(limit || 1000))));
}

function summarizeLeadRows(rows = []) {
  return rows.reduce((acc, lead) => {
    acc.total += 1;
    const temp = ["hot","warm","cold"].includes(String(lead.temperature)) ? String(lead.temperature) : "cold";
    acc[temp] += 1;
    if (lead.needsHuman) acc.needsHuman += 1;
    return acc;
  }, { total:0, hot:0, warm:0, cold:0, needsHuman:0 });
}

function leadHunterSummaryForClient(clientId) {
  const leads = leadHunterLeadsForClient(clientId, 5000);
  const runs = loadLeadHunterRuns()
    .filter(item=>item.clientId===clientId)
    .sort((a,b)=>String(b.finishedAt||b.startedAt||"").localeCompare(String(a.finishedAt||a.startedAt||"")));
  const last = runs[0] || null;
  return {
    ...summarizeLeadRows(leads),
    lastRunAt: last?.finishedAt || null,
    lastRunStatus: last?.status || "idle",
    lastAnalyzed: Number(last?.analyzed || 0),
    lastNew: Number(last?.newLeads || 0),
    lastUpdated: Number(last?.updatedLeads || 0),
    lastSources: last?.sources || {},
    lastErrors: Array.isArray(last?.errors) ? last.errors : []
  };
}

function decodeInstagramJsonString(value) {
  const raw = String(value || "");
  try { return JSON.parse('"' + raw.replace(/"/g,'\\"') + '"'); }
  catch {
    return raw.replace(/\\u0026/g,"&").replace(/\\n/g," ").replace(/\\"/g,'"').replace(/\\\\/g,"\\");
  }
}

function publicInstagramCandidatesFromHtml(html, targetUrl, max = 200) {
  const out = [];
  const seen = new Set();
  let targetUsername = "";
  try {
    const parsed = new URL(targetUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] && !["p","reel","reels","explore","stories"].includes(parts[0])) targetUsername = parts[0].toLowerCase();
  } catch {}

  const add = (username, text, externalId = "", timestamp = null) => {
    const handle = String(username || "").replace(/^@/,"").trim();
    const message = String(text || "").replace(/\s+/g," ").trim();
    if (!/^[A-Za-z0-9._]{1,30}$/.test(handle) || message.length < 2 || message.length > 700) return;
    if (targetUsername && handle.toLowerCase() === targetUsername) return;
    const key = handle.toLowerCase() + "|" + message.toLowerCase().slice(0,180);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      externalId: String(externalId || ""),
      instagramUsername: handle,
      instagramUserId: "",
      message,
      source: "public-target",
      sourceUrl: targetUrl,
      sourceMediaId: "",
      createdAt: timestamp || null
    });
  };

  const walk = (node, depth = 0) => {
    if (!node || depth > 12 || out.length >= max) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const username =
      node?.user?.username || node?.owner?.username || node?.from?.username ||
      (typeof node.username === "string" ? node.username : "");
    const text =
      (typeof node.text === "string" ? node.text : "") ||
      (typeof node.comment_text === "string" ? node.comment_text : "") ||
      (typeof node.body === "string" ? node.body : "");
    if (username && text) {
      add(username, text, node.pk || node.id || node.comment_id || "", node.created_at || node.timestamp || null);
    }
    for (const value of Object.values(node)) walk(value, depth + 1);
  };

  const scripts = String(html || "").matchAll(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try { walk(JSON.parse(match[1])); } catch {}
    if (out.length >= max) break;
  }

  const raw = String(html || "");
  const patterns = [
    /"username":"([^"]{1,40})"[\s\S]{0,1200}?"text":"((?:\\.|[^"]) {0,700})"/g,
    /"text":"((?:\\.|[^"]) {0,700})"[\s\S]{0,1200}?"username":"([^"]{1,40})"/g
  ];
  // Correct the literal-space quantifier above for engines that do not tolerate copied minification.
  const fallbackPatterns = [
    /"username":"([^"]{1,40})"[\s\S]{0,1200}?"text":"((?:\\.|[^"]){1,700})"/g,
    /"text":"((?:\\.|[^"]){1,700})"[\s\S]{0,1200}?"username":"([^"]{1,40})"/g
  ];
  for (let p = 0; p < fallbackPatterns.length && out.length < max; p += 1) {
    const regex = fallbackPatterns[p];
    let match;
    while ((match = regex.exec(raw)) && out.length < max) {
      if (p === 0) add(match[1], decodeInstagramJsonString(match[2]));
      else add(match[2], decodeInstagramJsonString(match[1]));
    }
  }
  return out;
}

async function collectPublicInstagramTarget(targetUrl, maxResults) {
  const url = normalizeInstagramTarget(targetUrl);
  if (!url) return { items:[], error:"invalid_instagram_target", target:targetUrl };
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.7",
        "user-agent": "Mozilla/5.0 (compatible; NEXUSLeadHunter/1.0; +https://nexus.local)"
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) return { items:[], error:"instagram_public_http_" + response.status, target:url };
    const html = await response.text();
    return {
      items: publicInstagramCandidatesFromHtml(html, url, maxResults),
      target:url,
      error:""
    };
  } catch (error) {
    return { items:[], error:String(error?.message || error).slice(0,160), target:url };
  }
}

async function collectOwnInstagramComments(client, config) {
  const connection = directConnection(client.id, "meta");
  const accessToken = decryptSecret(connection?.accessToken || "");
  const igUserId = String(connection?.igUserId || "").trim();
  if (!accessToken || !igUserId) return { items:[], error:"instagram_not_connected", source:"meta-comments" };

  try {
    const mediaUrl = "https://graph.instagram.com/" + encodeURIComponent(igUserId)
      + "/media?fields=" + encodeURIComponent("id,permalink,timestamp")
      + "&limit=12";
    const mediaResponse = await fetch(mediaUrl, {
      headers: { authorization:"Bearer " + accessToken, accept:"application/json", "user-agent":"NEXUSLeadHunter/1.0" },
      signal: AbortSignal.timeout(12000)
    });
    const mediaPayload = await mediaResponse.json().catch(()=>({}));
    if (!mediaResponse.ok) throw new Error(String(mediaPayload?.error?.message || "instagram_media_" + mediaResponse.status));
    const media = Array.isArray(mediaPayload.data) ? mediaPayload.data : [];
    const cutoff = Date.now() - Number(config.lookbackDays || 7) * 86400000;
    const ownUsername = String(connection?.meta?.username || client.instagram || "").replace(/^@/,"").toLowerCase();
    const items = [];
    const errors = [];

    for (const post of media) {
      if (items.length >= config.maxResultsPerRun) break;
      const postTime = post.timestamp ? new Date(post.timestamp).getTime() : Date.now();
      if (Number.isFinite(postTime) && postTime < cutoff) continue;
      try {
        const commentUrl = "https://graph.instagram.com/" + encodeURIComponent(String(post.id))
          + "/comments?fields=" + encodeURIComponent("id,text,username,timestamp")
          + "&limit=50";
        const commentResponse = await fetch(commentUrl, {
          headers: { authorization:"Bearer " + accessToken, accept:"application/json", "user-agent":"NEXUSLeadHunter/1.0" },
          signal: AbortSignal.timeout(12000)
        });
        const payload = await commentResponse.json().catch(()=>({}));
        if (!commentResponse.ok) throw new Error(String(payload?.error?.message || "comments_" + commentResponse.status));
        for (const comment of Array.isArray(payload.data) ? payload.data : []) {
          if (items.length >= config.maxResultsPerRun) break;
          const username = String(comment.username || "").replace(/^@/,"").trim();
          if (!username || username.toLowerCase() === ownUsername) continue;
          items.push({
            externalId: String(comment.id || ""),
            instagramUsername: username,
            instagramUserId: "",
            message: String(comment.text || "").trim().slice(0,700),
            source: "meta-comment",
            sourceUrl: String(post.permalink || ""),
            sourceMediaId: String(post.id || ""),
            createdAt: comment.timestamp || post.timestamp || null
          });
        }
      } catch (error) {
        errors.push(String(error?.message || error).slice(0,140));
      }
    }
    return { items, errors, source:"meta-comments" };
  } catch (error) {
    return { items:[], error:String(error?.message || error).slice(0,180), source:"meta-comments" };
  }
}

function localLeadQualification(candidate, client, config) {
  const message = String(candidate.message || "").replace(/\s+/g," ").trim();
  const low = message.toLowerCase();
  const cls = classifyInteraction(message, client.leadKeyword || "QUERO");
  let score = 8;
  if (cls === "KEYWORD") score += 48;
  else if (cls === "LEAD") score += 38;
  else if (cls === "QUESTION") score += 18;
  else if (cls === "SUBSTANCE") score += 9;
  else if (cls === "NOISE") score -= 45;

  const intentMatches = (config.intentTerms || []).filter(term => term && low.includes(String(term).toLowerCase()));
  score += Math.min(28, intentMatches.length * 9);

  const nicheMatches = (config.nicheTerms || []).filter(term => {
    const clean = String(term || "").trim().toLowerCase();
    return clean.length >= 3 && low.includes(clean);
  });
  score += Math.min(12, nicheMatches.length * 4);

  if (candidate.source === "meta-comment") score += 10;
  if (candidate.instagramUsername) score += 4;
  if (/\b(?:http|www\.|ganhe seguidores|divulgue|promoção imperdível|renda extra garantida)\b/i.test(message)) score -= 28;

  const when = candidate.createdAt ? new Date(candidate.createdAt).getTime() : NaN;
  const ageHours = Number.isFinite(when) ? Math.max(0,(Date.now()-when)/3600000) : null;
  if (ageHours !== null && ageHours <= 24) score += 10;
  else if (ageHours !== null && ageHours <= 72) score += 5;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const temperature = score >= 80 ? "hot" : score >= 55 ? "warm" : "cold";
  const intent = intentMatches[0] || (cls === "KEYWORD" ? "palavra-chave de compra" : cls === "LEAD" ? "intenção comercial" : cls === "QUESTION" ? "pergunta comercial" : "interação");
  return {
    ...candidate,
    conversationClass: cls,
    localScore: score,
    score,
    temperature,
    intent,
    stage: temperature === "hot" ? "ready_for_contact" : temperature === "warm" ? "qualifying" : "new",
    needsHuman: score >= 85 || cls === "KEYWORD",
    qualificationReason: "Classificação local por intenção, contexto, recência e aderência ao nicho.",
    intentMatches,
    nicheMatches
  };
}

async function aiQualifyLeadCandidates(client, candidates, config) {
  const apiKey = videoOpenAIKeyForClient(client.id);
  const eligible = candidates.filter(item => item.localScore >= Math.max(15, config.minScore - 20)).slice(0,60);
  if (!apiKey || !config.aiQualification || !eligible.length) return { items:candidates, costUsd:0, model:"local-intent-engine" };

  const profile = client.agentProfile && typeof client.agentProfile === "object" ? client.agentProfile : {};
  const input = eligible.map(item => ({
    id:item.candidateId,
    username:item.instagramUsername,
    text:item.message,
    source:item.source,
    localScore:item.localScore
  }));
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method:"POST",
      headers:{ authorization:"Bearer " + apiKey, "content-type":"application/json" },
      body:JSON.stringify({
        model:"gpt-5.6-luna",
        instructions:"Você qualifica sinais comerciais públicos para um CRM. Use somente o texto fornecido e o contexto comercial. Não infira saúde, religião, política, raça, sexualidade, renda ou outros atributos sensíveis. Não invente intenção. Score 0-100 deve representar chance de ser uma oportunidade comercial explícita ou plausível para o negócio. Retorne somente JSON válido.",
        input:"Negócio: " + JSON.stringify({
          niche:client.niche || profile.niche || "",
          offer:profile.offer || "",
          services:profile.services || "",
          audience:profile.audience || profile.targetAudience || ""
        }) + "\nCandidatos: " + JSON.stringify(input)
          + '\nRetorne {"leads":[{"id":"...","score":0,"intent":"...","stage":"new|qualifying|ready_for_contact","needsHuman":false,"reason":"..."}]}',
        max_output_tokens:3200
      }),
      signal:AbortSignal.timeout(120000)
    });
    const payload = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error("lead_ai_" + response.status);
    const raw = responseOutputText(payload);
    const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("lead_ai_invalid_json");
    const parsed = JSON.parse(raw.slice(a,b+1));
    const map = new Map((Array.isArray(parsed.leads) ? parsed.leads : []).map(item=>[String(item.id||""),item]));
    const items = candidates.map(item => {
      const ai = map.get(item.candidateId);
      if (!ai) return item;
      const aiScore = Math.max(0,Math.min(100,Number(ai.score || 0)));
      const score = Math.round(item.localScore * 0.45 + aiScore * 0.55);
      const temperature = score >= 80 ? "hot" : score >= 55 ? "warm" : "cold";
      return {
        ...item,
        aiScore,
        score,
        temperature,
        intent:String(ai.intent || item.intent || "").slice(0,180),
        stage:["new","qualifying","ready_for_contact"].includes(String(ai.stage)) ? String(ai.stage) : (temperature==="hot"?"ready_for_contact":temperature==="warm"?"qualifying":"new"),
        needsHuman:Boolean(ai.needsHuman) || score >= 85,
        qualificationReason:String(ai.reason || item.qualificationReason || "").slice(0,300)
      };
    });
    const usage = payload.usage || {};
    const costUsd = Math.max(0,Number(usage.input_tokens||0))*0.20/1_000_000
      + Math.max(0,Number(usage.output_tokens||0))*1.20/1_000_000;
    return { items, costUsd, model:"local-intent-engine+gpt-5.6-luna" };
  } catch (error) {
    return { items:candidates, costUsd:0, model:"local-intent-engine", error:String(error?.message || error).slice(0,180) };
  }
}

function leadCandidateFingerprint(clientId, item) {
  if (item.externalId) return clientId + "|id|" + item.source + "|" + item.externalId;
  const raw = [
    clientId,
    String(item.instagramUsername || item.instagramUserId || "").toLowerCase(),
    String(item.message || "").toLowerCase().replace(/\s+/g," ").slice(0,220),
    String(item.sourceUrl || "")
  ].join("|");
  return clientId + "|hash|" + crypto.createHash("sha256").update(raw).digest("hex").slice(0,32);
}

function mergeLeadHunterCandidates(client, candidates, config) {
  const all = loadLeadHunterLeads();
  const seen = loadLeadHunterSeen();
  const now = new Date().toISOString();
  let newLeads = 0, updatedLeads = 0, ignored = 0;

  for (const candidate of candidates) {
    if (Number(candidate.score || 0) < Number(config.minScore || 35)) { ignored += 1; continue; }
    const fingerprint = candidate.fingerprint || leadCandidateFingerprint(client.id,candidate);
    if (seen[fingerprint]) { ignored += 1; continue; }

    const identity = String(candidate.instagramUsername || candidate.instagramUserId || "").toLowerCase();
    if (!identity) { ignored += 1; continue; }
    const leadKey = client.id + "|" + identity;
    let row = all.find(item => item.leadKey === leadKey);
    const evidence = {
      fingerprint,
      source:candidate.source,
      sourceUrl:candidate.sourceUrl || "",
      sourceMediaId:candidate.sourceMediaId || "",
      message:String(candidate.message || "").slice(0,700),
      capturedAt:candidate.createdAt || now,
      score:Number(candidate.score || 0),
      reason:String(candidate.qualificationReason || "").slice(0,300)
    };
    if (row) {
      row.evidence = Array.isArray(row.evidence) ? row.evidence : [];
      row.evidence.push(evidence);
      row.evidence = row.evidence.slice(-12);
      const repeatBoost = Math.min(12, Math.max(0,row.evidence.length-1)*3);
      row.score = Math.max(Number(row.score||0), Math.min(100, Number(candidate.score||0)+repeatBoost));
      row.temperature = row.score >= 80 ? "hot" : row.score >= 55 ? "warm" : "cold";
      row.intent = candidate.intent || row.intent;
      row.stage = candidate.stage || row.stage;
      row.needsHuman = Boolean(row.needsHuman || candidate.needsHuman || row.score >= 85);
      row.lastMessage = candidate.message || row.lastMessage;
      row.lastContactAt = candidate.createdAt || row.lastContactAt || now;
      row.updatedAt = now;
      row.source = row.source === candidate.source ? row.source : "multi-source";
      row.sources = [...new Set([...(row.sources||[]),candidate.source])];
      row.evidenceCount = row.evidence.length;
      updatedLeads += 1;
    } else {
      row = {
        id:"nxl_" + crypto.randomBytes(9).toString("hex"),
        leadKey,
        clientId:client.id,
        clientName:client.name || client.id,
        instagram:client.instagram || "",
        instagramUserId:String(candidate.instagramUserId || ""),
        instagramUsername:String(candidate.instagramUsername || ""),
        temperature:candidate.temperature || "cold",
        score:Number(candidate.score || 0),
        stage:candidate.stage || "new",
        intent:String(candidate.intent || "").slice(0,180),
        needsHuman:Boolean(candidate.needsHuman),
        triggerKeyword:candidate.conversationClass === "KEYWORD" ? (client.leadKeyword || "QUERO") : "",
        lastMessage:String(candidate.message || "").slice(0,700),
        lastContactAt:candidate.createdAt || now,
        source:candidate.source || "nexus-hunter",
        sources:[candidate.source || "nexus-hunter"],
        sourceUrl:candidate.sourceUrl || "",
        evidence:[evidence],
        evidenceCount:1,
        status:"active",
        createdAt:now,
        updatedAt:now
      };
      all.push(row);
      newLeads += 1;
    }
    seen[fingerprint] = Date.now();
  }

  saveLeadHunterLeads(all);
  saveLeadHunterSeen(seen);
  return { newLeads, updatedLeads, ignored };
}

const leadHunterRunning = new Set();

async function runLeadHunter(client, options = {}) {
  if (leadHunterRunning.has(client.id)) return { ok:false, skipped:"already_running", summary:leadHunterSummaryForClient(client.id) };
  const config = leadHunterConfigFor(client);
  if (!config.enabled) return { ok:false, skipped:"disabled", summary:leadHunterSummaryForClient(client.id) };

  const previousRuns = loadLeadHunterRuns()
    .filter(item=>item.clientId===client.id && item.status!=="running")
    .sort((a,b)=>String(b.finishedAt||"").localeCompare(String(a.finishedAt||"")));
  const lastTime = previousRuns[0]?.finishedAt ? new Date(previousRuns[0].finishedAt).getTime() : 0;
  if (options.automatic && lastTime && Date.now()-lastTime < config.scanIntervalMinutes*60000) {
    return { ok:false, skipped:"not_due", summary:leadHunterSummaryForClient(client.id) };
  }

  leadHunterRunning.add(client.id);
  const startedAt = new Date().toISOString();
  const runId = "lh_" + crypto.randomBytes(8).toString("hex");
  const errors = [];
  const sourceCounts = {};
  let raw = [];
  let costUsd = 0;
  let model = "local-intent-engine";

  try {
    if (config.metaComments) {
      const meta = await collectOwnInstagramComments(client, config);
      raw.push(...(meta.items || []));
      sourceCounts.metaComments = (meta.items || []).length;
      if (meta.error) errors.push("Meta: " + meta.error);
      for (const err of meta.errors || []) errors.push("Meta: " + err);
    }

    if (config.publicTargets && config.targets.length) {
      let remaining = config.maxResultsPerRun;
      for (const target of config.targets) {
        if (remaining <= 0) break;
        const result = await collectPublicInstagramTarget(target, Math.min(remaining,80));
        raw.push(...(result.items || []));
        sourceCounts.publicTargets = (sourceCounts.publicTargets || 0) + (result.items || []).length;
        remaining -= (result.items || []).length;
        if (result.error) errors.push("Public target " + target + ": " + result.error);
      }
    }

    const candidateSeen = new Set();
    raw = raw.filter(item => {
      const fingerprint = leadCandidateFingerprint(client.id,item);
      if (candidateSeen.has(fingerprint)) return false;
      candidateSeen.add(fingerprint);
      item.fingerprint = fingerprint;
      item.candidateId = fingerprint.slice(-24);
      return String(item.message || "").trim().length >= 2;
    }).slice(0, config.maxResultsPerRun);

    const locallyQualified = raw.map(item=>localLeadQualification(item,client,config));
    const ai = await aiQualifyLeadCandidates(client, locallyQualified, config);
    costUsd += Number(ai.costUsd || 0);
    model = ai.model || model;
    if (ai.error) errors.push("IA: " + ai.error);

    const merge = mergeLeadHunterCandidates(client, ai.items || locallyQualified, config);
    const finishedAt = new Date().toISOString();
    const run = {
      id:runId,
      clientId:client.id,
      clientName:client.name || client.id,
      trigger:String(options.trigger || "manual"),
      status:errors.length && !raw.length ? "warning" : "success",
      startedAt,
      finishedAt,
      analyzed:raw.length,
      newLeads:merge.newLeads,
      updatedLeads:merge.updatedLeads,
      ignored:merge.ignored,
      model,
      costUsd,
      sources:sourceCounts,
      errors:errors.slice(0,20)
    };
    const runs = loadLeadHunterRuns();
    runs.push(run);
    saveLeadHunterRuns(runs);

    recordAgentExecution(client, "RADAR", {
      function:"nexus-lead-hunter",
      trigger:options.trigger || "manual",
      startedAt,
      status:run.status,
      model,
      quantity:raw.length,
      costUsd,
      message:raw.length
        ? "Lead Hunter analisou " + raw.length + " interação(ões): " + merge.newLeads + " novo(s) lead(s) e " + merge.updatedLeads + " atualizado(s)."
        : "Lead Hunter executou a coleta; nenhuma nova interação pública utilizável foi encontrada.",
      metadata:{ sources:sourceCounts, newLeads:merge.newLeads, updatedLeads:merge.updatedLeads, ignored:merge.ignored, errors:errors.slice(0,5) }
    });

    return { ok:true, run, summary:leadHunterSummaryForClient(client.id), leads:leadHunterLeadsForClient(client.id,100) };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const run = {
      id:runId, clientId:client.id, clientName:client.name || client.id,
      trigger:String(options.trigger || "manual"), status:"failed", startedAt, finishedAt,
      analyzed:raw.length, newLeads:0, updatedLeads:0, ignored:0, model, costUsd,
      sources:sourceCounts, errors:[String(error?.message || error).slice(0,300)]
    };
    const runs = loadLeadHunterRuns(); runs.push(run); saveLeadHunterRuns(runs);
    recordAgentExecution(client,"RADAR",{
      function:"nexus-lead-hunter",trigger:options.trigger||"manual",startedAt,status:"failed",model,quantity:raw.length,costUsd,
      message:"Lead Hunter falhou: " + String(error?.message || error).slice(0,300),
      metadata:{sources:sourceCounts}
    });
    throw error;
  } finally {
    leadHunterRunning.delete(client.id);
  }
}

function leadHunterPortalView(client) {
  const config = leadHunterConfigFor(client);
  const summary = leadHunterSummaryForClient(client.id);
  const leads = leadHunterLeadsForClient(client.id,100).map(item=>({
    id:item.id,
    instagramUsername:item.instagramUsername || "",
    instagramUserId:item.instagramUserId || "",
    temperature:item.temperature || "cold",
    score:Number(item.score || 0),
    stage:item.stage || "new",
    intent:item.intent || "",
    needsHuman:Boolean(item.needsHuman),
    lastMessage:item.lastMessage || "",
    lastContactAt:item.lastContactAt || null,
    updatedAt:item.updatedAt || null,
    source:item.source || "",
    sources:item.sources || [],
    sourceUrl:item.sourceUrl || item.evidence?.[item.evidence.length-1]?.sourceUrl || "",
    evidenceCount:Number(item.evidenceCount || item.evidence?.length || 0)
  }));
  return { config, summary, leads };
}


async function fetchInstagramMediaSnapshot(clientId) {
  const connection = directConnection(clientId, "meta");
  const accessToken = decryptSecret(connection?.accessToken || "");
  const igUserId = String(connection?.igUserId || "").trim();
  if (!accessToken || !igUserId) return { source: "local", items: [], error: "instagram_not_connected" };
  try {
    const fields = "id,caption,timestamp,media_type,like_count,comments_count,permalink";
    const endpoint = "https://graph.instagram.com/" + encodeURIComponent(igUserId) + "/media?fields=" + encodeURIComponent(fields) + "&limit=25";
    const response = await fetch(endpoint, {
      headers: {
        authorization: "Bearer " + accessToken,
        accept: "application/json",
        "user-agent": "NEXUS-AI-AgentCore/1.0"
      },
      signal: AbortSignal.timeout(9000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload?.error?.message || "instagram_media_" + response.status));
    const items = Array.isArray(payload?.data) ? payload.data.map(item => ({
      id: String(item.id || ""),
      caption: String(item.caption || "").slice(0, 2200),
      timestamp: item.timestamp || null,
      mediaType: String(item.media_type || ""),
      likeCount: Math.max(0, Number(item.like_count || 0)),
      commentsCount: Math.max(0, Number(item.comments_count || 0)),
      permalink: String(item.permalink || "")
    })) : [];
    return { source: "instagram-api", items };
  } catch (error) {
    return { source: "local", items: [], error: String(error?.message || error).slice(0, 300) };
  }
}

async function runRadarAgent(client, options = {}) {
  const startedAt = new Date().toISOString();
  const snapshot = await fetchInstagramMediaSnapshot(client.id);
  const ledger = loadPostLedger()
    .filter(row => row.clientId === client.id)
    .sort((a,b) => String(b.publishedAt || b.updatedAt || b.createdAt).localeCompare(String(a.publishedAt || a.updatedAt || a.createdAt)))
    .slice(0, 50);
  const captions = [...snapshot.items.map(item => item.caption), ...ledger.map(item => item.caption || "")].filter(Boolean);
  const topTerms = agentCoreTopTerms(captions, 10);
  const performance = performanceAudit(snapshot.items || []);
  const profileScore = profileAudit({ ...(client.agentProfile || {}), niche: client.niche || client.agentProfile?.niche || "" });
  const bestRecent = performance.top?.[0] || null;
  const output = {
    source: snapshot.source,
    scannedMedia: snapshot.items.length,
    topTerms,
    bestRecent,
    outliers: (performance.top || []).slice(0,5).map(item => ({
      id: item.id || "",
      caption: String(item.caption || "").slice(0,220),
      outlierMultiple: Number(item.outlierMultiple || 0),
      engagement: Number(item.engagement || 0)
    })),
    profileAudit: profileScore,
    skills: skillCoverageForAgent("radar").map(item => item.id),
    signals: [
      bestRecent?.caption ? "Reaproveitar o mecanismo do melhor conteúdo, sem copiar o criativo." : "Testar ganchos diferentes e medir a resposta da própria conta.",
      topTerms[0]?.term ? "Explorar novas abordagens para o tema " + topTerms[0].term + "." : "Usar o nicho e as dúvidas reais dos leads como matéria-prima.",
      profileScore.score < 70 ? "O perfil ainda perde pontos de conversão; priorizar " + (profileScore.priorities[0] || "clareza da oferta") + "." : "Perfil com boa base; focar em conteúdo e conversão.",
      "Comparar desempenho com a mediana da própria conta, não apenas com views brutas."
    ]
  };
  recordAgentExecution(client, "RADAR", {
    function: "trend-outlier-profile-scan",
    trigger: options.trigger,
    startedAt,
    status: snapshot.error && !snapshot.items.length ? "warning" : "success",
    model: "instagram-skills+instagram-api",
    quantity: snapshot.items.length + ledger.length,
    costUsd: 0,
    message: snapshot.items.length ? "RADAR analisou histórico, outliers e perfil usando ig-viral/ig-audit/ig-profile." : "RADAR analisou histórico local e perfil; leitura de mídia do Instagram indisponível.",
    metadata: { source: snapshot.source, topTerms, profileScore: profileScore.score, apiError: snapshot.error || "", skills: output.skills }
  });
  patchAgentCoreState(client.id, { radar: output });
  return output;
}

async function runStrategistAgent(client, context = {}, options = {}) {
  const startedAt = new Date().toISOString();
  const profile = { ...defaultPostingProfile(), ...(client.postingProfile || {}) };
  const ledger = loadPostLedger().filter(row => row.clientId === client.id);
  const published = ledger.filter(row => row.status === "published").length;
  const failed = ledger.filter(row => row.status === "failed" || row.status === "skipped").length;
  const pending = ledger.filter(row => row.approvalStatus === "pending" || row.approvalStatus === "correction_requested").length;
  const leadData = await fetchAgentLeads(client).catch(() => ({ summary: { total: 0, hot: 0, warm: 0, cold: 0 }, leads: [], source: "stored" }));
  const radar = context.radar || agentCoreStateFor(client.id).radar || {};
  const auditor = context.auditor || agentCoreStateFor(client.id).auditor || {};
  const themes = [
    profile.morningTheme || "Descoberta e benefício",
    profile.afternoonTheme || "Produto, prova e utilidade",
    profile.eveningTheme || "Conversão e chamada para ação"
  ];
  const questionLead = (leadData.leads || []).find(lead => classifyInteraction(lead.message || lead.lastMessage || lead.interest || "") === "QUESTION");
  const format = suggestFormat({
    goal: profile.contentStrategy,
    topic: themes[0],
    leadQuestion: questionLead?.message || questionLead?.lastMessage || "",
    hasLongVideo: false
  });
  const plan = {
    niche: client.niche || "Outro",
    audience: profile.targetAudience,
    objective: profile.contentStrategy,
    tone: profile.tone,
    themes,
    contentFocus: profile.contentFocus,
    cta: profile.cta,
    hashtags: profile.hashtags,
    avoidTopics: profile.avoidTopics,
    radarTerms: Array.isArray(radar.topTerms) ? radar.topTerms.slice(0, 5) : [],
    feedback: auditor.feedback || "",
    recommendedFormat: format,
    leadQuestion: questionLead?.message || questionLead?.lastMessage || "",
    skills: skillCoverageForAgent("estrategista").map(item => item.id),
    metrics: { published, failed, pending, leads: leadData.summary || {} }
  };
  recordAgentExecution(client, "ESTRATEGISTA", {
    function: options.feedback ? "feedback-loop" : "content-plan",
    trigger: options.trigger,
    startedAt,
    status: "success",
    model: "instagram-skills",
    quantity: 1,
    costUsd: 0,
    message: options.feedback ? "Estratégia atualizada após Auditor." : "Plano editorial atualizado com Radar, leads, formato e nicho.",
    metadata: { published, failed, pending, leadSource: leadData.source || "stored", recommendedFormat: format, skills: plan.skills }
  });
  patchAgentCoreState(client.id, { strategy: plan });
  return plan;
}

async function runCreatorAgent(client, strategy, options = {}) {
  const startedAt = new Date().toISOString();
  const config = agentCoreConfig(client);
  const times = (Array.isArray(client.postTimes) && client.postTimes.length ? client.postTimes : ["09:00","12:00","18:00"]).slice(0, 6);
  const ledger = loadPostLedger();
  const created = [];
  const themes = Array.isArray(strategy?.themes) && strategy.themes.length ? strategy.themes : ["Descoberta","Benefício","Conversão"];
  const focus = String(strategy?.contentFocus || "Benefícios reais, autoridade e conversão").trim();
  const cta = String(strategy?.cta || 'Comente "QUERO" e saiba mais').trim();
  const hashtags = String(strategy?.hashtags || "").trim().split(/\s+/).filter(Boolean).slice(0,5).join(" ");
  const skills = skillCoverageForAgent("creator").map(item => item.id);

  for (let index=0; index<times.length; index++) {
    const time = times[index];
    const scheduledFor = agentCoreScheduleIso(time, index);
    const day = agentCoreLocalDay(scheduledFor);
    const exists = ledger.some(row =>
      row.clientId === client.id
      && String(row.source || "").startsWith("agent-core:creator")
      && String(row.scheduledHour || "") === String(time)
      && agentCoreLocalDay(row.scheduledFor || row.createdAt) === day
    );
    if (exists) continue;

    const theme = themes[index % themes.length];
    const format = index === 0 && strategy?.recommendedFormat ? strategy.recommendedFormat : suggestFormat({
      goal: strategy?.objective || "",
      topic: theme,
      leadQuestion: strategy?.leadQuestion || "",
      hasLongVideo: false
    });
    const hookOptions = buildHookCandidates({
      niche: strategy?.niche || client.niche,
      audience: strategy?.audience || "",
      topic: theme,
      focus,
      question: strategy?.leadQuestion || ""
    });
    const hook = hookOptions[index % Math.max(1, hookOptions.length)] || hookOptions[0] || { text: String(theme), score: 50, formula: "local" };
    const rawCaption = [
      hook.text,
      "",
      String(theme) + ". " + focus + ".",
      "",
      cta,
      hashtags ? "" : null,
      hashtags || null
    ].filter(value => value !== null).join("\n");
    const human = humanizeText(rawCaption);
    const captionCheck = captionAudit(human.text, (strategy?.radarTerms || []).map(item => item.term || item).slice(0,2));
    const caption = captionCheck.text.slice(0,2200);
    const approvalStatus = config.autoPublish && !config.approvalRequired ? "approved" : "pending";
    const row = {
      id: "agentcore:" + client.id + ":" + day + ":" + String(time).replace(":", ""),
      clientId: client.id,
      clientName: client.name || client.id,
      instagram: client.instagram || "",
      scheduledFor,
      scheduledHour: time,
      status: "ready",
      approvalStatus,
      costUsd: 0,
      costCalculated: true,
      model: "instagram-skill-layer",
      mediaId: "",
      imageUrl: "",
      caption,
      title: String(theme).slice(0, 160),
      source: "agent-core:creator",
      error: "",
      retryCount: 0,
      intelligence: {
        format: format?.format || "reel",
        skill: format?.skill || "ig-reel",
        hookFormula: hook.formula || "",
        hookScore: Number(hook.score || 0),
        captionScore: Number(captionCheck.score || 0),
        humanScore: Number(human.score || 0)
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    ledger.push(row);
    created.push(row);
  }
  if (created.length) savePostLedger(ledger);
  recordAgentExecution(client, "CREATOR", {
    function: "multi-format-draft-generation",
    trigger: options.trigger,
    startedAt,
    status: "success",
    model: "instagram-skill-layer",
    quantity: created.length,
    costUsd: 0,
    message: created.length ? created.length + " pauta(s) criadas com hook scoring, humanização e revisão de legenda." : "Agenda já preparada; nenhuma pauta duplicada criada.",
    metadata: { approvalRequired: config.approvalRequired, autoPublish: config.autoPublish, skills, draftIds: created.map(item => item.id), intelligence: created.map(item => item.intelligence) }
  });
  return created;
}

async function runPublisherAgent(client, options = {}) {
  const startedAt = new Date().toISOString();
  const ledger = loadPostLedger();
  const now = Date.now();
  let published = 0;
  let failed = 0;
  let awaitingApproval = 0;
  let awaitingMedia = 0;
  let changed = false;

  const candidates = ledger.filter(row => {
    if (row.clientId !== client.id || row.status === "published") return false;
    const due = !row.scheduledFor || new Date(row.scheduledFor).getTime() <= now;
    const retryDue = !row.nextRetryAt || new Date(row.nextRetryAt).getTime() <= now;
    return due && retryDue && ["ready","scheduled","failed"].includes(String(row.status || ""));
  });

  for (const row of candidates.slice(0, 8)) {
    const approval = cleanApprovalStatus(row.approvalStatus);
    if (approval !== "approved") {
      awaitingApproval += 1;
      continue;
    }
    if (!row.imageUrl) {
      awaitingMedia += 1;
      continue;
    }
    const retryCount = Math.max(0, Number(row.retryCount || 0));
    if (retryCount >= 3 && row.status === "failed") continue;
    row.status = "publishing";
    row.attemptedAt = new Date().toISOString();
    row.updatedAt = row.attemptedAt;
    changed = true;
    savePostLedger(ledger);
    try {
      const result = await publishInstagramImageForClient(client.id, row.imageUrl, row.caption || "");
      row.status = "published";
      row.approvalStatus = "approved";
      row.mediaId = String(result?.id || result?.mediaId || "");
      row.publishedAt = new Date().toISOString();
      row.error = "";
      row.nextRetryAt = null;
      published += 1;
    } catch (error) {
      row.retryCount = retryCount + 1;
      row.status = "failed";
      row.error = String(error?.message || error).slice(0, 900);
      row.nextRetryAt = row.retryCount < 3 ? new Date(Date.now() + row.retryCount * 5 * 60000).toISOString() : null;
      failed += 1;
    }
    row.updatedAt = new Date().toISOString();
  }
  if (changed || published || failed) savePostLedger(ledger);
  const status = failed ? "warning" : "success";
  const shouldLog = candidates.length > 0 || options.trigger !== "scheduler";
  if (shouldLog) {
    recordAgentExecution(client, "PUBLISHER", {
      function: "queue-sweep",
      trigger: options.trigger,
      startedAt,
      status,
      model: "local-rules+meta-api",
      quantity: candidates.length,
      costUsd: 0,
      message: published + " publicada(s), " + awaitingApproval + " aguardando aprovação, " + awaitingMedia + " aguardando mídia, " + failed + " falha(s).",
      metadata: { published, failed, awaitingApproval, awaitingMedia }
    });
  }
  return { published, failed, awaitingApproval, awaitingMedia };
}

async function runAuditorAgent(client, options = {}) {
  const startedAt = new Date().toISOString();
  const snapshot = await fetchInstagramMediaSnapshot(client.id);
  const items = snapshot.items || [];
  const performance = performanceAudit(items);
  const ledger = loadPostLedger().filter(row => row.clientId === client.id);
  const published = ledger.filter(row => row.status === "published").length;
  const failed = ledger.filter(row => row.status === "failed" || row.status === "skipped").length;
  const latestCaptions = ledger.slice(-12).map(row => humanizeText(row.caption || ""));
  const humanAverage = latestCaptions.length ? latestCaptions.reduce((sum,item)=>sum+item.score,0)/latestCaptions.length : 100;
  const top = performance.top?.[0] || null;
  const feedback = top
    ? "O conteúdo com melhor múltiplo sobre a mediana deve inspirar o próximo mecanismo de gancho, sem copiar texto ou visual."
    : (failed > 0 ? "Resolver falhas operacionais antes de aumentar frequência." : "Coletar mais dados e continuar testando ganchos e formatos.");
  const output = {
    source: snapshot.source,
    baseline: performance.baseline,
    topMedia: top,
    outliers: (performance.top || []).slice(0,5),
    published,
    failed,
    humanScore: Math.round(humanAverage),
    feedback,
    skills: skillCoverageForAgent("auditor").map(item => item.id)
  };
  recordAgentExecution(client, "AUDITOR", {
    function: "performance-human-review",
    trigger: options.trigger,
    startedAt,
    status: snapshot.error && !items.length ? "warning" : "success",
    model: "instagram-skills+instagram-api",
    quantity: items.length || ledger.length,
    costUsd: 0,
    message: "AUDITOR comparou desempenho com a mediana da conta e revisou linguagem dos conteúdos.",
    metadata: { source: snapshot.source, published, failed, humanScore: output.humanScore, topOutlier: Number(top?.outlierMultiple || 0), apiError: snapshot.error || "", skills: output.skills }
  });
  patchAgentCoreState(client.id, { auditor: output });
  return output;
}

async function runOdinAgent(client, options = {}) {
  const startedAt = new Date().toISOString();
  const data = await fetchAgentLeads(client).catch(() => ({
    summary: {
      total: Number(client?.leads?.total || 0),
      hot: Number(client?.leads?.hot || 0),
      warm: Number(client?.leads?.warm || 0),
      cold: Number(client?.leads?.cold || 0),
      needsHuman: 0
    },
    leads: [],
    source: "stored"
  }));
  const enriched = (data.leads || []).map(lead => ({
    ...lead,
    conversationClass: classifyInteraction(lead.message || lead.lastMessage || lead.interest || "", client.leadKeyword || "QUERO")
  }));
  const hot = enriched.filter(lead => lead.temperature === "hot" || lead.needsHuman || ["KEYWORD","LEAD"].includes(lead.conversationClass)).slice(0, 30);
  const questions = enriched.filter(lead => lead.conversationClass === "QUESTION").slice(0,10);
  const output = {
    source: data.source || "stored",
    summary: data.summary || {},
    priority: hot,
    questionsForContent: questions,
    buckets: enriched.reduce((acc,lead) => {
      const key = lead.conversationClass || "NOISE";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    skills: skillCoverageForAgent("odin").map(item => item.id)
  };
  recordAgentExecution(client, "ODIN", {
    function: "lead-comment-dm-triage",
    trigger: options.trigger,
    startedAt,
    status: data.error ? "warning" : "success",
    model: "instagram-skills",
    quantity: Number(data.summary?.total || enriched.length || 0),
    costUsd: 0,
    message: hot.length ? hot.length + " contato(s) priorizados; comentários e dúvidas classificados para venda e conteúdo." : "Interações classificadas; nenhuma prioridade comercial imediata.",
    metadata: { source: data.source || "stored", summary: data.summary || {}, buckets: output.buckets, questionCount: questions.length, skills: output.skills }
  });
  patchAgentCoreState(client.id, { odin: output });
  return output;
}

const agentCoreRunning = new Set();

async function runAgentCoreCycle(clientId, options = {}) {
  if (agentCoreRunning.has(clientId)) return { ok: false, skipped: "already_running" };
  const client = loadClients().find(item => item.id === clientId);
  if (!client) throw new Error("client_not_found");
  const config = agentCoreConfig(client);
  const requested = String(options.agent || "all").toLowerCase();
  if (requested !== "all" && !AGENT_CORE_MODULES.some(item => item.id === requested)) throw new Error("invalid_agent");
  if (!config.enabled && options.trigger !== "manual") return { ok: false, skipped: "agent_core_disabled" };

  agentCoreRunning.add(clientId);
  const result = { ok: true, clientId, trigger: options.trigger || "manual", agents: {} };
  try {
    const state = agentCoreStateFor(client.id);
    let radar = state.radar || {};
    let strategy = state.strategy || {};
    let auditor = state.auditor || {};

    const run = id => requested === "all" || requested === id;
    if (run("radar") && config.modules.radar) result.agents.radar = radar = await runRadarAgent(client, options);
    if (run("estrategista") && config.modules.estrategista) result.agents.estrategista = strategy = await runStrategistAgent(client, { radar, auditor }, options);
    if (run("creator") && config.modules.creator) result.agents.creator = await runCreatorAgent(client, strategy, options);
    if (run("publisher") && config.modules.publisher) result.agents.publisher = await runPublisherAgent(client, options);
    if (run("auditor") && config.modules.auditor) {
      result.agents.auditor = auditor = await runAuditorAgent(client, options);
      if (requested === "all" && config.modules.estrategista) {
        result.agents.estrategistaFeedback = await runStrategistAgent(client, { radar, auditor }, { ...options, feedback: true });
      }
    }
    if (run("odin") && config.modules.odin) result.agents.odin = await runOdinAgent(client, options);

    const now = new Date().toISOString();
    patchAgentCoreState(client.id, {
      lastCycleAt: now,
      nextCycleAt: new Date(Date.now() + config.cycleMinutes * 60000).toISOString(),
      lastCycleStatus: "success"
    });
    return result;
  } catch (error) {
    patchAgentCoreState(client.id, { lastCycleAt: new Date().toISOString(), lastCycleStatus: "failed", lastCycleError: String(error?.message || error).slice(0, 500) });
    throw error;
  } finally {
    agentCoreRunning.delete(clientId);
  }
}

let agentCoreSchedulerRunning = false;
async function processAgentCoreScheduler() {
  if (agentCoreSchedulerRunning) return;
  agentCoreSchedulerRunning = true;
  try {
    const clients = loadClients().filter(client => client.status === "online");
    const now = Date.now();
    for (const client of clients) {
      const config = agentCoreConfig(client);
      if (!config.enabled) continue;
      const state = agentCoreStateFor(client.id);
      const hunterConfig = leadHunterConfigFor(client);
      const hunterSummary = leadHunterSummaryForClient(client.id);
      const lastHunter = hunterSummary.lastRunAt ? new Date(hunterSummary.lastRunAt).getTime() : 0;
      const dueHunter = hunterConfig.enabled && hunterConfig.autoRun
        && (!lastHunter || now - lastHunter >= hunterConfig.scanIntervalMinutes * 60000);
      if (dueHunter) {
        const hunter = await runLeadHunter(client, { trigger:"scheduler", automatic:true }).catch(error => {
          console.warn("Lead Hunter failed for " + client.id + ": " + String(error?.message || error));
          return null;
        });
        if (hunter?.ok && config.modules.odin) {
          await runOdinAgent(client, { trigger:"lead-hunter" }).catch(error => {
            console.warn("Odin lead triage failed for " + client.id + ": " + String(error?.message || error));
          });
        }
      }
      const lastCycle = state.lastCycleAt ? new Date(state.lastCycleAt).getTime() : 0;
      const dueFullCycle = !lastCycle || now - lastCycle >= config.cycleMinutes * 60000;
      if (dueFullCycle) {
        await runAgentCoreCycle(client.id, { trigger: "scheduler", agent: "all" }).catch(error => {
          console.warn("Agent Core cycle failed for " + client.id + ": " + String(error?.message || error));
        });
        continue;
      }
      const lastPublisher = state.lastPublisherSweepAt ? new Date(state.lastPublisherSweepAt).getTime() : 0;
      if (config.modules.publisher && (!lastPublisher || now - lastPublisher >= 5 * 60000)) {
        await runPublisherAgent(client, { trigger: "scheduler" }).catch(error => {
          console.warn("Publisher sweep failed for " + client.id + ": " + String(error?.message || error));
        });
        patchAgentCoreState(client.id, { lastPublisherSweepAt: new Date().toISOString() });
      }
    }
  } finally {
    agentCoreSchedulerRunning = false;
  }
}

function agentCoreDashboard() {
  const clients = loadClients();
  const executions = loadAgentExecutions().map(agentCoreExecutionView);
  const today = agentCoreLocalDay();
  const month = today.slice(0, 7);
  const byClient = clients.map(client => {
    const rows = executions.filter(row => row.clientId === client.id);
    const todayRows = rows.filter(row => agentCoreLocalDay(row.finishedAt || row.startedAt) === today);
    const monthRows = rows.filter(row => agentCoreLocalDay(row.finishedAt || row.startedAt).slice(0,7) === month);
    return {
      clientId: client.id,
      clientName: client.name || client.id,
      config: agentCoreConfig(client),
      state: agentCoreStateFor(client.id),
      executionsToday: todayRows.length,
      costTodayUsd: todayRows.reduce((sum,row)=>sum+Number(row.costUsd||0),0),
      costMonthUsd: monthRows.reduce((sum,row)=>sum+Number(row.costUsd||0),0),
      lastExecutions: rows.sort((a,b)=>String(b.finishedAt||"").localeCompare(String(a.finishedAt||""))).slice(0,12)
    };
  });
  return {
    modules: AGENT_CORE_MODULES,
    today,
    month,
    totalExecutionsToday: byClient.reduce((sum,item)=>sum+item.executionsToday,0),
    totalCostTodayUsd: byClient.reduce((sum,item)=>sum+item.costTodayUsd,0),
    totalCostMonthUsd: byClient.reduce((sum,item)=>sum+item.costMonthUsd,0),
    clients: byClient
  };
}

function loadVideoJobs() {
  return readJsonFile(videoJobsFile, []);
}

function saveVideoJobs(value) {
  writeJsonAtomic(videoJobsFile, Array.isArray(value) ? value.slice(-1000) : []);
}

function loadVideoFolders() {
  const rows = readJsonFile(videoFoldersFile, []);
  return Array.isArray(rows) ? rows : [];
}

function saveVideoFolders(value) {
  writeJsonAtomic(videoFoldersFile, Array.isArray(value) ? value.slice(-500) : []);
}

function videoFoldersForClient(clientId) {
  const rows = loadVideoFolders().filter(item => item.clientId === clientId);
  if (!rows.some(item => item.id === "default")) {
    rows.unshift({ id: "default", clientId, name: "Meus vídeos", createdAt: new Date().toISOString() });
  }
  return rows;
}

function videoFormatSpec(value) {
  const key = String(value || "reel").toLowerCase();
  if (key === "feed") return { key: "feed", label: "Instagram Feed 4:5", width: 1080, height: 1350 };
  if (key === "square") return { key: "square", label: "Instagram 1:1", width: 1080, height: 1080 };
  return { key: "reel", label: "Reels / Stories 9:16", width: 1080, height: 1920 };
}

function normalizeSubtitleStyle(options = {}) {
  const size = ["auto","small","medium","large"].includes(String(options.size || "").toLowerCase())
    ? String(options.size).toLowerCase() : "auto";
  const colorKey = ["white","yellow","gold","orange","cyan","blue","green","lime","pink","purple","red"].includes(String(options.color || "").toLowerCase())
    ? String(options.color).toLowerCase() : "white";
  const weight = ["normal","semibold","bold","extrabold"].includes(String(options.weight || "").toLowerCase())
    ? String(options.weight).toLowerCase() : "bold";
  const bgKey = ["black","navy","transparent"].includes(String(options.bg || "").toLowerCase())
    ? String(options.bg).toLowerCase() : "black";
  const colors = {
    white:"white",
    yellow:"0xFFD600",
    gold:"0xFFC107",
    orange:"0xFF8A00",
    cyan:"0x43E8FF",
    blue:"0x4AA8FF",
    green:"0x48E58A",
    lime:"0xA8FF3E",
    pink:"0xFF5DB1",
    purple:"0xB978FF",
    red:"0xFF5252"
  };
  const backgrounds = { black:"black@0.68", navy:"0x061b2b@0.72", transparent:"black@0.0" };
  const fontFile = weight === "normal"
    ? "/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf"
    : "/usr/share/fonts/ttf-dejavu/DejaVuSans-Bold.ttf";
  const borderWidth = weight === "normal" ? 1 : weight === "semibold" ? 1 : weight === "extrabold" ? 4 : 2;
  return {
    size, color:colorKey, weight, bg:bgKey,
    ffmpegColor:colors[colorKey],
    ffmpegBg:backgrounds[bgKey],
    box:bgKey !== "transparent",
    fontFile,
    borderWidth
  };
}

function subtitleFontSizeForFormat(spec, sizeKey = "auto") {
  const auto = Math.round(Math.min(spec.width * 0.042, spec.height * 0.035));
  const multiplier = sizeKey === "small" ? 0.82 : sizeKey === "medium" ? 1 : sizeKey === "large" ? 1.28 : 1;
  return Math.max(28, Math.min(72, Math.round(auto * multiplier)));
}

function deleteVideoJobFiles(job) {
  const targets = new Set();
  if (job?.storedPath) {
    targets.add(job.storedPath);
    const baseDir = path.dirname(job.storedPath);
    targets.add(path.join(baseDir, job.id + "-work"));
    targets.add(path.join(baseDir, job.id + "-clips"));
  }
  for (const clip of job?.clips || []) {
    if (clip?.storedPath) targets.add(clip.storedPath);
  }
  for (const target of targets) {
    try {
      if (!target || !fs.existsSync(target)) continue;
      const stat = fs.statSync(target);
      if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
      else fs.unlinkSync(target);
    } catch {}
  }
}

function portalVideoJobView(job) {
  return {
    id: job.id,
    clientId: job.clientId,
    clientName: job.clientName || job.clientId,
    filename: job.filename,
    displayName: job.displayName || job.filename,
    folderId: job.folderId || "default",
    outputFormat: videoFormatSpec(job.outputFormat).key,
    outputFormatLabel: videoFormatSpec(job.outputFormat).label,
    endText: job.endText || "",
    endContact: job.endContact || "",
    autoSubtitles: Boolean(job.autoSubtitles),
    subtitleSize: job.subtitleSize || "auto",
    subtitleColor: job.subtitleColor || "white",
    subtitleWeight: job.subtitleWeight || "bold",
    subtitleBg: job.subtitleBg || "black",
    detectedLanguage: job.detectedLanguage || "",
    sizeBytes: Number(job.sizeBytes || 0),
    goal: job.goal || "viral",
    clipDuration: Number(job.clipDuration || 30),
    requestedClips: Number(job.requestedClips || 3),
    status: job.status || "queued",
    progress: Number(job.progress || 0),
    message: job.message || "",
    duration: Number(job.duration || 0),
    transcriptAvailable: Boolean(job.transcriptText),
    analysisCostUsd: Number(job.analysisCostUsd || 0),
    clips: Array.isArray(job.clips) ? job.clips.map(clip => ({
      id: clip.id,
      title: clip.title || "",
      reason: clip.reason || "",
      hook: clip.hook || "",
      qualityScore: Number(clip.qualityScore || 0),
      subtitlesApplied: Boolean(clip.subtitlesApplied),
      subtitleSize: clip.subtitleSize || job.subtitleSize || "auto",
      subtitleColor: clip.subtitleColor || job.subtitleColor || "white",
      subtitleWeight: clip.subtitleWeight || job.subtitleWeight || "bold",
      subtitleBg: clip.subtitleBg || job.subtitleBg || "black",
      sourceLanguage: clip.sourceLanguage || job.detectedLanguage || "",
      rank: Number(clip.rank || 0),
      selectedForSchedule: Boolean(clip.selectedForSchedule),
      transcript: clip.transcript || "",
      start: Number(clip.start || 0),
      end: Number(clip.end || 0),
      duration: Number(clip.duration || 0),
      status: clip.status || "draft",
      approvalStatus: clip.approvalStatus || "pending",
      publishStatus: clip.publishStatus || "",
      scheduledFor: clip.scheduledFor || null,
      publishedAt: clip.publishedAt || null,
      mediaId: clip.mediaId || "",
      error: clip.error || "",
      caption: clip.caption || "",
      previewUrl: clip.previewUrl || "",
      outputFormat: clip.outputFormat || videoFormatSpec(job.outputFormat).key,
      endText: clip.endText || job.endText || "",
      endContact: clip.endContact || job.endContact || ""
    })) : [],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt || job.createdAt
  };
}

const videoProcessing = new Set();

function updateVideoJob(jobId, updater) {
  const jobs = loadVideoJobs();
  const job = jobs.find(item => item.id === jobId);
  if (!job) return null;
  if (typeof updater === "function") updater(job);
  else if (updater && typeof updater === "object") Object.assign(job, updater);
  job.updatedAt = new Date().toISOString();
  saveVideoJobs(jobs);
  return job;
}

async function execMedia(command, args, options = {}) {
  return execFileAsync(command, args, {
    timeout: options.timeout || 10 * 60 * 1000,
    maxBuffer: options.maxBuffer || 8 * 1024 * 1024
  });
}

async function probeVideoDuration(file) {
  const { stdout } = await execMedia("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file
  ], { timeout: 30000 });
  const duration = Number(String(stdout || "").trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("video_duration_invalid");
  return duration;
}

function responseOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function videoOpenAIKeyForClient(clientId) {
  // Ragnar is intentionally isolated from the shared NEXUS OpenAI account.
  // Regra NEXUS: sem IA válida o corte inteligente FALHA de forma explícita.
  // Nunca substituir análise inteligente por "primeiros segundos" ou divisão técnica.
  if (clientId === "ragnar-one") {
    const direct = loadConnections()?.[clientId]?.openai;
    return direct?.apiKey ? decryptSecret(direct.apiKey) : "";
  }
  return masterOpenAIProjectKey();
}

async function transcribeVideoAudio(audioPath, durationSeconds, clientId) {
  const apiKey = videoOpenAIKeyForClient(clientId);
  if (!apiKey) throw new Error(clientId === "ragnar-one" ? "ragnar_openai_not_available" : "openai_not_configured");
  const bytes = fs.readFileSync(audioPath);
  if (bytes.length > 25 * 1024 * 1024) throw new Error("audio_too_large_for_transcription");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/mpeg" }), "audio.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: "Bearer " + apiKey },
    body: form,
    signal: AbortSignal.timeout(10 * 60 * 1000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("transcription_failed_" + response.status);
  const segments = Array.isArray(payload.segments) ? payload.segments.map(item => ({
    start: Number(item.start || 0),
    end: Number(item.end || 0),
    text: String(item.text || "").trim()
  })).filter(item => item.text && item.end > item.start) : [];
  return {
    text: String(payload.text || "").trim(),
    segments,
    language: String(payload.language || "").trim(),
    costUsd: Math.max(0, Number(durationSeconds || payload.duration || 0)) / 60 * 0.006
  };
}


function normalizeDetectedLanguage(value) {
  return String(value || "").trim().toLowerCase();
}

function isPortugueseLanguage(value) {
  const lang = normalizeDetectedLanguage(value);
  return !lang || lang === "pt" || lang === "pt-br" || lang === "portuguese" || lang === "português" || lang === "portugues";
}

async function translateClipSegmentsToPtBr(segments, clientId) {
  const rows = (Array.isArray(segments) ? segments : []).filter(item => item?.text).slice(0, 80);
  if (!rows.length) return [];
  const apiKey = videoOpenAIKeyForClient(clientId);
  if (!apiKey) throw new Error(clientId === "ragnar-one" ? "ragnar_openai_not_available" : "openai_not_configured");
  const compact = rows.map((item, index) => ({ i: index, text: String(item.text || "").trim() }));
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      instructions: "Traduza legendas para português brasileiro natural e curto. Preserve sentido, nomes, números e tom. Não resuma, não acrescente informação e não junte itens. Retorne somente JSON válido.",
      input: "Traduza cada item para PT-BR. Entrada: " + JSON.stringify(compact) + "\nRetorne: {\"translations\":[{\"i\":0,\"text\":\"...\"}]}",
      max_output_tokens: 2400
    }),
    signal: AbortSignal.timeout(120000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("subtitle_translation_failed_" + response.status);
  const output = responseOutputText(payload);
  const a = output.indexOf("{"), b = output.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("subtitle_translation_invalid_json");
  let parsed;
  try { parsed = JSON.parse(output.slice(a, b + 1)); }
  catch { throw new Error("subtitle_translation_invalid_json"); }
  const translations = new Map((Array.isArray(parsed.translations) ? parsed.translations : [])
    .map(item => [Number(item.i), String(item.text || "").trim()]));
  const translated = rows.map((item, index) => ({
    start: Number(item.start || 0),
    end: Number(item.end || 0),
    text: translations.get(index) || ""
  })).filter(item => item.text && item.end > item.start);
  if (!translated.length) throw new Error("subtitle_translation_empty");
  return translated;
}

function wrapSubtitleText(value, maxLine = 34, maxLines = 3) {
  const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? current + " " + word : word;
    if (next.length <= maxLine || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.join("\n");
}

function subtitleSegmentsForRange(segments, start, end) {
  return (Array.isArray(segments) ? segments : [])
    .filter(item => Number(item.end || 0) > Number(start || 0) && Number(item.start || 0) < Number(end || 0))
    .map(item => ({
      start: Math.max(Number(start || 0), Number(item.start || 0)),
      end: Math.min(Number(end || 0), Number(item.end || 0)),
      text: String(item.text || "").trim()
    }))
    .filter(item => item.text && item.end > item.start);
}

function transcriptHeuristicSelections(segments, duration, count, targetDuration) {
  if (!Array.isArray(segments) || !segments.length) return [];
  const candidates = [];
  const desired = Math.max(8, Number(targetDuration || 30));
  const maxDuration = Math.min(95, desired + 18);
  const hookWords = /\b(como|porque|por que|segredo|erro|melhor|pior|nunca|sempre|voce|você|aten[cç][aã]o|olha|importante|resultado|dinheiro|venda|cliente|verdade|problema|solu[cç][aã]o|dica|passo|motivo|evite)\b/i;

  for (let i = 0; i < segments.length; i += 1) {
    const startSeg = segments[i];
    let text = "";
    let end = startSeg.end;
    for (let j = i; j < segments.length; j += 1) {
      const seg = segments[j];
      if (seg.end - startSeg.start > maxDuration) break;
      text += (text ? " " : "") + seg.text;
      end = seg.end;
      const len = end - startSeg.start;
      if (len >= desired * 0.72 && (sentenceLooksFinished(seg.text) || len >= desired)) {
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        const density = words / Math.max(1, len);
        const punctuation = /[!?]/.test(text) ? 12 : /[.]\s*$/.test(text) ? 5 : 0;
        const hook = hookWords.test(text) ? 14 : 0;
        const lengthFit = Math.max(0, 18 - Math.abs(len - desired) * 0.8);
        const score = Math.round(Math.min(99, 35 + density * 8 + punctuation + hook + lengthFit));
        candidates.push({
          start: Math.max(0, startSeg.start),
          end: Math.min(duration, end),
          title: "Trecho forte",
          reason: "Selecionado por densidade de fala, gancho e conclusão de ideia.",
          score,
          hook: text.slice(0, 160)
        });
        break;
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.some(item => Math.max(item.start, candidate.start) < Math.min(item.end, candidate.end))) continue;
    selected.push(candidate);
    if (selected.length >= Math.max(1, Number(count || 3))) break;
  }
  return selected;
}

function transcriptForRange(segments, start, end) {
  return segments
    .filter(item => item.end >= start && item.start <= end)
    .map(item => item.text)
    .join(" ")
    .trim()
    .slice(0, 1200);
}

async function detectSpeechSilences(audioPath) {
  try {
    const { stderr = "" } = await execMedia("ffmpeg", [
      "-hide_banner",
      "-i", audioPath,
      "-af", "silencedetect=noise=-35dB:d=0.18",
      "-f", "null",
      "-"
    ], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    const starts = [];
    const ends = [];
    for (const line of String(stderr).split("\n")) {
      const start = /silence_start:\s*([0-9.]+)/.exec(line);
      if (start) starts.push(Number(start[1]));
      const end = /silence_end:\s*([0-9.]+)/.exec(line);
      if (end) ends.push(Number(end[1]));
    }
    return { starts: starts.filter(Number.isFinite), ends: ends.filter(Number.isFinite) };
  } catch {
    return { starts: [], ends: [] };
  }
}

function sentenceLooksFinished(text) {
  return /[.!?…]["')\]]?$/.test(String(text || "").trim());
}

function fitClipToRequestedDuration(clip, duration, targetDuration) {
  const total = Math.max(0, Number(duration || 0));
  const desired = Math.max(8, Number(targetDuration || 30));
  const minWanted = Math.max(6, desired - 2);
  if (total < minWanted) return { ...clip, start: 0, end: total };

  let start = Math.max(0, Math.min(total, Number(clip.start || 0)));
  let end = Math.max(start, Math.min(total, Number(clip.end || start)));
  if (end <= start) end = Math.min(total, start + desired);

  const current = end - start;
  if (current < desired) {
    const center = (start + end) / 2;
    start = center - desired / 2;
    end = center + desired / 2;
    if (start < 0) { end = Math.min(total, end - start); start = 0; }
    if (end > total) { start = Math.max(0, start - (end - total)); end = total; }
  } else if (current > desired + 10) {
    const center = (start + end) / 2;
    start = Math.max(0, center - desired / 2);
    end = Math.min(total, start + desired);
    if (end - start < desired) start = Math.max(0, end - desired);
  }

  if (end - start < minWanted && total >= minWanted) {
    if (end >= total - 0.01) start = Math.max(0, total - desired);
    else end = Math.min(total, start + desired);
    if (end - start < minWanted) start = Math.max(0, end - minWanted);
  }
  return { ...clip, start, end };
}

function refineClipBoundary(clip, segments, silences, duration, targetDuration) {
  const total = Math.max(0, Number(duration || 0));
  const desired = Math.max(8, Number(targetDuration || 30));
  const minWanted = Math.max(6, desired - 2);
  const maxWanted = Math.min(95, desired + 10);
  let fitted = fitClipToRequestedDuration(clip, total, desired);
  let start = fitted.start;
  let end = fitted.end;

  if (segments.length) {
    let startIndex = segments.findIndex(seg => Number(seg.end || 0) >= start);
    if (startIndex < 0) startIndex = Math.max(0, segments.length - 1);
    const previousIndex = Math.max(0, startIndex - 1);
    const previous = segments[previousIndex];
    const current = segments[startIndex];
    if (previous && current && start > Number(current.start || 0) + 0.15) {
      start = Math.max(0, Number(current.start || start) - 0.12);
    } else if (current) {
      start = Math.max(0, Number(current.start || start) - 0.12);
    }

    let endIndex = segments.findIndex(seg => Number(seg.end || 0) >= end);
    if (endIndex < startIndex) endIndex = startIndex;
    if (endIndex < 0) endIndex = segments.length - 1;
    if (segments[endIndex]) end = Math.min(total, Number(segments[endIndex].end || end) + 0.22);

    while (end - start < minWanted && endIndex + 1 < segments.length) {
      const next = segments[endIndex + 1];
      if (Number(next.end || 0) - start > maxWanted) break;
      endIndex += 1;
      end = Math.min(total, Number(next.end || end) + 0.22);
    }

    while (endIndex + 1 < segments.length && end - start < desired) {
      const next = segments[endIndex + 1];
      if (Number(next.end || 0) - start > maxWanted) break;
      endIndex += 1;
      end = Math.min(total, Number(next.end || end) + 0.22);
      if (end - start >= desired && sentenceLooksFinished(next.text)) break;
    }
  }

  const nextSilence = (silences?.starts || [])
    .filter(point => point >= end - 0.15 && point <= Math.min(total, end + 4) && point - start >= minWanted)
    .sort((a, b) => a - b)[0];
  if (Number.isFinite(nextSilence) && nextSilence - start <= maxWanted) end = Math.min(total, nextSilence + 0.08);

  if (end - start < minWanted && total >= minWanted) {
    // Se a escolha da IA caiu perto do final do vídeo, recua o início em vez de aceitar 2s/13s.
    start = Math.max(0, Math.min(start, end - minWanted));
    if (end - start < minWanted) {
      end = Math.min(total, start + desired);
      if (end - start < minWanted) start = Math.max(0, end - desired);
    }
  }

  if (end - start > maxWanted) end = Math.min(total, start + maxWanted);
  return { ...clip, start, end };
}

function validateRequestedClipSet(clips, videoDuration, requestedClips, targetDuration) {
  const desired = Math.max(8, Number(targetDuration || 30));
  const minWanted = Math.max(6, desired - 2);
  const count = Math.max(1, Number(requestedClips || 1));
  const total = Math.max(0, Number(videoDuration || 0));

  if (total < minWanted) {
    throw new Error("video_insufficient_duration:" + total.toFixed(2) + ":" + count + ":" + desired);
  }
  if (total < minWanted * count) {
    throw new Error("video_insufficient_duration_for_count:" + total.toFixed(2) + ":" + count + ":" + desired);
  }
  if (!Array.isArray(clips) || clips.length !== count) throw new Error("clip_selection_incomplete");

  for (const clip of clips) {
    const len = Number(clip.end || 0) - Number(clip.start || 0);
    if (!Number.isFinite(len) || len < minWanted) {
      throw new Error("clip_duration_below_target:" + len.toFixed(2) + ":" + desired);
    }
  }

  const sorted = [...clips].sort((a,b)=>Number(a.start||0)-Number(b.start||0));
  for (let i=1;i<sorted.length;i+=1) {
    if (Number(sorted[i].start||0) < Number(sorted[i-1].end||0) - 0.15) {
      throw new Error("clip_windows_overlap");
    }
  }
  return true;
}

async function selectSmartClips(transcription, duration, count, targetDuration, goal, clientId) {
  const segments = Array.isArray(transcription?.segments) ? transcription.segments : [];
  if (!segments.length) throw new Error("smart_transcript_required");
  const desiredCount = Math.max(1, Number(count || 3));
  const desiredDuration = Math.max(8, Number(targetDuration || 30));
  const compact = segments.map(item => "[" + item.start.toFixed(1) + "-" + item.end.toFixed(1) + "] " + item.text).join("\n").slice(0, 120000);
  const preRanked = repurposeCandidates(segments, desiredDuration, Math.max(16, desiredCount * 6));
  const heuristic = transcriptHeuristicSelections(segments, duration, Math.max(12, desiredCount * 5), desiredDuration);
  const hints = preRanked.map((item,index) =>
    "#" + (index + 1) + " " + item.start.toFixed(1) + "-" + item.end.toFixed(1) + " score=" + item.score + " hook=" + item.hookScore + " :: " + item.text.slice(0,220)
  ).join("\n");
  const apiKey = videoOpenAIKeyForClient(clientId);
  if (!apiKey) throw new Error(clientId === "ragnar-one" ? "ragnar_openai_not_available" : "openai_not_configured");

  const normalizeCandidate = (item, index, source = "ai") => {
    let start = Math.max(0, Number(item.start || 0));
    let end = Math.min(duration, Number(item.end || start + desiredDuration));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const fitted = fitClipToRequestedDuration({ start, end }, duration, desiredDuration);
    start = fitted.start;
    end = fitted.end;
    const text = String(item.text || item.hook || "").trim();
    return {
      start,
      end,
      title: String(item.title || ("Corte " + (index + 1))).slice(0,100),
      reason: String(item.reason || (source === "ai"
        ? "Trecho escolhido pela IA."
        : "Trecho selecionado pelo ranking inteligente da transcrição completa.")).slice(0,300),
      hook: String(item.hook || text.slice(0,220)).slice(0,220),
      score: Math.max(1,Math.min(100,Number(item.score || item.hookScore || (source === "ai" ? 70 : 60)))),
      selectionSource: source
    };
  };

  const pickNonOverlapping = candidates => {
    const unique = [];
    for (const clip of candidates.filter(Boolean).sort((a,b)=>Number(b.score||0)-Number(a.score||0))) {
      if (unique.some(item => Math.max(item.start,clip.start) < Math.min(item.end,clip.end))) continue;
      unique.push(clip);
      if (unique.length >= desiredCount) break;
    }
    return unique;
  };

  let totalCost = 0;
  let bestAi = [];
  let lastError = "clip_selection_incomplete";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prompt = "Você é o editor sênior do NEXUS AI usando a habilidade ig-repurpose.\n"
      + "Analise o vídeo INTEIRO antes de escolher. Escolha exatamente " + desiredCount + " melhores trechos independentes para " + (goal || "engajamento") + ".\n"
      + "Não divida o vídeo em partes iguais e não privilegie os primeiros segundos. Escolha os pontos de maior valor, gancho, clareza, emoção, prova ou informação.\n"
      + "Cada corte deve ficar o mais próximo possível de " + desiredDuration + " segundos. Aceite alguns segundos a mais para concluir a fala, mas nunca entregue 13s quando foram pedidos 30s se houver material suficiente.\n"
      + "REGRA CRÍTICA: nunca cortar palavra, frase, resposta, CTA ou despedida. O corte começa e termina em ideia natural.\n"
      + "Não escolha trechos sobrepostos. Não invente falas. Dê score de 1 a 100 e explique o motivo.\n"
      + (attempt > 1 ? "Na tentativa anterior faltaram trechos válidos; desta vez distribua melhor as escolhas ao longo do vídeo e evite intervalos sobrepostos.\n" : "")
      + "Pré-ranking local (apenas pistas; você deve validar pela transcrição):\n" + hints + "\n\n"
      + "Transcrição completa com timestamps:\n" + compact + "\n\n"
      + "Responda SOMENTE JSON válido: {\"clips\":[{\"start\":12.3,\"end\":42.0,\"title\":\"Título curto\",\"hook\":\"Primeira ideia forte\",\"reason\":\"Por que funciona\",\"score\":94}]}";

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-luna", input: prompt, max_output_tokens: 2200 }),
      signal: AbortSignal.timeout(150000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("clip_selection_failed_" + response.status);
    const usage = payload.usage || {};
    totalCost += Math.max(0, Number(usage.input_tokens || 0)) * 0.20 / 1_000_000
      + Math.max(0, Number(usage.output_tokens || 0)) * 1.20 / 1_000_000;
    const output = responseOutputText(payload);
    const startJson = output.indexOf("{");
    const endJson = output.lastIndexOf("}");
    if (startJson < 0 || endJson <= startJson) {
      lastError = "clip_selection_invalid_json";
      continue;
    }
    let parsed;
    try { parsed = JSON.parse(output.slice(startJson, endJson + 1)); }
    catch { lastError = "clip_selection_invalid_json"; continue; }

    const selected = Array.isArray(parsed.clips) ? parsed.clips : [];
    const normalized = selected.map((item,index)=>normalizeCandidate(item,index,"ai")).filter(Boolean);
    const unique = pickNonOverlapping(normalized);
    if (unique.length > bestAi.length) bestAi = unique;
    if (unique.length === desiredCount) {
      return { clips: unique, costUsd: totalCost, model: "gpt-5.6-luna+ig-repurpose", preRanked };
    }
    lastError = "clip_selection_incomplete";
  }

  // Segunda camada inteligente: completa as escolhas da IA usando a análise da transcrição inteira.
  // Não é divisão técnica do vídeo e não privilegia os primeiros segundos.
  const localPool = [
    ...preRanked.map((item,index)=>normalizeCandidate({
      ...item,
      title:"Momento forte " + (index + 1),
      reason:"Selecionado pelo ig-repurpose local após analisar toda a transcrição."
    },index,"ig-repurpose-local")),
    ...heuristic.map((item,index)=>normalizeCandidate({
      ...item,
      title:item.title || ("Momento relevante " + (index + 1)),
      reason:item.reason || "Selecionado pelo ranking semântico e de gancho da transcrição."
    },index,"transcript-ranking"))
  ].filter(Boolean);

  const combined = pickNonOverlapping([...bestAi, ...localPool]);
  if (combined.length === desiredCount) {
    return {
      clips: combined,
      costUsd: totalCost,
      model: bestAi.length ? "gpt-5.6-luna+ig-repurpose+local-ranking" : "ig-repurpose+local-ranking",
      preRanked,
      completedByLocalRanking: true
    };
  }

  throw new Error(lastError);
}

function escapeFfmpegDrawtext(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/\n/g, "\\n");
}

async function renderVideoClip(inputPath, outputPath, start, end, outputFormat = "reel", endText = "", endContact = "", subtitleSegments = [], subtitleOptions = {}) {
  const duration = Math.max(3, Number(end) - Number(start));
  const spec = videoFormatSpec(outputFormat);
  const finalText = String(endText || "").trim().slice(0, 90);
  const finalContact = String(endContact || "").trim().slice(0, 90);
  const outroStart = Math.max(0, duration - 3);
  const defaultFontFile = "/usr/share/fonts/ttf-dejavu/DejaVuSans-Bold.ttf";
  const subtitleStyle = normalizeSubtitleStyle(subtitleOptions);
  const subtitleFontFile = subtitleStyle.fontFile || defaultFontFile;
  const subtitleFontSize = subtitleFontSizeForFormat(spec, subtitleStyle.size);
  const subtitleLineSpacing = Math.max(5, Math.round(subtitleFontSize * 0.18));
  const subtitleBoxBorder = Math.max(8, Math.round(subtitleFontSize * 0.32));

  const filters = [
    "[0:v]split=2[bg][fg]",
    "[bg]scale=" + spec.width + ":" + spec.height + ":force_original_aspect_ratio=increase,crop=" + spec.width + ":" + spec.height + ",boxblur=20:10[bg2]",
    "[fg]scale=" + spec.width + ":" + spec.height + ":force_original_aspect_ratio=decrease[fg2]",
    "[bg2][fg2]overlay=(W-w)/2:(H-h)/2,format=yuv420p[base]"
  ];

  let videoLabel = "base";
  const subtitles = (Array.isArray(subtitleSegments) ? subtitleSegments : []).slice(0, 30);
  for (let index = 0; index < subtitles.length; index += 1) {
    const subtitle = subtitles[index];
    const from = Math.max(0, Number(subtitle.start || 0) - Number(start || 0));
    const to = Math.min(duration, Number(subtitle.end || 0) - Number(start || 0));
    if (!(to > from)) continue;
    const text = wrapSubtitleText(subtitle.text || "");
    if (!text) continue;
    const nextLabel = "subtitle" + index;
    filters.push("[" + videoLabel + "]drawtext=fontfile=" + subtitleFontFile
      + ":text='" + escapeFfmpegDrawtext(text) + "'"
      + ":fontcolor=" + subtitleStyle.ffmpegColor + ":fontsize=" + subtitleFontSize
      + ":line_spacing=" + subtitleLineSpacing
      + ":box=" + (subtitleStyle.box ? "1" : "0") + ":boxcolor=" + subtitleStyle.ffmpegBg + ":boxborderw=" + subtitleBoxBorder
      + ":borderw=" + subtitleStyle.borderWidth + ":bordercolor=black@0.9"
      + ":x=(w-text_w)/2:y=h*0.78-text_h/2"
      + ":enable='between(t," + from.toFixed(3) + "," + to.toFixed(3) + ")'[" + nextLabel + "]");
    videoLabel = nextLabel;
  }

  if (finalText || finalContact) {
    filters.push("[" + videoLabel + "]drawbox=x=0:y=ih*0.68:w=iw:h=ih*0.32:color=black@0.62:t=fill:enable='gte(t," + outroStart.toFixed(3) + ")'[outbox]");
    videoLabel = "outbox";
    if (finalText) {
      filters.push("[" + videoLabel + "]drawtext=fontfile=" + defaultFontFile + ":text='" + escapeFfmpegDrawtext(finalText) + "':fontcolor=white:fontsize=" + Math.round(spec.width * 0.052) + ":borderw=2:bordercolor=black@0.7:x=(w-text_w)/2:y=h*0.75:enable='gte(t," + outroStart.toFixed(3) + ")'[outtext]");
      videoLabel = "outtext";
    }
    if (finalContact) {
      filters.push("[" + videoLabel + "]drawtext=fontfile=" + defaultFontFile + ":text='" + escapeFfmpegDrawtext(finalContact) + "':fontcolor=white:fontsize=" + Math.round(spec.width * 0.035) + ":borderw=2:bordercolor=black@0.7:x=(w-text_w)/2:y=h*0.84:enable='gte(t," + outroStart.toFixed(3) + ")'[outcontact]");
      videoLabel = "outcontact";
    }
  }

  await execMedia("ffmpeg", [
    "-y",
    "-ss", Number(start).toFixed(3),
    "-i", inputPath,
    "-t", duration.toFixed(3),
    "-filter_complex", filters.join(";"),
    "-map", "[" + videoLabel + "]",
    "-map", "0:a?",
    "-r", "30",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "48000",
    "-movflags", "+faststart",
    outputPath
  ]);
}

async function processVideoJob(jobId) {
  if (videoProcessing.has(jobId)) return;
  videoProcessing.add(jobId);
  let audioPath = "";
  try {
    const initial = loadVideoJobs().find(item => item.id === jobId);
    if (!initial || !initial.storedPath || !fs.existsSync(initial.storedPath)) throw new Error("video_file_missing");
    const client = loadClients().find(item => item.id === initial.clientId);
    if (!client) throw new Error("client_not_found");

    updateVideoJob(jobId, { status: "transcribing", progress: 10, message: "RADAR analisando o vídeo inteiro e preparando a transcrição…" });
    const duration = await probeVideoDuration(initial.storedPath);
    updateVideoJob(jobId, { duration });
    const requestedCount = Math.max(1, Number(initial.requestedClips || 3));
    const requestedDuration = Math.max(8, Number(initial.clipDuration || 30));
    const minimumPerClip = Math.max(6, requestedDuration - 2);
    if (duration < minimumPerClip) {
      throw new Error("video_insufficient_duration:" + duration.toFixed(2) + ":" + requestedCount + ":" + requestedDuration);
    }
    if (duration < minimumPerClip * requestedCount) {
      throw new Error("video_insufficient_duration_for_count:" + duration.toFixed(2) + ":" + requestedCount + ":" + requestedDuration);
    }

    const workDir = path.join(path.dirname(initial.storedPath), initial.id + "-work");
    fs.mkdirSync(workDir, { recursive: true });
    audioPath = path.join(workDir, "audio.mp3");
    await execMedia("ffmpeg", ["-y","-i",initial.storedPath,"-vn","-ac","1","-ar","16000","-b:a","24k",audioPath]);

    updateVideoJob(jobId, { status: "transcribing", progress: 24, message: "RADAR transcrevendo e entendendo o conteúdo completo…" });
    let transcription;
    try {
      transcription = await transcribeVideoAudio(audioPath, duration, initial.clientId);
    } catch (error) {
      throw new Error("smart_transcript_required:" + String(error?.message || error));
    }
    if (!transcription.segments?.length) throw new Error("smart_transcript_required:no_segments");
    const detectedLanguage = transcription.language || "desconhecido";
    updateVideoJob(jobId, { detectedLanguage });
    const speechSilences = await detectSpeechSilences(audioPath);
    recordAgentExecution(client, "RADAR", {
      function: "video-full-transcript-analysis", trigger: "video-upload", status: "success",
      model: "whisper-1+ig-repurpose", quantity: transcription.segments.length, costUsd: Number(transcription.costUsd || 0),
      message: "Vídeo inteiro transcrito antes de qualquer corte.", metadata: { jobId, duration, detectedLanguage: transcription.language || "" }
    });

    updateVideoJob(jobId, job => {
      job.status = "selecting";
      job.progress = 42;
      job.message = "ESTRATEGISTA e CREATOR escolhendo os melhores momentos com IA…";
      job.transcriptText = transcription.text || "";
      job.transcriptSegments = transcription.segments || [];
      job.analysisCostUsd = Number(job.analysisCostUsd || 0) + Number(transcription.costUsd || 0);
    });

    recordAgentExecution(client, "ESTRATEGISTA", {
      function: "video-content-strategy", trigger: "video-upload", status: "success",
      model: "instagram-skills", quantity: Number(initial.requestedClips || 3), costUsd: 0,
      message: "Objetivo, duração e formato definidos para a seleção dos melhores momentos.",
      metadata: { jobId, goal: initial.goal, targetDuration: initial.clipDuration, requestedClips: initial.requestedClips }
    });

    const selection = await selectSmartClips(
      transcription,
      duration,
      Number(initial.requestedClips || 3),
      Number(initial.clipDuration || 30),
      initial.goal || "viral",
      initial.clientId
    );
    selection.clips = selection.clips.map(clip => refineClipBoundary(
      clip, transcription.segments || [], speechSilences, duration, Number(initial.clipDuration || 30)
    ));
    validateRequestedClipSet(
      selection.clips,
      duration,
      Number(initial.requestedClips || 3),
      Number(initial.clipDuration || 30)
    );

    recordAgentExecution(client, "CREATOR", {
      function: "video-smart-clip-selection", trigger: "video-upload", status: "success",
      model: selection.model || "gpt-5.6-luna+ig-repurpose", quantity: selection.clips.length, costUsd: Number(selection.costUsd || 0),
      message: selection.clips.length + " melhores momentos selecionados pela IA, sem divisão técnica do vídeo.",
      metadata: { jobId, selections: selection.clips.map(item => ({ start:item.start,end:item.end,score:item.score,title:item.title })) }
    });

    updateVideoJob(jobId, job => {
      job.status = "cutting";
      job.progress = 56;
      job.message = "CREATOR editando e AUDITOR verificando fala, duração e gancho…";
      job.selectionModel = selection.model || "gpt-5.6-luna+ig-repurpose";
      job.analysisCostUsd = Number(job.analysisCostUsd || 0) + Number(selection.costUsd || 0);
      job.clips = [];
    });

    const clipDir = path.join(path.dirname(initial.storedPath), initial.id + "-clips");
    fs.mkdirSync(clipDir, { recursive: true });
    const clips = [];
    for (let index=0; index<selection.clips.length; index+=1) {
      const selected = selection.clips[index];
      const clipId = "clip_" + crypto.randomBytes(7).toString("hex");
      const publicName = initial.id + "-" + clipId + "-" + crypto.randomBytes(6).toString("hex") + ".mp4";
      const outputPath = path.join(clipDir, publicName);
      const sourceSegments = subtitleSegmentsForRange(transcription.segments, selected.start, selected.end);
      const shouldSubtitle = Boolean(initial.autoSubtitles) && !isPortugueseLanguage(transcription.language);
      const translatedSubtitles = shouldSubtitle ? await translateClipSegmentsToPtBr(sourceSegments, initial.clientId) : [];
      await renderVideoClip(
        initial.storedPath, outputPath, selected.start, selected.end,
        initial.outputFormat || "reel", initial.endText || "", initial.endContact || "",
        translatedSubtitles,
        { size: initial.subtitleSize, color: initial.subtitleColor, weight: initial.subtitleWeight, bg: initial.subtitleBg }
      );
      const transcript = transcriptForRange(transcription.segments, selected.start, selected.end);
      const reviewText = translatedSubtitles.length ? translatedSubtitles.map(item => item.text).join(" ") : transcript;
      const hookReview = scoreHook(reviewText.slice(0,220));
      const beatReview = estimateBeats(transcript, Number(initial.clipDuration || 30));
      const combinedScore = Math.round(Math.min(100, Number(selected.score || 0) * .65 + Number(hookReview.score || 0) * .35));
      clips.push({
        id: clipId, publicName, storedPath: outputPath,
        title: selected.title || "Corte " + (index + 1),
        reason: selected.reason || "",
        hook: selected.hook || transcript.slice(0,180),
        qualityScore: combinedScore,
        rank: index + 1,
        selectedForSchedule: false,
        transcript,
        start: Number(selected.start),
        end: Number(selected.end),
        duration: Number(selected.end) - Number(selected.start),
        status: "ready",
        approvalStatus: "pending",
        publishStatus: "",
        scheduledFor: null,
        caption: humanizeText(selected.title || "").text,
        previewUrl: "/video-media/" + encodeURIComponent(publicName),
        outputFormat: videoFormatSpec(initial.outputFormat).key,
        endText: initial.endText || "",
        endContact: initial.endContact || "",
        subtitlesApplied: translatedSubtitles.length > 0,
        subtitleLanguage: translatedSubtitles.length ? "pt-BR" : "",
        subtitleSize: initial.subtitleSize || "auto",
        subtitleColor: initial.subtitleColor || "white",
        subtitleWeight: initial.subtitleWeight || "bold",
        subtitleBg: initial.subtitleBg || "black",
        sourceLanguage: transcription.language || "",
        subtitleSegments: translatedSubtitles,
        intelligence: { hookScore: hookReview.score, beatIssues: beatReview.issues, targetDuration: Number(initial.clipDuration || 30), selectionModel: selection.model },
        createdAt: new Date().toISOString()
      });
      updateVideoJob(jobId, { progress: 56 + Math.round((index + 1) / selection.clips.length * 38), message: "Criando e revisando corte " + (index + 1) + " de " + selection.clips.length + "…" });
    }

    const shortClips = clips.filter(clip => clip.duration < Math.max(6,Number(initial.clipDuration || 30)-2));
    if (shortClips.length) {
      throw new Error("clip_duration_below_target:" + Number(shortClips[0].duration || 0).toFixed(2) + ":" + Number(initial.clipDuration || 30));
    }
    const weak = clips.filter(clip => clip.qualityScore < 45);
    recordAgentExecution(client, "AUDITOR", {
      function: "video-clip-quality-gate", trigger: "video-upload", status: weak.length ? "warning" : "success",
      model: "ig-human+hookscore+beats", quantity: clips.length, costUsd: 0,
      message: weak.length ? weak.length + " corte(s) ficaram abaixo do alvo de qualidade/duração e exigem revisão." : "Cortes revisados: fala preservada, duração próxima do alvo e ganchos pontuados.",
      metadata: { jobId, clips: clips.map(item => ({ id:item.id,duration:item.duration,qualityScore:item.qualityScore,issues:item.intelligence?.beatIssues || [] })) }
    });
    recordAgentExecution(client, "ODIN", {
      function: "video-conversion-path", trigger: "video-upload", status: "success", model: "ig-dm+ig-reply",
      quantity: clips.length, costUsd: 0,
      message: "CTA e caminho de conversão preparados para os cortes; publicação continua dependendo da aprovação do cliente.",
      metadata: { jobId, goal: initial.goal, endText: initial.endText || "", endContact: initial.endContact || "" }
    });
    recordAgentExecution(client, "PUBLISHER", {
      function: "video-package-ready", trigger: "video-upload", status: "success", model: "local-media-pipeline",
      quantity: clips.length, costUsd: 0,
      message: "Cortes preparados para revisão. Nenhum vídeo foi publicado ou agendado automaticamente.",
      metadata: { jobId, approvalRequired: true }
    });

    updateVideoJob(jobId, job => {
      job.status = "ready";
      job.progress = 100;
      job.message = "IA concluiu a análise. Cortes prontos para assistir, aprovar, rejeitar ou agendar.";
      job.clips = clips;
      job.completedAt = new Date().toISOString();
    });
  } catch (error) {
    console.error("Video processing failed", jobId, error);
    const code = String(error?.message || error);
    let friendlyMessage = "Falha ao processar o vídeo.";
    if (code.startsWith("video_insufficient_duration_for_count:")) {
      const [, rawDuration, rawCount, rawTarget] = code.split(":");
      const sourceSeconds = Math.round(Number(rawDuration || 0));
      const count = Math.max(1, Number(rawCount || 1));
      const target = Math.max(8, Number(rawTarget || 30));
      const needed = Math.max(1, Math.round((target - 2) * count));
      friendlyMessage = "Este vídeo tem cerca de " + sourceSeconds + "s. Para gerar " + count + " cortes independentes de " + target + "s, envie um vídeo com pelo menos cerca de " + needed + "s. O NEXUS não vai dividir o vídeo em pedaços curtos.";
    } else if (code.startsWith("video_insufficient_duration:")) {
      const [, rawDuration, , rawTarget] = code.split(":");
      const sourceSeconds = Math.round(Number(rawDuration || 0));
      const target = Math.max(8, Number(rawTarget || 30));
      friendlyMessage = "Este vídeo tem cerca de " + sourceSeconds + "s e é curto demais para um corte de " + target + "s. Envie um vídeo mais longo ou escolha uma duração menor.";
    } else if (code.startsWith("clip_duration_below_target:") || code.includes("clip_windows_overlap")) {
      friendlyMessage = "A IA encontrou bons momentos, mas eles não atendem à duração solicitada sem sobrepor ou cortar a fala. Nenhum corte curto foi entregue. Tente novamente ou envie um vídeo mais longo.";
    } else if (code.includes("subtitle_translation_")) {
      friendlyMessage = "O corte foi identificado, mas a tradução das legendas para PT-BR falhou. O NEXUS não vai entregar o vídeo sem a legenda solicitada; tente novamente.";
    } else if (["smart_clip_analysis_unavailable","smart_transcript_required","ragnar_openai_not_available","openai_not_configured","clip_selection_incomplete","clip_selection_failed_"].some(item => code.includes(item))) {
      friendlyMessage = "A análise inteligente não foi concluída. O NEXUS não fará corte técnico ou pegará os primeiros segundos; corrija a IA e tente novamente.";
    }
    updateVideoJob(jobId, {
      status: "failed",
      progress: 100,
      message: friendlyMessage,
      error: code.slice(0,900)
    });
  } finally {
    if (audioPath) { try { fs.unlinkSync(audioPath); } catch {} }
    videoProcessing.delete(jobId);
  }
}

async function searchOfficialTrailers(query, type = "movie", clientId = "") {
  const q = String(query || "").trim().slice(0,120);
  const kind = type === "series" ? "tv" : "movie";
  if (!q) return { configured: false, source: "none", results: [] };
  const token = String(process.env.TMDB_API_TOKEN || "").trim();
  const apiKey = String(process.env.TMDB_API_KEY || "").trim();
  const youtubeSearchUrl = "https://www.youtube.com/results?search_query=" + encodeURIComponent(q + " trailer oficial");

  const youtubeVideoId = value => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const parsed = new URL(raw);
      if (/youtu\.be$/i.test(parsed.hostname)) return parsed.pathname.split("/").filter(Boolean)[0] || "";
      if (/youtube\.com$/i.test(parsed.hostname) || /www\.youtube\.com$/i.test(parsed.hostname)) {
        if (parsed.pathname === "/watch") return parsed.searchParams.get("v") || "";
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (["shorts","embed","live"].includes(parts[0])) return parts[1] || "";
      }
    } catch {}
    return "";
  };

  const youtubeThumbnail = value => {
    const id = youtubeVideoId(value);
    return id ? "https://i.ytimg.com/vi/" + encodeURIComponent(id) + "/hqdefault.jpg" : "";
  };

  const normalizeResult = item => {
    const rawTrailerUrl = String(item.trailerUrl || "").trim();
    const trailerUrl = /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=|^https:\/\/youtu\.be\/|^https:\/\/(?:www\.)?youtube\.com\/(?:shorts|embed|live)\//i.test(rawTrailerUrl)
      ? rawTrailerUrl : "";
    const trailerThumb = youtubeThumbnail(trailerUrl);
    const explicitPoster = String(item.posterUrl || "").trim();
    return {
      id: item.id || "",
      type: item.type === "series" || kind === "tv" ? "series" : "movie",
      title: String(item.title || item.name || q).slice(0,160),
      year: String(item.year || item.release_date || item.first_air_date || "").slice(0,4),
      overview: String(item.overview || item.synopsis || "").slice(0,600),
      posterUrl: explicitPoster || trailerThumb,
      posterFallbackUrl: trailerThumb,
      imageSource: explicitPoster ? "poster" : (trailerThumb ? "youtube-trailer" : "none"),
      trailerUrl,
      trailerName: String(item.trailerName || item.channel || "").slice(0,180),
      official: item.official === true,
      youtubeSearchUrl: String(item.youtubeSearchUrl || youtubeSearchUrl)
    };
  };

  if (token || apiKey) {
    const tmdbGet = async (pathname, params = {}, language = "pt-BR") => {
      const endpoint = new URL("https://api.themoviedb.org/3/" + pathname.replace(/^\/+/, ""));
      endpoint.searchParams.set("language", language);
      for (const [key,value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") endpoint.searchParams.set(key,String(value));
      if (apiKey) endpoint.searchParams.set("api_key",apiKey);
      const response = await fetch(endpoint, {
        headers: { accept:"application/json", ...(token ? { authorization:"Bearer " + token } : {}) },
        signal: AbortSignal.timeout(12000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("tmdb_" + response.status);
      return payload;
    };

    const search = await tmdbGet("search/" + kind, { query:q, include_adult:"false" });
    const base = (Array.isArray(search.results) ? search.results : []).slice(0,8);
    const results = [];
    for (const item of base) {
      let videos = [];
      try {
        let v = await tmdbGet(kind + "/" + item.id + "/videos");
        videos = Array.isArray(v.results) ? v.results : [];
        if (!videos.length) {
          v = await tmdbGet(kind + "/" + item.id + "/videos", {}, "en-US");
          videos = Array.isArray(v.results) ? v.results : [];
        }
      } catch {}
      const youtube = videos.filter(v => v.site === "YouTube");
      const trailer = youtube.find(v => v.official === true && v.type === "Trailer")
        || youtube.find(v => v.type === "Trailer")
        || youtube.find(v => v.official === true)
        || null;
      const title = String(kind === "tv" ? item.name : item.title || q);
      const date = String(kind === "tv" ? item.first_air_date : item.release_date || "");
      results.push(normalizeResult({
        id: item.id,
        type: kind === "tv" ? "series" : "movie",
        title,
        year: date.slice(0,4),
        overview: item.overview || "",
        posterUrl: item.poster_path ? "https://image.tmdb.org/t/p/w342" + item.poster_path : "",
        trailerUrl: trailer?.key ? "https://www.youtube.com/watch?v=" + encodeURIComponent(trailer.key) : "",
        trailerName: trailer?.name || "",
        official: Boolean(trailer?.official),
        youtubeSearchUrl: "https://www.youtube.com/results?search_query=" + encodeURIComponent(title + " " + date.slice(0,4) + " trailer oficial")
      }));
    }
    return { configured:true, source:"tmdb", results, youtubeSearchUrl };
  }

  // Sem TMDB, o NEXUS usa a própria camada de IA com pesquisa web.
  // Para Ragnar, respeita a separação da conta OpenAI; para os demais usa a conta NEXUS.
  const aiKey = videoOpenAIKeyForClient(clientId);
  if (aiKey) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method:"POST",
        headers:{ authorization:"Bearer " + aiKey, "content-type":"application/json" },
        body:JSON.stringify({
          model:"gpt-5.6-luna",
          tools:[{ type:"web_search" }],
          instructions:"Você localiza trailers oficiais de filmes e séries. Priorize links do YouTube publicados pelo estúdio, distribuidora, streaming oficial ou canal oficial da obra. Nunca invente URL. Se não puder confirmar um trailer oficial, deixe trailerUrl vazio e official=false. Retorne somente JSON válido.",
          input:"Pesquise " + (kind === "tv" ? "a série" : "o filme") + " chamado \"" + q + "\". Retorne até 6 resultados compatíveis em JSON no formato {\"results\":[{\"title\":\"...\",\"year\":\"2026\",\"overview\":\"sinopse curta\",\"trailerUrl\":\"https://www.youtube.com/watch?v=...\",\"channel\":\"canal\",\"official\":true}]}.",
          max_output_tokens:1800
        }),
        signal:AbortSignal.timeout(90000)
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        const output = responseOutputText(payload);
        const a = output.indexOf("{"), b = output.lastIndexOf("}");
        if (a >= 0 && b > a) {
          const parsed = JSON.parse(output.slice(a,b+1));
          const results = (Array.isArray(parsed.results) ? parsed.results : []).slice(0,6).map(item => normalizeResult({
            ...item,
            type: kind === "tv" ? "series" : "movie",
            youtubeSearchUrl:"https://www.youtube.com/results?search_query=" + encodeURIComponent(String(item.title || q) + " " + String(item.year || "") + " trailer oficial")
          }));
          return { configured:true, source:"openai-web-search", results, youtubeSearchUrl };
        }
      }
    } catch (error) {
      console.warn("Trailer AI search unavailable:", String(error?.message || error));
    }
  }

  return { configured:false, source:"youtube-search", results:[], youtubeSearchUrl };
}

function startPendingVideoJobs() {
  const jobs = loadVideoJobs();
  for (const job of jobs) {
    if (["queued","uploaded","transcribing","selecting","cutting"].includes(String(job.status || ""))) {
      setTimeout(() => processVideoJob(job.id).catch(() => {}), 1200);
    }
  }
}

function videoPublicOrigin() {
  const domain = String(process.env.RAILWAY_PUBLIC_DOMAIN || "").trim();
  return domain ? "https://" + domain : "https://servidor-global-play-production.up.railway.app";
}

function findVideoClip(clientId, jobId, clipId) {
  const jobs = loadVideoJobs();
  const job = jobs.find(item => item.id === jobId && item.clientId === clientId);
  if (!job) return { jobs, job: null, clip: null };
  const clip = Array.isArray(job.clips) ? job.clips.find(item => item.id === clipId) : null;
  return { jobs, job, clip: clip || null };
}

function saveVideoClipState(jobs, job) {
  job.updatedAt = new Date().toISOString();
  saveVideoJobs(jobs);
}

async function publishInstagramVideoForClient(clientId, clip, caption) {
  const connection = directConnection(clientId, "meta");
  const accessToken = decryptSecret(connection?.accessToken || "");
  const igUserId = String(connection?.igUserId || "").trim();
  if (!accessToken || !igUserId) throw new Error("instagram_not_connected");
  if (!clip?.publicName) throw new Error("video_media_missing");

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
      throw err;
    }
    return payload;
  };

  const videoUrl = videoPublicOrigin() + "/video-media/" + encodeURIComponent(clip.publicName);
  const created = await graphRequest(igUserId + "/media", "POST", {
    media_type: "REELS",
    video_url: videoUrl,
    caption: String(caption || clip.caption || clip.title || "").slice(0, 2200),
    share_to_feed: "true"
  });
  const containerId = String(created?.id || "");
  if (!containerId) throw new Error("instagram_container_missing");

  const deadline = Date.now() + 8 * 60 * 1000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const status = await graphRequest(containerId + "?fields=status_code,status");
    const code = String(status?.status_code || "").toUpperCase();
    lastStatus = String(status?.status || code || "");
    if (code === "FINISHED") {
      const published = await graphRequest(igUserId + "/media_publish", "POST", { creation_id: containerId });
      return { mediaId: String(published?.id || ""), containerId };
    }
    if (code === "ERROR" || code === "EXPIRED") throw new Error("instagram_video_processing_" + (lastStatus || code));
  }
  throw new Error("instagram_video_processing_timeout");
}

async function setVideoClipApproval(clientId, jobId, clipId, status) {
  const allowed = new Set(["approved","rejected","pending"]);
  if (!allowed.has(String(status))) throw new Error("invalid_approval");
  const found = findVideoClip(clientId, jobId, clipId);
  if (!found.job || !found.clip) throw new Error("clip_not_found");
  found.clip.approvalStatus = String(status);
  found.clip.error = "";
  if (status === "rejected") {
    found.clip.publishStatus = "";
    found.clip.scheduledFor = null;
  }
  saveVideoClipState(found.jobs, found.job);
  return found.clip;
}

async function scheduleVideoClip(clientId, jobId, clipId, scheduledFor, caption) {
  const found = findVideoClip(clientId, jobId, clipId);
  if (!found.job || !found.clip) throw new Error("clip_not_found");
  if (found.clip.approvalStatus !== "approved") throw new Error("clip_not_approved");
  const date = new Date(scheduledFor);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_schedule");
  if (date.getTime() < Date.now() - 60 * 1000) throw new Error("schedule_in_past");
  found.clip.caption = String(caption || found.clip.caption || found.clip.title || "").slice(0, 2200);
  found.clip.scheduledFor = date.toISOString();
  found.clip.publishStatus = "scheduled";
  found.clip.error = "";
  saveVideoClipState(found.jobs, found.job);
  return found.clip;
}

async function bulkScheduleVideoClips(clientId, items) {
  if (!Array.isArray(items) || !items.length) throw new Error("no_videos_selected");
  if (items.length > 100) throw new Error("too_many_videos");

  const jobs = loadVideoJobs();
  const results = [];
  const seen = new Set();
  const now = Date.now();

  for (const raw of items) {
    const jobId = String(raw?.jobId || "");
    const clipId = String(raw?.clipId || "");
    const unique = jobId + "|" + clipId;
    if (!jobId || !clipId || seen.has(unique)) {
      results.push({ jobId, clipId, ok: false, error: "invalid_item" });
      continue;
    }
    seen.add(unique);

    const job = jobs.find(item => item.id === jobId && item.clientId === clientId);
    const clip = job && Array.isArray(job.clips) ? job.clips.find(item => item.id === clipId) : null;
    if (!job || !clip) {
      results.push({ jobId, clipId, ok: false, error: "clip_not_found" });
      continue;
    }
    if (clip.publishStatus === "published") {
      results.push({ jobId, clipId, ok: false, error: "already_published" });
      continue;
    }
    if (clip.status !== "ready") {
      results.push({ jobId, clipId, ok: false, error: "clip_not_ready" });
      continue;
    }

    const date = new Date(raw?.scheduledFor);
    if (!Number.isFinite(date.getTime())) {
      results.push({ jobId, clipId, ok: false, error: "invalid_schedule" });
      continue;
    }
    if (date.getTime() < now - 60 * 1000) {
      results.push({ jobId, clipId, ok: false, error: "schedule_in_past" });
      continue;
    }

    // Scheduling from the client is itself the client's approval.
    // No Master approval is required.
    clip.approvalStatus = "approved";
    clip.caption = String(raw?.caption || clip.caption || clip.title || "").slice(0, 2200);
    clip.scheduledFor = date.toISOString();
    clip.publishStatus = "scheduled";
    clip.selectedForSchedule = false;
    clip.error = "";
    job.updatedAt = new Date().toISOString();
    results.push({
      jobId,
      clipId,
      ok: true,
      scheduledFor: clip.scheduledFor,
      publishStatus: clip.publishStatus,
      approvalStatus: clip.approvalStatus
    });
  }

  saveVideoJobs(jobs);
  return {
    scheduled: results.filter(item => item.ok).length,
    failed: results.filter(item => !item.ok).length,
    results
  };
}

async function publishVideoClipNow(clientId, jobId, clipId, caption) {
  const found = findVideoClip(clientId, jobId, clipId);
  if (!found.job || !found.clip) throw new Error("clip_not_found");
  if (found.clip.approvalStatus !== "approved") throw new Error("clip_not_approved");
  found.clip.publishStatus = "publishing";
  found.clip.error = "";
  found.clip.caption = String(caption || found.clip.caption || found.clip.title || "").slice(0, 2200);
  saveVideoClipState(found.jobs, found.job);
  try {
    const result = await publishInstagramVideoForClient(clientId, found.clip, found.clip.caption);
    const fresh = findVideoClip(clientId, jobId, clipId);
    if (fresh.clip) {
      fresh.clip.publishStatus = "published";
      fresh.clip.mediaId = result.mediaId || "";
      fresh.clip.publishedAt = new Date().toISOString();
      fresh.clip.scheduledFor = null;
      fresh.clip.error = "";
      saveVideoClipState(fresh.jobs, fresh.job);
      return fresh.clip;
    }
    return found.clip;
  } catch (error) {
    const fresh = findVideoClip(clientId, jobId, clipId);
    if (fresh.clip) {
      fresh.clip.publishStatus = "failed";
      fresh.clip.error = String(error?.message || error).slice(0, 900);
      saveVideoClipState(fresh.jobs, fresh.job);
    }
    throw error;
  }
}

async function adjustVideoClip(clientId, jobId, clipId, body) {
  const found = findVideoClip(clientId, jobId, clipId);
  if (!found.job || !found.clip) throw new Error("clip_not_found");
  const start = Number(body.start);
  const end = Number(body.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > Number(found.job.duration || 0) + 0.5 || end - start > 95) {
    throw new Error("invalid_clip_range");
  }
  if (!found.clip.storedPath || !fs.existsSync(found.clip.storedPath)) throw new Error("clip_file_missing");
  found.clip.status = "editing";
  found.clip.error = "";
  saveVideoClipState(found.jobs, found.job);
  const nextEndText = Object.prototype.hasOwnProperty.call(body, "endText") ? String(body.endText || "").slice(0, 90) : (found.clip.endText || found.job.endText || "");
  const nextEndContact = Object.prototype.hasOwnProperty.call(body, "endContact") ? String(body.endContact || "").slice(0, 90) : (found.clip.endContact || found.job.endContact || "");
  const sourceSegments = subtitleSegmentsForRange(found.job.transcriptSegments || [], start, end);
  const shouldSubtitle = Boolean(found.job.autoSubtitles) && !isPortugueseLanguage(found.job.detectedLanguage);
  const translatedSubtitles = shouldSubtitle ? await translateClipSegmentsToPtBr(sourceSegments, clientId) : [];
  await renderVideoClip(
    found.job.storedPath,
    found.clip.storedPath,
    start,
    end,
    found.job.outputFormat || found.clip.outputFormat || "reel",
    nextEndText,
    nextEndContact,
    translatedSubtitles,
    { size: found.job.subtitleSize, color: found.job.subtitleColor, weight: found.job.subtitleWeight, bg: found.job.subtitleBg }
  );
  const fresh = findVideoClip(clientId, jobId, clipId);
  fresh.clip.start = start;
  fresh.clip.end = end;
  fresh.clip.duration = end - start;
  if (Object.prototype.hasOwnProperty.call(body, "title")) fresh.clip.title = String(body.title || "").slice(0, 100);
  if (Object.prototype.hasOwnProperty.call(body, "caption")) fresh.clip.caption = String(body.caption || "").slice(0, 2200);
  fresh.clip.transcript = transcriptForRange(fresh.job.transcriptSegments || [], start, end);
  fresh.clip.endText = nextEndText;
  fresh.clip.endContact = nextEndContact;
  fresh.clip.subtitlesApplied = translatedSubtitles.length > 0;
  fresh.clip.subtitleLanguage = translatedSubtitles.length ? "pt-BR" : "";
  fresh.clip.subtitleSize = fresh.job.subtitleSize || "auto";
  fresh.clip.subtitleColor = fresh.job.subtitleColor || "white";
  fresh.clip.subtitleWeight = fresh.job.subtitleWeight || "bold";
  fresh.clip.subtitleBg = fresh.job.subtitleBg || "black";
  fresh.clip.sourceLanguage = fresh.job.detectedLanguage || "";
  fresh.clip.subtitleSegments = translatedSubtitles;
  fresh.clip.status = "ready";
  fresh.clip.approvalStatus = "pending";
  fresh.clip.publishStatus = "";
  fresh.clip.scheduledFor = null;
  fresh.clip.error = "";
  saveVideoClipState(fresh.jobs, fresh.job);
  return fresh.clip;
}

let videoScheduleRunning = false;
async function processDueVideoSchedules() {
  if (videoScheduleRunning) return;
  videoScheduleRunning = true;
  try {
    const jobs = loadVideoJobs();
    const due = [];
    for (const job of jobs) {
      for (const clip of job.clips || []) {
        if (clip.approvalStatus !== "approved" || clip.publishStatus !== "scheduled" || !clip.scheduledFor) continue;
        const when = new Date(clip.scheduledFor).getTime();
        if (Number.isFinite(when) && when <= Date.now()) due.push({ clientId: job.clientId, jobId: job.id, clipId: clip.id, caption: clip.caption || "" });
      }
    }
    for (const item of due.slice(0, 3)) {
      await publishVideoClipNow(item.clientId, item.jobId, item.clipId, item.caption).catch(error => {
        console.warn("Scheduled video publish failed " + item.jobId + "/" + item.clipId + ": " + String(error?.message || error));
      });
    }
  } finally {
    videoScheduleRunning = false;
  }
}



function cleanPostStatus(value) {
  const allowed = new Set(["scheduled","generating","ready","publishing","published","failed","skipped"]);
  return allowed.has(String(value || "")) ? String(value) : "scheduled";
}

function cleanApprovalStatus(value) {
  const allowed = new Set(["pending","approved","rejected","correction_requested"]);
  return allowed.has(String(value || "")) ? String(value) : "pending";
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
      approvalStatus: "pending",
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
  if (body.approvalStatus) row.approvalStatus = cleanApprovalStatus(body.approvalStatus);
  if (row.status === "published") row.approvalStatus = "approved";
  if (scheduledFor) row.scheduledFor = scheduledFor;
  if (scheduledHour) row.scheduledHour = scheduledHour;
  if (body.attemptedAt) row.attemptedAt = normalizeIso(body.attemptedAt) || row.attemptedAt || now;
  if (row.status === "generating" || row.status === "publishing") row.attemptedAt = row.attemptedAt || now;
  if (row.status === "published") row.publishedAt = normalizeIso(body.publishedAt) || row.publishedAt || now;
  if (body.mediaId != null) row.mediaId = String(body.mediaId || "").slice(0, 160);
  if (body.model != null) row.model = String(body.model || "").slice(0, 100);
  if (body.error != null) row.error = String(body.error || "").slice(0, 900);
  if (body.costSource != null) row.costSource = String(body.costSource || "").slice(0, 80);
  if (body.caption != null) row.caption = String(body.caption || "").slice(0, 2200);
  if (body.imageUrl != null) row.imageUrl = String(body.imageUrl || "").slice(0, 1600);
  if (body.revisionRequest != null) row.revisionRequest = String(body.revisionRequest || "").slice(0, 1600);
  if (body.source != null) row.source = String(body.source || "").slice(0, 80);

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
  const storedRows = loadPostLedger();
  const now = new Date();
  const localParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now);
  const localValue = type => localParts.find(item => item.type === type)?.value || "";
  const todayKey = [localValue("year"), localValue("month"), localValue("day")].join("-");
  const monthKey = todayKey.slice(0, 7);

  const localDayFor = value => {
    if (!value) return "";
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(new Date(value));
      const get = type => parts.find(item => item.type === type)?.value || "";
      return [get("year"), get("month"), get("day")].join("-");
    } catch { return ""; }
  };

  const rows = [...storedRows];
  const clients = loadClients();
  for (const client of clients) {
    if (client.status !== "online" && !["ragnar-one","globalplay-streaming"].includes(client.id)) continue;
    for (const time of client.postTimes || []) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) continue;
      const exists = rows.some(row =>
        row.clientId === client.id
        && String(row.scheduledHour || "") === String(time)
        && localDayFor(row.scheduledFor || row.createdAt) === todayKey
      );
      if (exists) continue;

      const scheduledDate = new Date(todayKey + "T" + time + ":00-03:00");
      if (!Number.isFinite(scheduledDate.getTime())) continue;
      const overdue = now.getTime() > scheduledDate.getTime() + 15 * 60 * 1000;
      rows.push({
        id: "expected:" + client.id + ":" + todayKey + ":" + time,
        clientId: client.id,
        clientName: client.name || client.id,
        instagram: client.instagram || "",
        scheduledFor: scheduledDate.toISOString(),
        scheduledHour: String(time),
        status: overdue ? "skipped" : "scheduled",
        costUsd: 0,
        costCalculated: true,
        model: "",
        mediaId: "",
        error: overdue ? "Horário passou sem confirmação de publicação pelo agente." : "",
        createdAt: scheduledDate.toISOString(),
        updatedAt: scheduledDate.toISOString(),
        virtual: true
      });
    }
  }

  rows.sort((a, b) => String(b.scheduledFor || b.updatedAt || b.createdAt).localeCompare(String(a.scheduledFor || a.updatedAt || a.createdAt)));
  const monthRows = rows.filter(row => localDayFor(row.scheduledFor || row.createdAt).slice(0, 7) === monthKey);
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
    if (row.status === "failed" || row.status === "skipped") item.failed += 1;
    item.costUsd += Number(row.costUsd || 0);
    byClientMap.set(key, item);
  }
  const byClient = [...byClientMap.values()].sort((a, b) => b.costUsd - a.costUsd);
  return {
    month: monthKey,
    totalCostUsd: monthRows.reduce((sum, row) => sum + Number(row.costUsd || 0), 0),
    totalPosts: monthRows.length,
    published: monthRows.filter(row => row.status === "published").length,
    failed: monthRows.filter(row => row.status === "failed" || row.status === "skipped").length,
    byClient,
    posts: rows.slice(0, 300)
  };
}

function ensureKnownPostHistory() {
  const ledger = loadPostLedger();
  const historical = {
    id: "ragnar-one:20260923-0900",
    clientId: "ragnar-one",
    clientName: "Ragnar One",
    instagram: "@ragnarplay1",
    scheduledFor: "2026-09-23T12:00:00.000Z",
    scheduledHour: "09:00",
    status: "published",
    costUsd: 0,
    costCalculated: true,
    mediaId: "17906679906484359",
    costSource: "fallback_local",
    model: "",
    error: "",
    createdAt: "2026-09-23T12:00:00.000Z",
    updatedAt: "2026-09-23T13:12:52.000Z",
    publishedAt: "2026-09-23T13:12:52.000Z"
  };
  if (!ledger.some(item => item.id === historical.id && item.clientId === historical.clientId)) {
    ledger.push(historical);
    savePostLedger(ledger);
  }
}
ensureKnownPostHistory();

function portalPostView(row) {
  const status = cleanPostStatus(row.status);
  const approvalStatus = row.approvalStatus
    ? cleanApprovalStatus(row.approvalStatus)
    : status === "published"
      ? "approved"
      : (status === "failed" || status === "skipped" ? "rejected" : "pending");
  return {
    id: row.id,
    scheduledFor: row.scheduledFor || null,
    scheduledHour: row.scheduledHour || "",
    status,
    approvalStatus,
    attemptedAt: row.attemptedAt || null,
    publishedAt: row.publishedAt || null,
    mediaId: row.mediaId || "",
    error: row.error || "",
    revisionRequest: row.revisionRequest || "",
    title: row.title || "",
    caption: row.caption || "",
    imageUrl: row.imageUrl || "",
    source: row.source || "",
    retryCount: Math.max(0, Number(row.retryCount || 0)),
    updatedAt: row.updatedAt || row.createdAt || null
  };
}

function portalPostsForClient(client) {
  const rows = loadPostLedger().filter(row => row.clientId === client.id);
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now);
  const get = type => parts.find(item => item.type === type)?.value || "";
  const todayKey = [get("year"), get("month"), get("day")].join("-");

  const localDayFor = value => {
    if (!value) return "";
    try {
      const dayParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(new Date(value));
      const take = type => dayParts.find(item => item.type === type)?.value || "";
      return [take("year"), take("month"), take("day")].join("-");
    } catch { return ""; }
  };

  for (const time of client.postTimes || []) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) continue;
    const exists = rows.some(row =>
      String(row.scheduledHour || "") === String(time)
      && localDayFor(row.scheduledFor || row.createdAt) === todayKey
    );
    if (exists) continue;
    const scheduledDate = new Date(todayKey + "T" + time + ":00-03:00");
    const overdue = now.getTime() > scheduledDate.getTime() + 15 * 60 * 1000;
    rows.push({
      id: "expected:" + client.id + ":" + todayKey + ":" + time,
      clientId: client.id,
      clientName: client.name || client.id,
      instagram: client.instagram || "",
      scheduledFor: scheduledDate.toISOString(),
      scheduledHour: String(time),
      status: overdue ? "skipped" : "scheduled",
      approvalStatus: overdue ? "rejected" : "pending",
      error: overdue ? "O horário passou sem confirmação de publicação." : "",
      createdAt: scheduledDate.toISOString(),
      updatedAt: scheduledDate.toISOString(),
      virtual: true
    });
  }

  return rows
    .sort((a, b) => String(b.scheduledFor || b.updatedAt || b.createdAt).localeCompare(String(a.scheduledFor || a.updatedAt || a.createdAt)))
    .slice(0, 90)
    .map(portalPostView);
}

function materializePortalPost(client, postId) {
  const ledger = loadPostLedger();
  let row = ledger.find(item => item.clientId === client.id && item.id === postId);
  if (row) return { row, ledger };

  const prefix = "expected:" + client.id + ":";
  if (!String(postId || "").startsWith(prefix)) return { row: null, ledger };

  const remainder = String(postId).slice(prefix.length);
  const match = /^(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2})$/.exec(remainder);
  if (!match) return { row: null, ledger };
  const scheduledDate = new Date(match[1] + "T" + match[2] + ":00-03:00");
  if (!Number.isFinite(scheduledDate.getTime())) return { row: null, ledger };

  row = {
    id: postId,
    clientId: client.id,
    clientName: client.name || client.id,
    instagram: client.instagram || "",
    scheduledFor: scheduledDate.toISOString(),
    scheduledHour: match[2],
    status: "scheduled",
    approvalStatus: "pending",
    costUsd: 0,
    costCalculated: true,
    model: "",
    mediaId: "",
    error: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  ledger.push(row);
  return { row, ledger };
}

async function publishInstagramImageForClient(clientId, imageUrl, caption) {
  const connection = directConnection(clientId, "meta");
  const accessToken = decryptSecret(connection?.accessToken || "");
  const igUserId = String(connection?.igUserId || "").trim();
  if (!accessToken || !igUserId) {
    const err = new Error("instagram_not_connected");
    err.code = "instagram_not_connected";
    throw err;
  }

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
      const published = await graphRequest(igUserId + "/media_publish", "POST", { creation_id: containerId });
      const mediaId = String(published?.id || "");
      let permalink = "";
      if (mediaId) {
        try {
          const media = await graphRequest(mediaId + "?fields=permalink");
          permalink = String(media?.permalink || "");
        } catch {}
      }
      return { mediaId, containerId, permalink };
    }
    if (code === "ERROR" || code === "EXPIRED") {
      const err = new Error("instagram_media_processing_failed");
      err.status = lastStatus;
      throw err;
    }
  }
  const err = new Error("instagram_media_processing_timeout");
  err.status = lastStatus;
  throw err;
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

function agentTokenForClient(clientId) {
  if (clientId === "ragnar-one") return String(process.env.RAGNAR_AGENT_TOKEN || "");
  if (clientId === "globalplay-streaming") return String(process.env.GLOBALPLAY_AGENT_TOKEN || "");
  return "";
}

function normalizeLeadPayload(client, payload) {
  const leads = Array.isArray(payload?.leads) ? payload.leads.map(item => ({
    clientId: client.id,
    clientName: client.name || client.id,
    instagram: client.instagram || "",
    instagramUserId: String(item.instagramUserId || ""),
    instagramUsername: String(item.instagramUsername || ""),
    temperature: ["hot","warm","cold"].includes(String(item.temperature)) ? String(item.temperature) : "cold",
    score: Math.max(0, Number(item.score || 0)),
    stage: String(item.stage || "new"),
    intent: String(item.intent || ""),
    needsHuman: Boolean(item.needsHuman),
    triggerKeyword: String(item.triggerKeyword || ""),
    lastMessage: String(item.lastMessage || ""),
    lastContactAt: item.lastContactAt || null,
    updatedAt: item.updatedAt || null
  })) : [];
  const summary = leads.reduce((acc, lead) => {
    acc.total += 1;
    acc[lead.temperature] += 1;
    if (lead.needsHuman) acc.needsHuman += 1;
    return acc;
  }, { total: 0, hot: 0, warm: 0, cold: 0, needsHuman: 0 });
  return { summary, leads };
}

async function fetchAgentLeads(client) {
  const internal = leadHunterLeadsForClient(client.id, 1000).map(item => ({
    clientId:client.id,
    clientName:client.name || client.id,
    instagram:client.instagram || "",
    instagramUserId:String(item.instagramUserId || ""),
    instagramUsername:String(item.instagramUsername || ""),
    temperature:["hot","warm","cold"].includes(String(item.temperature)) ? String(item.temperature) : "cold",
    score:Math.max(0,Number(item.score || 0)),
    stage:String(item.stage || "new"),
    intent:String(item.intent || ""),
    needsHuman:Boolean(item.needsHuman),
    triggerKeyword:String(item.triggerKeyword || ""),
    lastMessage:String(item.lastMessage || ""),
    lastContactAt:item.lastContactAt || null,
    updatedAt:item.updatedAt || null,
    source:item.source || "nexus-hunter",
    sourceUrl:item.sourceUrl || "",
    evidenceCount:Number(item.evidenceCount || 0)
  }));

  const mergeRows = rows => {
    const map = new Map();
    for (const lead of rows) {
      const identity = String(lead.instagramUsername || lead.instagramUserId || "").toLowerCase();
      const key = identity || crypto.createHash("sha1").update(String(lead.lastMessage||"")).digest("hex");
      const current = map.get(key);
      if (!current || Number(lead.score||0) > Number(current.score||0)) map.set(key,lead);
      else if (current) {
        current.needsHuman = Boolean(current.needsHuman || lead.needsHuman);
        current.source = current.source === lead.source ? current.source : "multi-source";
      }
    }
    return [...map.values()];
  };

  const base = String(client?.agentApiUrl || "").replace(/\/+$/, "");
  const token = agentTokenForClient(client?.id);
  if (!base || !token) {
    if (internal.length) {
      return { summary:summarizeLeadRows(internal), leads:internal, source:"nexus-hunter" };
    }
    return {
      summary: {
        total: Number(client?.leads?.total || 0),
        hot: Number(client?.leads?.hot || 0),
        warm: Number(client?.leads?.warm || 0),
        cold: Number(client?.leads?.cold || 0),
        needsHuman: 0
      },
      leads: [],
      source: "stored"
    };
  }
  try {
    const response = await fetch(base + "/nexus/leads", {
      headers: {
        authorization: "Bearer " + token,
        accept: "application/json",
        "user-agent": "NEXUS-AI/1.0"
      },
      signal: AbortSignal.timeout(9000)
    });
    if (!response.ok) throw new Error("agent_leads_" + response.status);
    const payload = await response.json();
    const external = normalizeLeadPayload(client, payload).leads;
    const leads = mergeRows([...internal,...external])
      .sort((a,b)=>Number(b.score||0)-Number(a.score||0) || String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
    return { summary:summarizeLeadRows(leads), leads, source:internal.length ? "nexus-hunter+agent" : "agent" };
  } catch (error) {
    console.warn("Lead sync failed for " + client?.id + ": " + String(error?.message || error));
    if (internal.length) return { summary:summarizeLeadRows(internal), leads:internal, source:"nexus-hunter", error:"agent_unavailable" };
    return {
      summary: {
        total: Number(client?.leads?.total || 0),
        hot: Number(client?.leads?.hot || 0),
        warm: Number(client?.leads?.warm || 0),
        cold: Number(client?.leads?.cold || 0),
        needsHuman: 0
      },
      leads: [],
      source: "stored",
      error: "agent_unavailable"
    };
  }
}

async function masterLeadSummary() {
  const clients = loadClients();
  const results = await Promise.all(clients.map(async client => {
    const data = await fetchAgentLeads(client);
    return {
      clientId: client.id,
      clientName: client.name || client.id,
      instagram: client.instagram || "",
      source: data.source,
      summary: data.summary,
      leads: data.leads
    };
  }));
  const summary = results.reduce((acc, item) => {
    acc.total += Number(item.summary.total || 0);
    acc.hot += Number(item.summary.hot || 0);
    acc.warm += Number(item.summary.warm || 0);
    acc.cold += Number(item.summary.cold || 0);
    acc.needsHuman += Number(item.summary.needsHuman || 0);
    return acc;
  }, { total: 0, hot: 0, warm: 0, cold: 0, needsHuman: 0 });
  return {
    summary,
    byClient: results.map(item => ({
      clientId: item.clientId,
      clientName: item.clientName,
      instagram: item.instagram,
      source: item.source,
      ...item.summary
    })),
    leads: results.flatMap(item => item.leads)
      .sort((a, b) => String(b.updatedAt || b.lastContactAt || "").localeCompare(String(a.updatedAt || a.lastContactAt || "")))
      .slice(0, 1000)
  };
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
    agentCore: agentCoreConfig(client),
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
      location: "/portal.html?v=25&login=1",
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

  // Master API authorization must be enforced independently of the page login.
  if ((url.pathname === "/api/clients" || url.pathname.startsWith("/api/clients/")
      || url.pathname.startsWith("/api/master/") || url.pathname === "/api/system/status")
      && !masterAuthorized(req)) {
    return send(res, 401, { error: "unauthorized" });
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
      if (!client) return redirectWithCookie(res, "/portal.html?v=25&error=1");

      const remember = String(body.remember || "") === "1";
      const maxAgeSeconds = remember ? 30 * 24 * 60 * 60 : 12 * 60 * 60;
      const token = crypto.randomBytes(32).toString("base64url");
      portalSessions.set(token, {
        clientId: client.id,
        expiresAt: Date.now() + maxAgeSeconds * 1000,
        remembered: remember
      });
      const cookie = "nexus_session=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAgeSeconds;
      return redirectWithCookie(res, "/portal.html?v=25&auth=1", cookie);
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

    // Paid image generation through the shared NEXUS OpenAI account is disabled.
    // Ragnar remains isolated and may use only its own OpenAI connection.
    const record = directConnection(clientId, "openai");
    const ownKey = decryptSecret(record?.apiKey || "");
    if (clientId !== "ragnar-one") {
      return send(res, 409, { error: "nexus_paid_image_generation_disabled" });
    }
    if (!ownKey) {
      return send(res, 409, { error: "openai_not_connected" });
    }

    const body = await readBody(req);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 32000) : "";
    if (!prompt) return send(res, 400, { error: "prompt_required" });

    const allowedModels = new Set(["gpt-image-2.5-sunburst","gpt-image-2.5-flare","gpt-image-2","gpt-image-1.5","gpt-image-1"]);
    const allowedSizes = new Set(["auto", "1024x1024", "1024x1536", "1536x1024"]);
    const allowedQualities = new Set(["auto", "low", "medium", "high", "xhigh", "max"]);
    const model = allowedModels.has(String(body.model || "")) ? String(body.model) : "gpt-image-2.5-flare";
    const size = allowedSizes.has(String(body.size || "")) ? String(body.size) : "1024x1536";
    const quality = allowedQualities.has(String(body.quality || "")) ? String(body.quality) : "medium";

    try {
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          authorization: "Bearer " + ownKey,
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
      return send(res, 200, {
        ok: true,
        data: [{ b64_json: encoded }],
        model,
        size,
        quality,
        billing: "own-key"
      });
    } catch (error) {
      return send(res, 502, { error: "openai_image_proxy_failed", message: String(error?.message || error).slice(0, 300) });
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

  const agentCoreEventMatch = url.pathname.match(/^\/api\/agent\/([^/]+)\/core\/event$/);
  if (agentCoreEventMatch && req.method === "POST") {
    const clientId = agentCoreEventMatch[1];
    if (!agentBearerAuthorized(req, clientId)) return send(res, 401, { error: "unauthorized" });
    const client = loadClients().find(item => item.id === clientId);
    if (!client) return send(res, 404, { error: "not_found" });
    const body = await readBody(req);
    const agentId = String(body.agent || "").toLowerCase();
    const module = AGENT_CORE_MODULES.find(item => item.id === agentId || item.name.toLowerCase() === agentId);
    if (!module) return send(res, 400, { error: "invalid_agent" });
    const row = recordAgentExecution(client, module.name, {
      function: String(body.function || body.task || "external-event").slice(0, 120),
      trigger: "external-agent",
      status: String(body.status || "success"),
      model: String(body.model || "external-agent").slice(0, 120),
      quantity: Math.max(0, Number(body.quantity || 0)),
      costUsd: Math.max(0, Number(body.costUsd || 0)),
      message: String(body.message || "").slice(0, 1000),
      startedAt: normalizeIso(body.startedAt) || new Date().toISOString(),
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {}
    });
    return send(res, 200, { ok: true, execution: agentCoreExecutionView(row) });
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
      postingProfile: view.postingProfile,
      agentCore: agentCoreConfig(client)
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

  if (url.pathname === "/api/portal/lead-hunter" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error:"unauthorized" });
    return send(res, 200, leadHunterPortalView(client));
  }

  if (url.pathname === "/api/portal/lead-hunter/config" && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error:"unauthorized" });
    const body = await readBody(req);
    const targets = Array.isArray(body.targets)
      ? body.targets
      : String(body.targets || "").split(/\r?\n|,/).map(x=>x.trim()).filter(Boolean);
    const intentTerms = Array.isArray(body.intentTerms)
      ? body.intentTerms
      : String(body.intentTerms || "").split(/\r?\n|,/).map(x=>x.trim()).filter(Boolean);
    const nicheTerms = Array.isArray(body.nicheTerms)
      ? body.nicheTerms
      : String(body.nicheTerms || "").split(/\r?\n|,/).map(x=>x.trim()).filter(Boolean);
    const config = saveLeadHunterConfig(client, {
      enabled:body.enabled,
      autoRun:body.autoRun,
      metaComments:body.metaComments,
      publicTargets:body.publicTargets,
      aiQualification:body.aiQualification,
      scanIntervalMinutes:body.scanIntervalMinutes,
      lookbackDays:body.lookbackDays,
      maxResultsPerRun:body.maxResultsPerRun,
      minScore:body.minScore,
      targets,
      intentTerms,
      nicheTerms
    });
    return send(res, 200, { ok:true, config, summary:leadHunterSummaryForClient(client.id) });
  }

  if (url.pathname === "/api/portal/lead-hunter/run" && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error:"unauthorized" });
    try {
      const result = await runLeadHunter(client, { trigger:"portal-manual", automatic:false });
      if (result?.ok) await runOdinAgent(client, { trigger:"lead-hunter-manual" }).catch(()=>{});
      return send(res, 200, { ...result, view:leadHunterPortalView(client) });
    } catch (error) {
      return send(res, 500, { error:"lead_hunter_failed", message:String(error?.message || error).slice(0,300), view:leadHunterPortalView(client) });
    }
  }

  const discardLeadMatch = url.pathname.match(/^\/api\/portal\/lead-hunter\/leads\/([^/]+)\/discard$/);
  if (discardLeadMatch && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error:"unauthorized" });
    const id = decodeURIComponent(discardLeadMatch[1]);
    const rows = loadLeadHunterLeads();
    const row = rows.find(item=>item.id===id && item.clientId===client.id);
    if (!row) return send(res,404,{error:"lead_not_found"});
    row.status = "discarded";
    row.updatedAt = new Date().toISOString();
    saveLeadHunterLeads(rows);
    return send(res,200,{ok:true,view:leadHunterPortalView(client)});
  }

  if (url.pathname === "/api/portal/leads" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    const data = await fetchAgentLeads(client);
    return send(res, 200, data);
  }

  if (url.pathname === "/api/portal/agent-core" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    const posts = loadPostLedger().filter(row => row.clientId === client.id);
    return send(res, 200, {
      modules: AGENT_CORE_MODULES,
      config: agentCoreConfig(client),
      state: agentCoreStateFor(client.id),
      executions: agentExecutionsForClient(client.id, 60),
      pendingApproval: posts.filter(row => cleanApprovalStatus(row.approvalStatus) === "pending").length,
      correctionRequested: posts.filter(row => cleanApprovalStatus(row.approvalStatus) === "correction_requested").length
    });
  }

  if (url.pathname === "/api/portal/posts" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    return send(res, 200, {
      posts: portalPostsForClient(client),
      schedule: Array.isArray(client.postTimes) ? client.postTimes : []
    });
  }

  const portalPostDecisionMatch = url.pathname.match(/^\/api\/portal\/posts\/([^/]+)\/decision$/);
  if (portalPostDecisionMatch && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    const postId = decodeURIComponent(portalPostDecisionMatch[1]);
    const body = await readBody(req);
    const decision = String(body.decision || "").toLowerCase();
    if (!["approved","rejected"].includes(decision)) return send(res, 400, { error: "invalid_decision" });
    const found = materializePortalPost(client, postId);
    if (!found.row) return send(res, 404, { error: "not_found" });
    found.row.approvalStatus = decision;
    found.row.updatedAt = new Date().toISOString();
    if (decision === "approved" && found.row.status === "failed") {
      found.row.status = "ready";
      found.row.error = "";
    }
    savePostLedger(found.ledger);
    return send(res, 200, {
      ok: true,
      post: portalPostView(found.row),
      message: decision === "approved"
        ? (found.row.imageUrl ? "Conteúdo aprovado e liberado para o Publisher." : "Pauta aprovada; aguardando mídia antes da publicação.")
        : "Pauta reprovada e bloqueada para publicação."
    });
  }

  const portalPostRevisionMatch = url.pathname.match(/^\/api\/portal\/posts\/([^/]+)\/revision$/);
  if (portalPostRevisionMatch && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    const body = await readBody(req);
    const instructions = String(body.instructions || "").trim().slice(0, 1600);
    if (!instructions) return send(res, 400, { error: "revision_instructions_required" });

    const postId = decodeURIComponent(portalPostRevisionMatch[1]);
    const materialized = materializePortalPost(client, postId);
    if (!materialized.row) return send(res, 404, { error: "post_not_found" });
    const row = materialized.row;
    row.approvalStatus = "correction_requested";
    row.revisionRequest = instructions;
    row.error = "";
    row.updatedAt = new Date().toISOString();
    savePostLedger(materialized.ledger);

    const now = new Date().toISOString();
    const tickets = loadSupportTickets();
    tickets.push({
      id: "sup_" + crypto.randomBytes(9).toString("hex"),
      clientId: client.id,
      clientName: client.name || client.id,
      category: "Postagens / correção",
      subject: "Correção solicitada · " + (row.scheduledHour || "postagem"),
      message: instructions,
      status: "new",
      createdAt: now,
      updatedAt: now,
      postId: row.id
    });
    saveSupportTickets(tickets);

    return send(res, 200, {
      ok: true,
      message: "Correção enviada ao NEXUS.",
      post: portalPostView(row)
    });
  }

  const portalPostContentMatch = url.pathname.match(/^\/api\/portal\/posts\/([^/]+)\/content$/);
  if (portalPostContentMatch && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    try {
      const body = await readLargeJsonBody(req, 14 * 1024 * 1024);
      const caption = String(body.caption || "").trim().slice(0, 2200);
      const imageDataUrl = String(body.imageDataUrl || "").trim();
      if (!caption) return send(res, 400, { error: "caption_required" });
      if (!imageDataUrl) return send(res, 400, { error: "image_required" });

      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl);
      if (!match) return send(res, 400, { error: "invalid_image" });
      const bytes = Buffer.from(match[2], "base64");
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
        return send(res, 400, { error: "image_too_large" });
      }

      const postId = decodeURIComponent(portalPostContentMatch[1]);
      const materialized = materializePortalPost(client, postId);
      if (!materialized.row) return send(res, 404, { error: "post_not_found" });
      const row = materialized.row;

      const ext = match[1] === "jpeg" ? "jpg" : match[1];
      const filename = slug(client.id) + "-" + crypto.randomBytes(12).toString("hex") + "." + ext;
      fs.writeFileSync(path.join(manualPostDir, filename), bytes);

      row.caption = caption;
      row.imageUrl = publicOrigin(req) + "/manual-post/" + filename;
      row.source = "client_manual";
      row.approvalStatus = "approved";
      row.status = "ready";
      row.error = "";
      row.revisionRequest = "";
      row.updatedAt = new Date().toISOString();
      savePostLedger(materialized.ledger);

      return send(res, 200, {
        ok: true,
        message: "Conteúdo manual aprovado e pronto para envio.",
        post: portalPostView(row)
      });
    } catch (error) {
      return send(res, 400, { error: String(error?.message || "manual_content_failed") });
    }
  }

  const portalPostManualMatch = url.pathname.match(/^\/api\/portal\/posts\/([^/]+)\/manual$/);
  if (portalPostManualMatch && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });

    const postId = decodeURIComponent(portalPostManualMatch[1]);
    const materialized = materializePortalPost(client, postId);
    if (!materialized.row) return send(res, 404, { error: "post_not_found" });
    const row = materialized.row;
    const approvalStatus = row.approvalStatus
      ? cleanApprovalStatus(row.approvalStatus)
      : row.status === "published" ? "approved" : "pending";

    if (row.status === "published") {
      return send(res, 409, {
        error: "already_published",
        message: "Esta postagem já foi enviada.",
        post: portalPostView(row)
      });
    }
    if (approvalStatus !== "approved") {
      return send(res, 409, {
        error: "post_not_approved",
        message: "O servidor bloqueou o envio porque esta postagem ainda não foi aprovada. Envie para correção ou use seu próprio conteúdo.",
        post: portalPostView(row)
      });
    }
    if (!row.imageUrl || !row.caption) {
      return send(res, 409, {
        error: "post_content_not_ready",
        message: "A postagem está aprovada, mas o arquivo final ainda não está disponível no NEXUS.",
        post: portalPostView(row)
      });
    }

    row.status = "publishing";
    row.attemptedAt = new Date().toISOString();
    row.error = "";
    row.updatedAt = row.attemptedAt;
    savePostLedger(materialized.ledger);

    try {
      const result = await publishInstagramImageForClient(client.id, row.imageUrl, row.caption);
      row.status = "published";
      row.approvalStatus = "approved";
      row.mediaId = result.mediaId || "";
      row.permalink = result.permalink || "";
      row.publishedAt = new Date().toISOString();
      row.updatedAt = row.publishedAt;
      savePostLedger(materialized.ledger);
      return send(res, 200, {
        ok: true,
        message: "Postagem enviada manualmente com sucesso.",
        post: portalPostView(row),
        permalink: row.permalink
      });
    } catch (error) {
      row.status = "failed";
      row.error = String(error?.message || "Falha ao publicar").slice(0, 900);
      row.updatedAt = new Date().toISOString();
      savePostLedger(materialized.ledger);
      return send(res, 400, {
        error: "manual_publish_failed",
        message: row.error,
        post: portalPostView(row)
      });
    }
  }

  if (url.pathname === "/api/portal/trailers/search" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    try {
      const query = String(url.searchParams.get("q") || "");
      const type = String(url.searchParams.get("type") || "movie") === "series" ? "series" : "movie";
      if (!query.trim()) return send(res, 400, { error: "query_required" });
      const result = await searchOfficialTrailers(query, type, client.id);
      return send(res, 200, result);
    } catch (error) {
      return send(res, 502, { error: "trailer_search_failed", message: String(error?.message || error).slice(0,300) });
    }
  }

  if (url.pathname === "/api/portal/videos" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    const jobs = loadVideoJobs()
      .filter(job => job.clientId === client.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 300)
      .map(portalVideoJobView);
    return send(res, 200, { jobs, folders: videoFoldersForClient(client.id) });
  }

  if (url.pathname === "/api/portal/video-folders" && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    const body = await readBody(req);
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) return send(res, 400, { error: "folder_name_required" });
    const rows = loadVideoFolders();
    const folder = { id: "fld_" + crypto.randomBytes(7).toString("hex"), clientId: client.id, name, createdAt: new Date().toISOString() };
    rows.push(folder);
    saveVideoFolders(rows);
    return send(res, 201, { ok: true, folder, folders: videoFoldersForClient(client.id) });
  }

  const portalFolderMatch = url.pathname.match(/^\/api\/portal\/video-folders\/([^/]+)$/);
  if (portalFolderMatch && req.method === "PATCH") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    const folderId = decodeURIComponent(portalFolderMatch[1]);
    if (folderId === "default") return send(res, 400, { error: "default_folder_locked" });
    const body = await readBody(req);
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) return send(res, 400, { error: "folder_name_required" });
    const rows = loadVideoFolders();
    const folder = rows.find(item => item.clientId === client.id && item.id === folderId);
    if (!folder) return send(res, 404, { error: "folder_not_found" });
    folder.name = name;
    folder.updatedAt = new Date().toISOString();
    saveVideoFolders(rows);
    return send(res, 200, { ok: true, folder, folders: videoFoldersForClient(client.id) });
  }

  if (portalFolderMatch && req.method === "DELETE") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    const folderId = decodeURIComponent(portalFolderMatch[1]);
    if (folderId === "default") return send(res, 400, { error: "default_folder_locked" });
    const rows = loadVideoFolders();
    if (!rows.some(item => item.clientId === client.id && item.id === folderId)) return send(res, 404, { error: "folder_not_found" });
    saveVideoFolders(rows.filter(item => !(item.clientId === client.id && item.id === folderId)));
    const jobs = loadVideoJobs();
    for (const job of jobs) if (job.clientId === client.id && job.folderId === folderId) job.folderId = "default";
    saveVideoJobs(jobs);
    return send(res, 200, { ok: true, folders: videoFoldersForClient(client.id) });
  }

  const portalVideoManageMatch = url.pathname.match(/^\/api\/portal\/videos\/([^/]+)$/);
  if (portalVideoManageMatch && req.method === "PATCH") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    const jobId = decodeURIComponent(portalVideoManageMatch[1]);
    const body = await readBody(req);
    const jobs = loadVideoJobs();
    const job = jobs.find(item => item.id === jobId && item.clientId === client.id);
    if (!job) return send(res, 404, { error: "video_not_found" });
    if (Object.prototype.hasOwnProperty.call(body, "displayName")) {
      const name = String(body.displayName || "").trim().slice(0, 120);
      if (!name) return send(res, 400, { error: "video_name_required" });
      job.displayName = name;
    }
    if (Object.prototype.hasOwnProperty.call(body, "folderId")) {
      const folderId = String(body.folderId || "default");
      const allowed = videoFoldersForClient(client.id).some(item => item.id === folderId);
      if (!allowed) return send(res, 400, { error: "folder_not_found" });
      job.folderId = folderId;
    }
    job.updatedAt = new Date().toISOString();
    saveVideoJobs(jobs);
    return send(res, 200, { ok: true, job: portalVideoJobView(job) });
  }

  if (portalVideoManageMatch && req.method === "DELETE") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    const jobId = decodeURIComponent(portalVideoManageMatch[1]);
    if (videoProcessing.has(jobId)) return send(res, 409, { error: "video_processing", message: "Aguarde o processamento terminar para excluir este vídeo." });
    const jobs = loadVideoJobs();
    const job = jobs.find(item => item.id === jobId && item.clientId === client.id);
    if (!job) return send(res, 404, { error: "video_not_found" });
    deleteVideoJobFiles(job);
    saveVideoJobs(jobs.filter(item => !(item.id === jobId && item.clientId === client.id)));
    return send(res, 200, { ok: true, message: "Vídeo excluído da biblioteca do NEXUS." });
  }

  const portalVideoSelectMatch = url.pathname.match(/^\/api\/portal\/videos\/([^/]+)\/clips\/([^/]+)\/select$/);
  if (portalVideoSelectMatch && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    const body = await readBody(req);
    const found = findVideoClip(client.id, decodeURIComponent(portalVideoSelectMatch[1]), decodeURIComponent(portalVideoSelectMatch[2]));
    if (!found.job || !found.clip) return send(res, 404, { error: "clip_not_found" });
    if (found.clip.publishStatus === "published") return send(res, 409, { error: "already_published" });
    found.clip.selectedForSchedule = Boolean(body.selected);
    saveVideoClipState(found.jobs, found.job);
    return send(res, 200, { ok: true, selectedForSchedule: found.clip.selectedForSchedule });
  }

  const portalVideoApprovalMatch = url.pathname.match(/^\/api\/portal\/videos\/([^/]+)\/clips\/([^/]+)\/approval$/);
  if (portalVideoApprovalMatch && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    try {
      const body = await readBody(req);
      const clip = await setVideoClipApproval(client.id, decodeURIComponent(portalVideoApprovalMatch[1]), decodeURIComponent(portalVideoApprovalMatch[2]), body.status);
      return send(res, 200, { ok: true, clip, jobs: loadVideoJobs().filter(job => job.clientId === client.id).map(portalVideoJobView) });
    } catch (error) {
      return send(res, 400, { error: String(error?.message || "video_approval_failed") });
    }
  }

  const portalVideoScheduleMatch = url.pathname.match(/^\/api\/portal\/videos\/([^/]+)\/clips\/([^/]+)\/schedule$/);
  if (portalVideoScheduleMatch && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    try {
      const body = await readBody(req);
      const clip = await scheduleVideoClip(client.id, decodeURIComponent(portalVideoScheduleMatch[1]), decodeURIComponent(portalVideoScheduleMatch[2]), body.scheduledFor, body.caption);
      return send(res, 200, { ok: true, clip });
    } catch (error) {
      return send(res, 400, { error: String(error?.message || "video_schedule_failed") });
    }
  }

  const portalVideoPublishMatch = url.pathname.match(/^\/api\/portal\/videos\/([^/]+)\/clips\/([^/]+)\/publish$/);
  if (portalVideoPublishMatch && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    try {
      const body = await readBody(req);
      const clip = await publishVideoClipNow(client.id, decodeURIComponent(portalVideoPublishMatch[1]), decodeURIComponent(portalVideoPublishMatch[2]), body.caption);
      return send(res, 200, { ok: true, clip });
    } catch (error) {
      return send(res, 400, { error: String(error?.message || "video_publish_failed") });
    }
  }

  const portalVideoAdjustMatch = url.pathname.match(/^\/api\/portal\/videos\/([^/]+)\/clips\/([^/]+)\/adjust$/);
  if (portalVideoAdjustMatch && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    try {
      const body = await readBody(req);
      const clip = await adjustVideoClip(client.id, decodeURIComponent(portalVideoAdjustMatch[1]), decodeURIComponent(portalVideoAdjustMatch[2]), body);
      return send(res, 200, { ok: true, clip });
    } catch (error) {
      return send(res, 400, { error: String(error?.message || "video_adjust_failed") });
    }
  }

  if (url.pathname === "/api/portal/videos/bulk-schedule" && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });
    try {
      const body = await readBody(req);
      const result = await bulkScheduleVideoClips(client.id, body.items || []);
      return send(res, 200, { ok: true, ...result });
    } catch (error) {
      return send(res, 400, { error: String(error?.message || "video_bulk_schedule_failed") });
    }
  }

  if (url.pathname === "/api/portal/videos" && req.method === "POST") {
    const client = portalClientForRequest(req);
    if (!client) return send(res, 401, { error: "unauthorized" });

    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("video/") && contentType !== "application/octet-stream") {
      return send(res, 415, { error: "video_required" });
    }

    const contentLength = Number(req.headers["content-length"] || 0);
    const maxBytes = 750 * 1024 * 1024;
    if (contentLength > maxBytes) return send(res, 413, { error: "video_too_large" });

    const original = decodeURIComponent(String(req.headers["x-file-name"] || "video.mp4")).slice(0, 180);
    const safeBase = path.basename(original).replace(/[^a-zA-Z0-9._-]+/g, "_") || "video.mp4";
    const ext = path.extname(safeBase).toLowerCase();
    const allowedExt = new Set([".mp4",".mov",".m4v",".webm",".mkv"]);
    if (!allowedExt.has(ext)) return send(res, 400, { error: "unsupported_video_format" });

    const jobId = "vid_" + crypto.randomBytes(10).toString("hex");
    const clientDir = path.join(clientVideoDir, slug(client.id));
    fs.mkdirSync(clientDir, { recursive: true });
    const storedName = jobId + ext;
    const destination = path.join(clientDir, storedName);
    const stream = fs.createWriteStream(destination);
    let received = 0;
    let failed = false;

    req.on("data", chunk => {
      received += chunk.length;
      if (received > maxBytes && !failed) {
        failed = true;
        stream.destroy();
        req.destroy();
      }
    });

    req.pipe(stream);
    stream.on("error", () => {
      if (!res.headersSent) send(res, 500, { error: "video_store_failed" });
    });
    stream.on("finish", () => {
      if (failed || received > maxBytes) {
        try { fs.unlinkSync(destination); } catch {}
        if (!res.headersSent) send(res, 413, { error: "video_too_large" });
        return;
      }

      const goal = String(req.headers["x-video-goal"] || "viral").slice(0, 40);
      const outputFormat = videoFormatSpec(String(req.headers["x-output-format"] || "reel")).key;
      const autoSubtitles = String(req.headers["x-auto-subtitles"] || "") === "1";
      const subtitleStyle = normalizeSubtitleStyle({
        size: req.headers["x-subtitle-size"],
        color: req.headers["x-subtitle-color"],
        weight: req.headers["x-subtitle-weight"],
        bg: req.headers["x-subtitle-bg"]
      });
      const endText = decodeURIComponent(String(req.headers["x-video-end-text"] || "")).trim().slice(0, 90);
      const endContact = decodeURIComponent(String(req.headers["x-video-end-contact"] || "")).trim().slice(0, 90);
      const requestedFolder = String(req.headers["x-video-folder"] || "default");
      const folderId = videoFoldersForClient(client.id).some(item => item.id === requestedFolder) ? requestedFolder : "default";
      const clipDuration = Math.min(90, Math.max(10, Number(req.headers["x-clip-duration"] || 30) || 30));
      const requestedClips = Math.min(12, Math.max(1, Number(req.headers["x-requested-clips"] || 3) || 3));
      const now = new Date().toISOString();
      const job = {
        id: jobId,
        clientId: client.id,
        clientName: client.name || client.id,
        filename: safeBase,
        displayName: path.basename(safeBase, path.extname(safeBase)),
        folderId,
        outputFormat,
        autoSubtitles,
        subtitleSize: subtitleStyle.size,
        subtitleColor: subtitleStyle.color,
        subtitleWeight: subtitleStyle.weight,
        subtitleBg: subtitleStyle.bg,
        endText,
        endContact,
        storedPath: destination,
        sizeBytes: received,
        goal,
        clipDuration,
        requestedClips,
        status: "queued",
        progress: 5,
        message: "Upload concluído. Preparando os cortes para sua revisão; nada será publicado automaticamente.",
        clips: [],
        createdAt: now,
        updatedAt: now
      };
      const jobs = loadVideoJobs();
      jobs.push(job);
      saveVideoJobs(jobs);
      send(res, 201, { ok: true, job: portalVideoJobView(job) });
      setTimeout(() => processVideoJob(job.id).catch(() => {}), 300);
    });
    return;
  }

  if (url.pathname.startsWith("/video-media/") && (req.method === "GET" || req.method === "HEAD")) {
    const publicName = path.basename(decodeURIComponent(url.pathname.slice("/video-media/".length)));
    const jobs = loadVideoJobs();
    let file = "";
    for (const job of jobs) {
      const clip = (job.clips || []).find(item => item.publicName === publicName);
      if (clip?.storedPath && fs.existsSync(clip.storedPath)) {
        file = clip.storedPath;
        break;
      }
    }
    if (!file) return send(res, 404, "Not found", "text/plain; charset=utf-8");

    const stat = fs.statSync(file);
    const size = Number(stat.size || 0);
    const range = String(req.headers.range || "").trim();

    res.setHeader("accept-ranges", "bytes");
    res.setHeader("content-type", "video/mp4");
    res.setHeader("content-disposition", 'inline; filename="' + publicName.replace(/"/g, "") + '"');
    res.setHeader("cache-control", "private, max-age=0, must-revalidate");
    res.setHeader("x-content-type-options", "nosniff");

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        res.writeHead(416, { "content-range": "bytes */" + size });
        return res.end();
      }

      let start;
      let end;
      if (!match[1] && match[2]) {
        const suffixLength = Math.max(1, Number(match[2]));
        start = Math.max(0, size - suffixLength);
        end = size - 1;
      } else {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      }

      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
        res.writeHead(416, { "content-range": "bytes */" + size });
        return res.end();
      }

      res.writeHead(206, {
        "content-range": "bytes " + start + "-" + end + "/" + size,
        "content-length": end - start + 1
      });
      if (req.method === "HEAD") return res.end();
      const stream = fs.createReadStream(file, { start, end });
      stream.on("error", () => { try { res.destroy(); } catch {} });
      stream.pipe(res);
      return;
    }

    res.writeHead(200, { "content-length": size });
    if (req.method === "HEAD") return res.end();
    const stream = fs.createReadStream(file);
    stream.on("error", () => { try { res.destroy(); } catch {} });
    stream.pipe(res);
    return;
  }

  if (url.pathname.startsWith("/manual-post/") && req.method === "GET") {
    const filename = path.basename(url.pathname.slice("/manual-post/".length));
    const full = path.join(manualPostDir, filename);
    if (!filename || !full.startsWith(manualPostDir) || !fs.existsSync(full)) {
      return send(res, 404, "Not found", "text/plain; charset=utf-8");
    }
    const ext = path.extname(filename).toLowerCase();
    const type = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    res.writeHead(200, {
      "content-type": type,
      "content-length": fs.statSync(full).size,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff"
    });
    fs.createReadStream(full).pipe(res);
    return;
  }

  if (url.pathname === "/index.html" && req.method === "GET") {
    res.writeHead(303, { location: "/master", "cache-control": "no-store", "content-length": "0" });
    return res.end();
  }

  if (url.pathname.startsWith("/api/") && !masterAuthorized(req)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="NEXUS AI Agent Central"');
    return send(res, 401, { error: "unauthorized" });
  }

  if (url.pathname === "/api/master/agent-core" && req.method === "GET") {
    return send(res, 200, agentCoreDashboard());
  }

  const masterAgentCoreMatch = url.pathname.match(/^\/api\/master\/agent-core\/([^/]+)$/);
  if (masterAgentCoreMatch && req.method === "GET") {
    const clientId = decodeURIComponent(masterAgentCoreMatch[1]);
    const client = loadClients().find(item => item.id === clientId);
    if (!client) return send(res, 404, { error: "not_found" });
    return send(res, 200, {
      clientId,
      clientName: client.name || client.id,
      modules: AGENT_CORE_MODULES,
      config: agentCoreConfig(client),
      state: agentCoreStateFor(clientId),
      executions: agentExecutionsForClient(clientId, 200)
    });
  }

  if (masterAgentCoreMatch && req.method === "PATCH") {
    const clientId = decodeURIComponent(masterAgentCoreMatch[1]);
    const body = await readBody(req);
    const clients = loadClients();
    const client = clients.find(item => item.id === clientId);
    if (!client) return send(res, 404, { error: "not_found" });
    const current = agentCoreConfig(client);
    const next = {
      enabled: Object.prototype.hasOwnProperty.call(body, "enabled") ? body.enabled === true : current.enabled,
      autoPublish: Object.prototype.hasOwnProperty.call(body, "autoPublish") ? body.autoPublish === true : current.autoPublish,
      approvalRequired: current.approvalRequired,
      cycleMinutes: Object.prototype.hasOwnProperty.call(body, "cycleMinutes")
        ? Math.max(15, Math.min(1440, Number(body.cycleMinutes || 60)))
        : current.cycleMinutes,
      modules: { ...current.modules }
    };
    if (Object.prototype.hasOwnProperty.call(body, "approvalRequired")) {
      // Disabling approval only takes effect when auto publishing was explicitly enabled.
      next.approvalRequired = next.autoPublish ? body.approvalRequired !== false : true;
    } else if (!next.autoPublish) {
      next.approvalRequired = true;
    }
    if (body.modules && typeof body.modules === "object") {
      for (const module of AGENT_CORE_MODULES) {
        if (Object.prototype.hasOwnProperty.call(body.modules, module.id)) next.modules[module.id] = body.modules[module.id] !== false;
      }
    }
    client.agentCore = next;
    saveClients(clients);
    return send(res, 200, { ok: true, config: agentCoreConfig(client) });
  }

  const masterAgentRunMatch = url.pathname.match(/^\/api\/master\/agent-core\/([^/]+)\/run$/);
  if (masterAgentRunMatch && req.method === "POST") {
    const clientId = decodeURIComponent(masterAgentRunMatch[1]);
    const body = await readBody(req);
    try {
      const result = await runAgentCoreCycle(clientId, { trigger: "manual", agent: body.agent || "all" });
      return send(res, 200, result);
    } catch (error) {
      const code = String(error?.message || error);
      const status = code === "client_not_found" ? 404 : code === "invalid_agent" ? 400 : 500;
      return send(res, status, { error: code });
    }
  }

  if (url.pathname === "/api/master/leads" && req.method === "GET") {
    return send(res, 200, await masterLeadSummary());
  }

  const impersonateMatch = url.pathname.match(/^\/api\/master\/impersonate\/([^/]+)$/);
  if (impersonateMatch && req.method === "POST") {
    const clientId = decodeURIComponent(impersonateMatch[1]);
    const client = loadClients().find(item => item.id === clientId);
    if (!client) return send(res, 404, { error: "not_found" });
    const token = crypto.randomBytes(32).toString("base64url");
    portalSessions.set(token, { clientId, expiresAt: Date.now() + 2 * 60 * 60 * 1000, assumedByMaster: true });
    res.setHeader("set-cookie", "nexus_session=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7200");
    return send(res, 200, { ok: true, clientId, url: "/portal.html?assumed=1" });
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

    const aiMode = "economy";
    const aiMonthlyImageLimit = 0;

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
      if (client.id === "ragnar-one") {
        if (mode !== "own-key") return send(res, 409, { error: "ragnar_openai_is_separate" });
      } else if (mode !== "economy") {
        return send(res, 409, { error: "nexus_paid_image_generation_disabled" });
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "aiMonthlyImageLimit")) {
      const limit = Number(body.aiMonthlyImageLimit);
      if (!Number.isInteger(limit) || limit < 0 || limit > 10000) {
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
  startPendingVideoJobs();
  const videoTimer = setInterval(() => processDueVideoSchedules().catch(() => {}), 30000);
  const agentCoreTimer = setInterval(() => processAgentCoreScheduler().catch(() => {}), 60000);
  setTimeout(() => processAgentCoreScheduler().catch(() => {}), 15000);
  if (typeof agentCoreTimer.unref === "function") agentCoreTimer.unref();
  videoTimer.unref?.();
});
