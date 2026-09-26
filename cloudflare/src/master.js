import {
  masterCredentialsValid,
  createMasterSession,
  resolveMasterSession,
  deleteMasterSession,
  masterSessionCookie,
  clearMasterSessionCookie,
  upsertPortalUser
} from "./auth.js";
import { listClients, getClient, upsertClient } from "./clients.js";
import { getMasterInstagramSummary, saveMasterInstagramConfig, startInstagramOAuth } from "./instagram.js";
import { agentCoreDashboard, agentCoreClientView, saveAgentCoreConfig, queueManualAgentRun } from "./agent-core.js";
import { masterLeadSummary } from "./leads.js";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

function redirect(location, headers = {}) {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      "cache-control": "no-store",
      ...headers
    }
  });
}

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function slug(value) {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function masterClientView(client) {
  if (!client) return null;
  const config = client.config && typeof client.config === "object" ? client.config : {};
  return {
    id: client.id,
    name: client.name,
    niche: client.niche,
    instagram: client.instagram,
    status: client.status,
    ...config,
    runtime: "cloudflare",
    infrastructure: "Servidor Nexus",
    openaiKeySource: client.id === "ragnar-one" ? "ragnar-exclusive" : "shared"
  };
}

function masterLoginPage(error = false, action = "/master-login") {
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
label{display:grid;gap:7px;margin:13px 0;color:#9bb5c5;font-size:12px;font-weight:700}input{width:100%;padding:14px;border-radius:10px;border:1px solid #163244;background:#03090e;color:#fff;outline:none}
button{width:100%;margin-top:12px;padding:14px;border:0;border-radius:10px;background:linear-gradient(135deg,#c8f3ff,#59d0ff 55%,#168ee8);color:#02101a;font-weight:900;cursor:pointer}
.error{min-height:18px;margin-top:12px;color:#ff8690;font-size:12px}.secure{margin-top:20px;padding-top:15px;border-top:1px solid #5dd3ff12;color:#557182;font-size:11px;text-align:center}
</style>
</head>
<body><main class="card">
<div class="brand"><img src="/assets/nexus-ai-mark.svg" alt=""><div><strong>NEXUS AI</strong><small>SERVIDOR NEXUS</small></div></div>
<h1>Acesso administrativo</h1><p class="muted">Área exclusiva do administrador NEXUS.</p>
<form method="post" action="${action}">
<label>Usuário<input name="username" autocomplete="username" required></label>
<label>Senha<input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">Entrar no Master</button>
<div class="error">${error ? "Usuário ou senha inválidos." : ""}</div>
</form><div class="secure">Sessão administrativa protegida · Cloudflare D1</div>
</main></body></html>`;
}

async function asset(env, request, pathname) {
  if (!env.ASSETS) return new Response("Static assets binding unavailable", { status: 503 });
  const target = new URL(request.url);
  target.pathname = pathname;
  target.search = "";
  return env.ASSETS.fetch(new Request(target.toString(), request));
}

async function requireMaster(request, env) {
  return Boolean(await resolveMasterSession(env, request));
}

async function allSupportTickets(env) {
  const result = await env.DB.prepare(
    `SELECT id, client_id, status, subject, payload_json, created_at, updated_at
     FROM support_tickets ORDER BY created_at DESC LIMIT 500`
  ).all();
  return (result?.results || []).map(row => ({
    id: row.id,
    clientId: row.client_id,
    status: row.status || "open",
    subject: row.subject || "",
    ...parseJson(row.payload_json, {}),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  }));
}

async function allPosts(env) {
  const result = await env.DB.prepare(
    `SELECT id, client_id, scheduled_for, scheduled_hour, status, approval_status,
            media_id, caption, image_object_key, error, cost_usd, payload_json,
            created_at, updated_at
     FROM post_ledger ORDER BY COALESCE(scheduled_for, created_at) DESC LIMIT 1000`
  ).all();
  return (result?.results || []).map(row => ({
    id: row.id,
    clientId: row.client_id,
    scheduledFor: row.scheduled_for || null,
    scheduledHour: row.scheduled_hour || "",
    status: row.status || "scheduled",
    approvalStatus: row.approval_status || "pending",
    mediaId: row.media_id || "",
    caption: row.caption || "",
    imageObjectKey: row.image_object_key || "",
    error: row.error || "",
    costUsd: Number(row.cost_usd || 0),
    ...parseJson(row.payload_json, {}),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  }));
}

async function allExecutions(env) {
  const result = await env.DB.prepare(
    `SELECT id, client_id, agent, status, detail_json, created_at
     FROM agent_executions ORDER BY created_at DESC LIMIT 1000`
  ).all();
  return (result?.results || []).map(row => ({
    id: row.id,
    clientId: row.client_id,
    agent: row.agent,
    status: row.status,
    ...parseJson(row.detail_json, {}),
    createdAt: row.created_at || null
  }));
}

async function tokenUsage(env) {
  const result = await env.DB.prepare(
    `SELECT client_id, day_key, input_tokens, output_tokens, used_tokens, calls, last_model, updated_at
     FROM token_usage ORDER BY day_key DESC, client_id LIMIT 1000`
  ).all();
  return (result?.results || []).map(row => ({
    clientId: row.client_id,
    dayKey: row.day_key,
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    usedTokens: Number(row.used_tokens || 0),
    calls: Number(row.calls || 0),
    lastModel: row.last_model || null,
    updatedAt: row.updated_at || null
  }));
}


async function ensureMasterSettingsTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS master_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();
}

async function getMasterSetting(env, key, fallback = "") {
  await ensureMasterSettingsTable(env);
  const row = await env.DB.prepare(
    "SELECT value FROM master_settings WHERE key = ?1 LIMIT 1"
  ).bind(String(key)).first();
  return row ? String(row.value ?? "") : String(fallback ?? "");
}

async function setMasterSetting(env, key, value) {
  await ensureMasterSettingsTable(env);
  await env.DB.prepare(
    `INSERT INTO master_settings(key, value, updated_at)
     VALUES(?1, ?2, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).bind(String(key), String(value ?? "")).run();
}

async function openAIMasterSummary(env) {
  const usage = await tokenUsage(env);
  const apiConnected = Boolean(String(env.OPENAI_API_KEY_SHARED || "").trim());
  const ragnarConnected = Boolean(String(env.OPENAI_API_KEY_RAGNAR || "").trim());

  const [balanceRaw, budgetRaw] = await Promise.all([
    getMasterSetting(env, "openai_current_balance_usd", ""),
    getMasterSetting(env, "openai_monthly_budget_usd", "")
  ]);

  const balanceEstimatedUsd = balanceRaw === "" ? null : Number(balanceRaw);
  const monthlyBudgetUsd = budgetRaw === "" ? null : Number(budgetRaw);

  const monthPrefix = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit"
  }).format(new Date());

  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  const ragnarId = String(env.RAGNAR_CLIENT_ID || "ragnar-one");
  const nexusRows = usage.filter(row => String(row.clientId || "") !== ragnarId);
  const ragnarRows = usage.filter(row => String(row.clientId || "") === ragnarId);

  const nexusTodayTokens = nexusRows
    .filter(row => String(row.dayKey || "") === todayKey)
    .reduce((sum, row) => sum + Number(row.usedTokens || 0), 0);
  const nexusMonthTokens = nexusRows
    .filter(row => String(row.dayKey || "").startsWith(monthPrefix))
    .reduce((sum, row) => sum + Number(row.usedTokens || 0), 0);
  const ragnarTodayTokens = ragnarRows
    .filter(row => String(row.dayKey || "") === todayKey)
    .reduce((sum, row) => sum + Number(row.usedTokens || 0), 0);
  const ragnarMonthTokens = ragnarRows
    .filter(row => String(row.dayKey || "").startsWith(monthPrefix))
    .reduce((sum, row) => sum + Number(row.usedTokens || 0), 0);

  const monthTokens = nexusMonthTokens + ragnarMonthTokens;
  const monthCostUsd = null;
  const budgetRemainingUsd = monthlyBudgetUsd == null || monthCostUsd == null
    ? null
    : Math.max(0, monthlyBudgetUsd - monthCostUsd);
  const budgetPercent = monthlyBudgetUsd && monthCostUsd != null
    ? Math.min(100, Math.round((monthCostUsd / monthlyBudgetUsd) * 100))
    : null;

  return {
    ok: true,
    connected: apiConnected,
    apiConnected,
    billingConnected: false,
    ragnarConnected,
    routing: {
      ragnar: "OPENAI_API_KEY_RAGNAR",
      default: "OPENAI_API_KEY_SHARED"
    },
    balanceEstimatedUsd: Number.isFinite(balanceEstimatedUsd) ? balanceEstimatedUsd : null,
    monthlyBudgetUsd: Number.isFinite(monthlyBudgetUsd) ? monthlyBudgetUsd : null,
    budgetRemainingUsd,
    budgetPercent,
    monthCostUsd,
    monthTokens,
    nexusTodayTokens,
    nexusMonthTokens,
    ragnarTodayTokens,
    ragnarMonthTokens,
    usage
  };
}

export async function handleMaster(request, env, url) {
  if ((url.pathname === "/master" || url.pathname === "/master/" || url.pathname === "/index.html")
      && request.method === "GET") {
    if (!await requireMaster(request, env)) {
      return new Response(masterLoginPage(false), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
      });
    }
    return asset(env, request, "/admin-dashboard.html");
  }

  if (url.pathname === "/master-login" && request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const username = String(form?.get("username") || "").trim();
    const password = String(form?.get("password") || "");
    if (!await masterCredentialsValid(env, username, password)) {
      return new Response(masterLoginPage(true), {
        status: 401,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
      });
    }
    const session = await createMasterSession(env);
    return redirect("/master", { "set-cookie": masterSessionCookie(session.token) });
  }

  if (url.pathname === "/api/master/desktop-login" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");

    if (!await masterCredentialsValid(env, username, password)) {
      return json({ ok: false, error: "invalid_credentials" }, 401);
    }

    const session = await createMasterSession(env);
    return json({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      consolePath: "/api/master/console"
    }, 200);
  }

  if (url.pathname === "/master-logout" && request.method === "POST") {
    await deleteMasterSession(env, request).catch(() => {});
    return json({ ok: true }, 200, { "set-cookie": clearMasterSessionCookie() });
  }

  if (url.pathname === "/api/master/access" && request.method === "GET") {
    return new Response(masterLoginPage(false, "/api/master/access"), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate",
        "pragma": "no-cache"
      }
    });
  }

  if (url.pathname === "/api/master/access" && request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const username = String(form?.get("username") || "").trim();
    const password = String(form?.get("password") || "");
    if (!await masterCredentialsValid(env, username, password)) {
      return new Response(masterLoginPage(true, "/api/master/access"), {
        status: 401,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store, no-cache, must-revalidate",
          "pragma": "no-cache"
        }
      });
    }
    const session = await createMasterSession(env);
    return redirect("/api/master/console", { "set-cookie": masterSessionCookie(session.token) });
  }

  if (url.pathname === "/api/master/console" && request.method === "GET") {
    if (!await requireMaster(request, env)) {
      return redirect("/api/master/access");
    }
    return asset(env, request, "/admin-dashboard.html");
  }

  if (url.pathname === "/api/master/diagnostic" && request.method === "GET") {
    let d1Ready = false;
    let masterUsers = 0;
    try {
      const health = await env.DB.prepare("SELECT 1 AS ok").first();
      d1Ready = Number(health?.ok || 0) === 1;
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
      const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM master_users").first();
      masterUsers = Number(count?.count || 0);
    } catch {}
    return json({
      ok: d1Ready,
      runtime: "cloudflare-workers",
      service: "Servidor Nexus",
      d1Ready,
      masterUsers,
      canonicalMasterConfigured: Boolean(env.NEXUS_ADMIN_USERNAME && env.NEXUS_ADMIN_PASSWORD),
      legacyMasterConfigured: Boolean(env.ADMIN_USERNAME && env.ADMIN_PASSWORD),
      nexusSecretConfigured: Boolean(env.NEXUS_SECRET_KEY)
    }, d1Ready ? 200 : 503);
  }

  const protectedApi =
    url.pathname === "/api/clients"
    || url.pathname.startsWith("/api/clients/")
    || url.pathname.startsWith("/api/master/")
    || url.pathname === "/api/system/status"
    || url.pathname.startsWith("/api/migration/");

  if (!protectedApi) return null;
  if (!await requireMaster(request, env)) return json({ error: "unauthorized" }, 401);

  if (url.pathname === "/api/master/instagram-connect" && request.method === "GET") {
    const clientId = String(url.searchParams.get("clientId") || "").trim();
    if (!clientId) return json({ error: "client_id_required" }, 400);
    const client = await getClient(env, clientId);
    if (!client) return json({ error: "client_not_found" }, 404);
    try {
      const oauth = await startInstagramOAuth(env, request, clientId);
      return redirect(oauth.url);
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : String(error),
        clientId
      }, 400);
    }
  }

  if (url.pathname === "/api/system/status" && request.method === "GET") {
    const [clientCount, sessionCount, videoCount, postCount] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM clients").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM portal_sessions").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM video_jobs").first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM post_ledger").first()
    ]);
    return json({
      ok: true,
      service: "Servidor Nexus",
      runtime: "cloudflare-workers",
      migrationMode: false,
      githubConfigured: true,
      githubRepository: "globalplay27/SERVIDOR-GLOBAL-PLAY",
      database: "d1",
      media: env.MEDIA ? "r2-bound" : "r2-unavailable",
      counts: {
        clients: Number(clientCount?.count || 0),
        portalSessions: Number(sessionCount?.count || 0),
        videoJobs: Number(videoCount?.count || 0),
        posts: Number(postCount?.count || 0)
      }
    });
  }

  if (url.pathname === "/api/clients" && request.method === "GET") {
    return json((await listClients(env)).map(masterClientView));
  }

  if (url.pathname === "/api/clients" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    let id = slug(body.id || body.name || "cliente") || crypto.randomUUID();
    if (await getClient(env, id)) id += "-" + String(Date.now()).slice(-5);

    const config = {
      theme: body.theme || "green-black",
      primaryColor: body.primaryColor || "#18c96e",
      secondaryColor: body.secondaryColor || "#07140c",
      odin: true,
      postTimes: ["09:00", "12:00", "18:00"],
      leads: { total: 0, hot: 0, warm: 0, cold: 0 },
      usage: { openaiPercent: 0, railwayPercent: 0 },
      openaiDailyTokenLimit: 30000,
      aiMode: id === "ragnar-one" ? "own-key" : "shared",
      aiMonthlyImageLimit: 0,
      aiImagesUsed: 0,
      managedInfrastructure: true,
      onboarding: {
        github: true,
        railway: false,
        openai: true,
        instagram: false,
        facebook: true,
        metaApp: true,
        creativeProfile: false,
        supportRequested: false
      },
      setupMode: "managed",
      openaiKeySource: id === "ragnar-one" ? "ragnar-exclusive" : "shared"
    };

    const client = await upsertClient(env, {
      id,
      name: String(body.name || "Novo cliente").trim(),
      niche: String(body.niche || "Outro").trim(),
      instagram: "",
      status: "setup",
      config
    });

    const username = slug(body.username || id).replace(/-/g, ".") || id;
    const suppliedPassword = String(body.password || "").trim();
    const generatedPassword = "Nx!" + crypto.randomUUID().replace(/-/g, "").slice(0, 13);
    const password = suppliedPassword || generatedPassword;
    if (password.length < 8) return json({ error: "portal_password_too_short" }, 400);

    await upsertPortalUser(env, id, username, password);

    const portalCredentials = {
      username,
      portalPath: "/login",
      initialPassword: password,
      generated: !suppliedPassword
    };

    return json({ client: masterClientView(client), portalCredentials }, 201);
  }

  const clientMatch = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (clientMatch && request.method === "PATCH") {
    const clientId = decodeURIComponent(clientMatch[1]);
    const existing = await getClient(env, clientId);
    if (!existing) return json({ error: "not_found" }, 404);
    const body = await request.json().catch(() => ({}));
    const currentConfig = existing.config && typeof existing.config === "object" ? existing.config : {};
    const nextConfig = { ...currentConfig };
    const configKeys = [
      "theme","primaryColor","secondaryColor","odin","postTimes","leads","usage",
      "openaiDailyTokenLimit",
      "onboarding","setupMode","postingProfile","agentProfile","agentCore","managedInfrastructure"
    ];
    for (const key of configKeys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) nextConfig[key] = body[key];
    }
    nextConfig.openaiKeySource = clientId === String(env.RAGNAR_CLIENT_ID || "ragnar-one")
      ? "ragnar-exclusive"
      : "shared";
    nextConfig.aiMode = clientId === String(env.RAGNAR_CLIENT_ID || "ragnar-one")
      ? "own-key"
      : "shared";

    const updated = await upsertClient(env, {
      ...existing,
      name: body.name ?? existing.name,
      niche: body.niche ?? existing.niche,
      instagram: body.instagram ?? existing.instagram,
      status: body.status ?? existing.status,
      config: nextConfig
    });
    return json(masterClientView(updated));
  }

  if (clientMatch && request.method === "DELETE") {
    const clientId = decodeURIComponent(clientMatch[1]);
    if (clientId === "ragnar-one" || clientId === "globalplay-streaming") {
      return json({ error: "protected_core_client" }, 409);
    }
    const result = await env.DB.prepare("DELETE FROM clients WHERE id = ?1").bind(clientId).run();
    return json({ ok: true, deleted: Number(result?.meta?.changes || 0) > 0 });
  }

  if (url.pathname === "/api/migration/portal-user" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      const record = await upsertPortalUser(env, body.clientId, body.username, body.password);
      return json({ ok: true, user: record }, 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  if (url.pathname === "/api/master/support" && request.method === "GET") {
    return json({ ok: true, tickets: await allSupportTickets(env) });
  }

  const agentConfigMatch = url.pathname.match(/^\/api\/master\/agent-config\/([^/]+)$/);
  if (agentConfigMatch && request.method === "PATCH") {
    const clientId = decodeURIComponent(agentConfigMatch[1]);
    const client = await getClient(env, clientId);
    if (!client) return json({ error: "not_found" }, 404);

    const body = await request.json().catch(() => ({}));
    const currentConfig = client.config && typeof client.config === "object" ? client.config : {};
    const currentProfile = currentConfig.postingProfile && typeof currentConfig.postingProfile === "object"
      ? currentConfig.postingProfile
      : {};

    const postTimes = Array.isArray(body.postTimes)
      ? body.postTimes
          .map(value => String(value || "").trim())
          .filter(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value))
          .slice(0, 8)
      : (Array.isArray(currentConfig.postTimes) ? currentConfig.postTimes : ["09:00", "12:00", "18:00"]);

    const postingProfile = body.postingProfile && typeof body.postingProfile === "object"
      ? { ...currentProfile, ...body.postingProfile }
      : currentProfile;

    const updated = await upsertClient(env, {
      ...client,
      config: {
        ...currentConfig,
        postTimes: postTimes.length ? postTimes : ["09:00", "12:00", "18:00"],
        postingProfile
      }
    });

    return json({ ok: true, client: masterClientView(updated) });
  }

  if (url.pathname === "/api/master/posts" && request.method === "GET") {
    return json({ ok: true, posts: await allPosts(env) });
  }

  if (url.pathname === "/api/master/leads" && request.method === "GET") {
    return json(await masterLeadSummary(env));
  }

  if (url.pathname === "/api/master/agent-core" && request.method === "GET") {
    return json(await agentCoreDashboard(env));
  }

  const agentCoreMatch = url.pathname.match(/^\/api\/master\/agent-core\/([^/]+)$/);
  if (agentCoreMatch && request.method === "GET") {
    const clientId = decodeURIComponent(agentCoreMatch[1]);
    const client = await getClient(env, clientId);
    if (!client) return json({ error: "not_found" }, 404);
    return json({ ok: true, ...(await agentCoreClientView(env, client)) });
  }

  if (agentCoreMatch && request.method === "PATCH") {
    const clientId = decodeURIComponent(agentCoreMatch[1]);
    const body = await request.json().catch(() => ({}));
    try {
      const config = await saveAgentCoreConfig(env, clientId, body);
      return json({ ok: true, config });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      return json({ error: code }, code === "client_not_found" ? 404 : 400);
    }
  }

  const agentRunMatch = url.pathname.match(/^\/api\/master\/agent-core\/([^/]+)\/run$/);
  if (agentRunMatch && request.method === "POST") {
    const clientId = decodeURIComponent(agentRunMatch[1]);
    const body = await request.json().catch(() => ({}));
    try {
      return json(await queueManualAgentRun(env, clientId, body.agent || "all"));
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      return json({ error: code }, code === "client_not_found" ? 404 : 400);
    }
  }

  if (url.pathname === "/api/master/instagram" && request.method === "GET") {
    return json(await getMasterInstagramSummary(env, request));
  }

  if (url.pathname === "/api/master/instagram" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      return json(await saveMasterInstagramConfig(env, request, body));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  if (url.pathname === "/api/master/openai" && request.method === "GET") {
    return json(await openAIMasterSummary(env));
  }

  if (url.pathname === "/api/master/openai" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));

    if (Object.prototype.hasOwnProperty.call(body, "currentBalanceUsd")) {
      const value = String(body.currentBalanceUsd ?? "").trim();
      if (value !== "") {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0) return json({ error: "invalid_balance" }, 400);
        await setMasterSetting(env, "openai_current_balance_usd", number.toFixed(2));
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "monthlyBudgetUsd")) {
      const value = String(body.monthlyBudgetUsd ?? "").trim();
      if (value !== "") {
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0) return json({ error: "invalid_budget" }, 400);
        await setMasterSetting(env, "openai_monthly_budget_usd", number.toFixed(2));
      }
    }

    return json(await openAIMasterSummary(env));
  }

  return json({
    error: "not_migrated_yet",
    runtime: "cloudflare-workers",
    path: url.pathname
  }, 501);
}
