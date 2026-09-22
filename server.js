
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
const EMPTY_SEED = [];

fs.mkdirSync(DATA_DIR, { recursive: true });

const seedFile = path.join(__dirname, "data", "clients.json");
const runtimeFile = path.join(DATA_DIR, "runtime.json");

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

function portalClientForRequest(req) {
  const credentials = parseBasicAuth(req);
  if (!credentials) return null;

  const account = portalAccounts().find(item =>
    safeEqualText(credentials.username, item.username)
    && safeEqualText(credentials.password, item.password)
  );
  if (!account) return null;

  return loadClients().find(client => client.id === account.clientId) || null;
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
    usage: client.usage
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

  if (url.pathname === "/api/portal/session" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) {
      res.setHeader("WWW-Authenticate", 'Basic realm="NEXUS AI Client Portal"');
      return send(res, 401, { error: "unauthorized" });
    }
    return send(res, 200, clientPortalView(client));
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
      }
    };

    clients.push(client);
    saveClients(clients);
    return send(res, 201, client);
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
      "leads","usage","onboarding"
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

  let requested = url.pathname === "/" ? "/index.html" : url.pathname;
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
    ".svg": "image/svg+xml",
    ".png": "image/png"
  };
  return send(res, 200, fs.readFileSync(target), types[ext] || "application/octet-stream");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NEXUS AI Agent Central listening on ${PORT}`);
});
