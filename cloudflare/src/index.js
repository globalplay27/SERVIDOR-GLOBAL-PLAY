import { DurableObject } from "cloudflare:workers";
import { openAIKeyStatus } from "./openai-routing.js";
import { openAIResponses, tokenUsageToday } from "./openai.js";
import { getState, putState, deleteState } from "./storage.js";
import { handlePortalApi } from "./portal.js";
import { handleMaster } from "./master.js";
import { runSchedulerTick } from "./scheduler.js";
import { processDueJobs } from "./executor.js";
import { masterCredentialsValid, createMasterSession, authenticatePortalUser, createPortalSession, masterSessionCookie, portalSessionCookie, loginRateLimitStatus, recordLoginFailure, clearLoginFailures, resolvePortalSession, resolveMasterSession } from "./auth.js";

// Keep the exact legacy export name until Cloudflare removes its existing Durable Objects.
export class YoutubeDownloader extends DurableObject {
  async fetch() {
    return new Response(JSON.stringify({
      ok: false,
      error: "youtube_container_not_enabled"
    }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}

// Another existing Durable Object namespace uses this capitalization.
export class YouTubeDownloader extends YoutubeDownloader {}

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

function authorized(request, env) {
  const expected = String(env.NEXUS_SECRET_KEY || "");
  const provided = String(request.headers.get("authorization") || "");
  return Boolean(expected && provided === `Bearer ${expected}`);
}

function requireAuth(request, env) {
  return authorized(request, env) ? null : json({ error: "unauthorized" }, 401);
}

async function asset(env, request, pathname) {
  if (!env.ASSETS) return json({ error: "assets_binding_unavailable" }, 503);
  const target = new URL(request.url);
  target.pathname = pathname;
  target.search = "";
  return env.ASSETS.fetch(new Request(target.toString(), request));
}

async function mediaResponse(request, env, url) {
  if (!env.MEDIA) return json({ error: "r2_unavailable" }, 503);

  let key = "";
  try {
    key = decodeURIComponent(url.pathname.slice("/media/".length));
  } catch {
    return json({ error: "invalid_media_path" }, 400);
  }

  if (!key || key.includes("..") || key.includes("\\") || key.startsWith("/")) {
    return json({ error: "not_found" }, 404);
  }

  const publicMedia = key.startsWith("branding/") || key.startsWith("posts/");
  const videoMatch = key.match(/^videos\/([^/]+)\//);
  if (!publicMedia && !videoMatch) return json({ error: "not_found" }, 404);

  if (videoMatch) {
    const clientId = String(videoMatch[1] || "");
    const portal = await resolvePortalSession(env, request).catch(() => null);
    const master = portal ? null : await resolveMasterSession(env, request).catch(() => null);
    if ((!portal || portal.clientId !== clientId) && !master) {
      return json({ error: "unauthorized" }, 401);
    }
  }

  const isHead = request.method === "HEAD";
  let object;
  try {
    object = isHead
      ? await env.MEDIA.head(key)
      : await env.MEDIA.get(key, request.headers.get("range") ? { range: request.headers } : undefined);
  } catch {
    return new Response(null, { status: 416, headers: { "accept-ranges": "bytes" } });
  }
  if (!object) return json({ error: "not_found" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", publicMedia ? "public, max-age=31536000, immutable" : "private, no-store");

  let status = 200;
  if (!isHead && object.range && Number.isFinite(object.range.offset) && Number.isFinite(object.range.length)) {
    const rangeStart = Number(object.range.offset);
    const rangeLength = Number(object.range.length);
    headers.set("content-range", "bytes " + rangeStart + "-" + (rangeStart + rangeLength - 1) + "/" + object.size);
    headers.set("content-length", String(rangeLength));
    status = 206;
  } else if (Number.isFinite(object.size)) {
    headers.set("content-length", String(object.size));
  }

  return new Response(isHead ? null : object.body, { status, headers });
}

async function health(env) {
  let d1 = false;
  try {
    const row = await env.DB.prepare("SELECT 1 AS ok").first();
    d1 = Number(row?.ok || 0) === 1;
  } catch {
    d1 = false;
  }
  return json({
    ok: d1,
    service: "Servidor Nexus",
    runtime: "cloudflare-workers",
    migrationMode: false,
    database: d1 ? "d1-ready" : "d1-unavailable",
    media: env.MEDIA ? "r2-bound" : "r2-unavailable",
    assets: env.ASSETS ? "bound" : "unavailable",
    openai: {
      shared: openAIKeyStatus(env, "shared-client").configured,
      ragnar: openAIKeyStatus(env, env.RAGNAR_CLIENT_ID || "ragnar-one").configured
    }
  }, d1 ? 200 : 503);
}

function operationalErrorCategory(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return "none";
  if (/quality_gate|visual_quality|copy_quality/.test(text)) return "quality_gate";
  if (/unique_media|duplicate_media|image.*required|media.*missing/.test(text)) return "media";
  if (/duplicate_caption/.test(text)) return "duplicate_caption";
  if (/instagram_not_connected|token|oauth|permission|scope|authoriz/.test(text)) return "instagram_auth";
  if (/instagram.*process|container|media_publish/.test(text)) return "instagram_publish";
  if (/quota|budget|openai/.test(text)) return "openai_or_budget";
  if (/timed?out|timeout|network|fetch|http_5/.test(text)) return "network";
  return "other";
}

async function temporarySchedulerDiagnostic(env) {
  const clients = await env.DB.prepare(
    `SELECT id, status, instagram, config_json, updated_at
     FROM clients WHERE id IN ('ragnar-one','globalplay-streaming')`
  ).all();
  const jobs = await env.DB.prepare(
    `SELECT id, client_id, kind, status, attempts, due_at, updated_at, last_error
     FROM scheduled_jobs WHERE client_id IN ('ragnar-one','globalplay-streaming')
     ORDER BY updated_at DESC LIMIT 30`
  ).all();
  const posts = await env.DB.prepare(
    `SELECT id, client_id, status, approval_status, scheduled_for, created_at, updated_at, error,
       json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.copyChief') copy_gate,
       json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.designer') visual_gate,
       json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.retryCount') retry_count,
       CASE WHEN json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.imageUrl') IS NOT NULL
         AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.imageUrl') <> '' THEN 1 ELSE 0 END media_present
     FROM post_ledger WHERE client_id IN ('ragnar-one','globalplay-streaming')
     ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 30`
  ).all();
  const state = await env.DB.prepare(
    `SELECT namespace, item_key, client_id, value_json, updated_at FROM nexus_state
     WHERE (namespace='agent-core' AND item_key IN ('scheduler','state')
       AND client_id IN ('ragnar-one','globalplay-streaming'))
       OR (namespace='scheduler' AND item_key='heartbeat' AND client_id='')
     ORDER BY updated_at DESC LIMIT 8`
  ).all();
  const oauth = await env.DB.prepare(
    `SELECT client_id, provider, payload_json, connected_at, updated_at FROM connections
     WHERE client_id IN ('ragnar-one','globalplay-streaming') AND provider IN ('instagram','meta')`
  ).all();
  const parse = value => {
    try { return JSON.parse(String(value || "{}")); } catch { return {}; }
  };
  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    clients: (clients.results || []).map(row => {
      const config = parse(row.config_json);
      return { id: row.id, status: row.status, instagram: row.instagram, postTimes: config.postTimes || [], agentCore: config.agentCore || null, updatedAt: row.updated_at };
    }),
    jobs: (jobs.results || []).map(row => ({ id: row.id, clientId: row.client_id, kind: row.kind, status: row.status, attempts: row.attempts, dueAt: row.due_at, updatedAt: row.updated_at, errorCategory: operationalErrorCategory(row.last_error) })),
    posts: (posts.results || []).map(row => ({ id: row.id, clientId: row.client_id, status: row.status, approval: row.approval_status, scheduledFor: row.scheduled_for, createdAt: row.created_at, updatedAt: row.updated_at, errorCategory: operationalErrorCategory(row.error), copyGate: row.copy_gate, visualGate: row.visual_gate, retryCount: row.retry_count || 0, mediaPresent: Boolean(row.media_present) })),
    state: (state.results || []).map(row => { const value = parse(row.value_json); return { namespace: row.namespace, itemKey: row.item_key, clientId: row.client_id, updatedAt: row.updated_at, lastCronAt: value.lastCronAt || null, lastCycleAt: value.lastCycleAt || null, lastCycleStatus: value.lastCycleStatus || null, lastCycleErrorCategory: operationalErrorCategory(value.lastCycleError), summary: row.namespace === 'scheduler' ? value : undefined }; }),
    oauth: (oauth.results || []).map(row => { const value = parse(row.payload_json); const expires = value.expiresAt || null; return { clientId: row.client_id, provider: row.provider, connectedAt: row.connected_at, updatedAt: row.updated_at, hasToken: Boolean(value.accessToken), hasInstagramId: Boolean(value.igUserId), username: String(value.username || ''), expiresAt: expires, expired: Boolean(expires && new Date(expires).getTime() <= Date.now()) }; })
  });
}

async function handleState(request, env, url) {
  const denied = requireAuth(request, env);
  if (denied) return denied;

  const namespace = url.searchParams.get("namespace") || "";
  const itemKey = url.searchParams.get("key") || "";
  const clientId = url.searchParams.get("clientId") || "";
  if (!namespace || !itemKey) return json({ error: "namespace_and_key_required" }, 400);

  if (request.method === "GET") {
    const record = await getState(env, namespace, itemKey, clientId);
    return record ? json({ ok: true, record }) : json({ error: "not_found" }, 404);
  }

  if (request.method === "PUT") {
    const body = await request.json().catch(() => ({}));
    const record = await putState(env, namespace, itemKey, clientId, body?.value ?? body);
    return json({ ok: true, record });
  }

  if (request.method === "DELETE") {
    const deleted = await deleteState(env, namespace, itemKey, clientId);
    return json({ ok: true, deleted });
  }

  return json({ error: "method_not_allowed" }, 405);
}

async function handleOpenAIResponses(request, env) {
  const denied = requireAuth(request, env);
  if (denied) return denied;
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = await request.json().catch(() => ({}));
  const clientId = String(body?.clientId || "").trim();
  if (!clientId) return json({ error: "client_id_required" }, 400);

  const exists = await env.DB.prepare("SELECT id FROM clients WHERE id = ?1 LIMIT 1").bind(clientId).first();
  if (!exists) return json({ error: "client_not_found" }, 404);

  try {
    const result = await openAIResponses(env, clientId, body);
    return json(result);
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : String(error),
      detail: error?.detail || null
    }, Number(error?.status || 502));
  }
}

export default {
  async scheduled(event, env, ctx) {
    const at = new Date(event.scheduledTime || Date.now());
    ctx.waitUntil((async () => {
      await runSchedulerTick(env, at);
      await processDueJobs(env, at);
    })());
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return redirect("/login");
    }

    if (url.pathname.startsWith("/media/") && ["GET","HEAD"].includes(request.method)) {
      return mediaResponse(request, env, url);
    }


    if (url.pathname === "/login" && request.method === "GET") {
      return asset(env, request, "/portal.html");
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const username = String(body?.username || "").trim();
      const password = String(body?.password || "");

      if (!username || !password) {
        return json({ ok: false, error: "username_and_password_required" }, 400);
      }

      // Always allow a valid credential to recover from a previous lockout.
      // Rate limiting is applied only after both Master and client credentials fail.
      if (await masterCredentialsValid(env, username, password)) {
        await clearLoginFailures(env, request, "login");
        const session = await createMasterSession(env);
        return json({
          ok: true,
          role: "master",
          token: session.token,
          expiresAt: session.expiresAt,
          cookieName: "nexus_master",
          entryPath: "/api/master/console"
        }, 200, { "set-cookie": masterSessionCookie(session.token) });
      }

      const clientId = await authenticatePortalUser(env, username, password);
      if (clientId) {
        await clearLoginFailures(env, request, "login");
        const session = await createPortalSession(env, clientId, {
          persistent: true,
          source: "unified-desktop"
        });
        return json({
          ok: true,
          role: "client",
          clientId,
          token: session.token,
          expiresAt: session.expiresAt,
          cookieName: "nexus_session",
          entryPath: "/portal.html?auth=1"
        }, 200, { "set-cookie": portalSessionCookie(session.token) });
      }

      const rate = await loginRateLimitStatus(env, request, "login");
      if (!rate.allowed) {
        return json(
          { ok: false, error: "too_many_login_attempts", retryAfter: rate.retryAfter },
          429,
          { "retry-after": String(rate.retryAfter) }
        );
      }

      await recordLoginFailure(env, request, "login");
      return json({ ok: false, error: "invalid_credentials" }, 401);
    }


    const masterResponse = await handleMaster(request, env, url);
    if (masterResponse) return masterResponse;

    const portalResponse = await handlePortalApi(request, env, url, ctx);
    if (portalResponse) return portalResponse;

    if (url.pathname === "/health" || url.pathname === "/api/health") {
      return health(env);
    }

    if (url.pathname === "/api/system/scheduler-diagnostic-20260927" && request.method === "GET") {
      return temporarySchedulerDiagnostic(env);
    }

    if (url.pathname === "/api/system/openai-routing" && request.method === "GET") {
      const denied = requireAuth(request, env);
      if (denied) return denied;
      const clientId = url.searchParams.get("clientId") || "";
      return json(openAIKeyStatus(env, clientId));
    }

    if (url.pathname === "/api/system/token-usage" && request.method === "GET") {
      const denied = requireAuth(request, env);
      if (denied) return denied;
      const clientId = url.searchParams.get("clientId") || "";
      if (!clientId) return json({ error: "client_id_required" }, 400);
      return json({ ok: true, usage: await tokenUsageToday(env, clientId) });
    }

    if (url.pathname === "/api/openai/responses") {
      return handleOpenAIResponses(request, env);
    }

    if (url.pathname === "/api/state") {
      return handleState(request, env, url);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({
        error: "not_migrated_yet",
        service: "Servidor Nexus",
        runtime: "cloudflare-workers",
        path: url.pathname
      }, 501);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);

    return json({
      ok: true,
      service: "Servidor Nexus",
      migrationMode: false,
      message: "Cloudflare runtime is online and operating independently."
    });
  }
};
