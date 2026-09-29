import { DurableObject } from "cloudflare:workers";
import { openAIKeyStatus } from "./openai-routing.js";
import { openAIResponses, tokenUsageToday } from "./openai.js";
import { getState, putState, deleteState } from "./storage.js";
import { handlePortalApi } from "./portal.js";
import { handleMaster } from "./master.js";
import { runSchedulerTick } from "./scheduler.js";
import { processDueJobs } from "./executor.js";
import { handleWhatsAppWebhook, handleWhatsAppProtected, whatsappConfigStatus } from "./whatsapp-agent.js";
import { instagramCredentialStatus } from "./instagram-credentials.js";
import { instagramMasterConfigStatus } from "./instagram.js";
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
    },
    whatsapp: whatsappConfigStatus(env)
  }, d1 ? 200 : 503);
}

async function autonomyHealth(env) {
  const expectedAgents = [
    "RADAR","ESTRATEGISTA","PESQUISADOR","ANALISTA","CREATOR","COPY CHIEF",
    "DESIGNER","VIDEO","PUBLISHER","ODIN","SUPORTE","AUDITOR","GROWTH"
  ];
  try {
    const [heartbeatRow, clientsResult, executionsResult, leadRunsResult, leadConfigsResult, leadCountsResult, postsResult, jobsResult, openaiResult] = await Promise.all([
      env.DB.prepare(
        "SELECT value_json,updated_at FROM nexus_state WHERE namespace='scheduler' AND item_key='heartbeat' AND client_id='' LIMIT 1"
      ).first(),
      env.DB.prepare(
        "SELECT id,name,status FROM clients WHERE status='online' ORDER BY id"
      ).all(),
      env.DB.prepare(
        "SELECT client_id,agent,status,detail_json,created_at FROM agent_executions ORDER BY created_at DESC LIMIT 500"
      ).all(),
      env.DB.prepare(
        "SELECT client_id,status,finished_at,analyzed,new_leads FROM lead_hunter_runs ORDER BY COALESCE(finished_at,created_at) DESC LIMIT 100"
      ).all(),
      env.DB.prepare(
        "SELECT client_id,value_json FROM nexus_state WHERE namespace='lead-hunter' AND item_key='config'"
      ).all(),
      env.DB.prepare(
        "SELECT client_id,COUNT(*) AS total FROM leads GROUP BY client_id"
      ).all(),
      env.DB.prepare(
        "SELECT id,client_id,scheduled_for,status,approval_status,media_id,error,payload_json,created_at,updated_at FROM post_ledger WHERE client_id IN ('globalplay-streaming','ragnar-one') ORDER BY created_at DESC LIMIT 60"
      ).all(),
      env.DB.prepare(
        "SELECT client_id,kind,status,attempts,due_at,updated_at,last_error FROM scheduled_jobs WHERE client_id IN ('globalplay-streaming','ragnar-one') ORDER BY created_at DESC LIMIT 60"
      ).all(),
      env.DB.prepare(
        "SELECT client_id,status,detail,updated_at FROM openai_runtime_status WHERE client_id IN ('globalplay-streaming','ragnar-one')"
      ).all().catch(() => ({ results: [] }))
    ]);

    const heartbeat = (() => {
      try { return JSON.parse(String(heartbeatRow?.value_json || "{}")); } catch { return {}; }
    })();
    const now = Date.now();
    const heartbeatMs = Date.parse(String(heartbeatRow?.updated_at || heartbeat?.at || ""));
    const heartbeatAgeSeconds = Number.isFinite(heartbeatMs) ? Math.max(0, Math.round((now - heartbeatMs) / 1000)) : null;

    const latest = new Map();
    for (const row of executionsResult?.results || []) {
      const key = String(row.client_id || "") + "::" + String(row.agent || "").toUpperCase();
      if (!latest.has(key)) latest.set(key, row);
    }
    const lastLeadRun = new Map();
    for (const row of leadRunsResult?.results || []) {
      if (!lastLeadRun.has(row.client_id)) lastLeadRun.set(row.client_id, row);
    }
    const leadConfigs = new Map((leadConfigsResult?.results || []).map(row => {
      try { return [row.client_id, JSON.parse(row.value_json || "{}")] ; }
      catch { return [row.client_id, {}]; }
    }));
    const leadCounts = new Map((leadCountsResult?.results || []).map(row => [row.client_id, Number(row.total || 0)]));

    const instagramHealth = new Map(await Promise.all(
      (clientsResult?.results || []).map(async client => [
        String(client.id),
        await instagramCredentialStatus(env, client.id).catch(() => ({
          connected: false,
          source: "unknown",
          expired: false,
          expiresAt: null,
          fallbackReason: "",
          tokenValid: false,
          accountMatches: false,
          validation: "diagnostic_error"
        }))
      ])
    ));

    const clients = (clientsResult?.results || []).map(client => {
      const agents = expectedAgents.map(agent => {
        const row = latest.get(String(client.id) + "::" + agent);
        let detail = {};
        if (agent === "PUBLISHER") {
          try { detail = JSON.parse(row?.detail_json || "{}"); } catch {}
        }
        const at = row?.created_at || null;
        const ageMinutes = at && Number.isFinite(Date.parse(at))
          ? Math.max(0, Math.round((now - Date.parse(at)) / 60000))
          : null;
        const result = {
          agent,
          status: row?.status || "never",
          lastRunAt: at,
          ageMinutes
        };
        if (agent === "PUBLISHER") {
          const m = detail?.metadata || {};
          result.result = {
            candidates: Number(detail.quantity || 0),
            published: Number(m.published || 0),
            failed: Number(m.failed || 0),
            awaitingApproval: Number(m.awaitingApproval || 0),
            awaitingMedia: Number(m.awaitingMedia || 0),
            duplicateMediaBlocked: Number(m.duplicateMediaBlocked || 0),
            duplicateCaptionBlocked: Number(m.duplicateCaptionBlocked || 0)
          };
        }
        return result;
      });
      const missing = agents.filter(item => item.status === "never").map(item => item.agent);
      const leadSettings = leadConfigs.get(client.id) || {};
      const defaultAuto = ["globalplay-streaming", "ragnar-one"].includes(client.id);
      const autoEnabled = leadSettings.enabled !== false && (leadSettings.autoRun === undefined ? defaultAuto : leadSettings.autoRun === true);
      const leadRun = lastLeadRun.get(client.id);
      const posts = (postsResult?.results || []).filter(row => row.client_id === client.id).slice(0, 12).map(row => {
        let payload = {};
        try { payload = JSON.parse(row.payload_json || "{}"); } catch {}
        const code = String(row.error || "");
        return {
          id: row.id, scheduledFor: row.scheduled_for, status: row.status,
          approval: row.approval_status, mediaIdPresent: Boolean(row.media_id),
          imagePresent: Boolean(payload.imageUrl || payload.publicImageUrl),
          copyChief: payload.qualityGates?.copyChief || null,
          designer: payload.qualityGates?.designer || null,
          reviewStatus: payload.visualReview?.status || null,
          reviewAttempts: Math.max(0, Number(payload.visualReview?.attempts || 0)),
          diagnosticRetry: payload.visualReview?.diagnosticRetry === true,
          reviewReason: /^[a-z_0-9]+$/.test(String(payload.visualReview?.reason || ""))
            ? String(payload.visualReview.reason).slice(0, 80) : null,
          blockedMediaPresent: Boolean(payload.blockedDesignerMedia),
          blockedMediaIsCorruptLegacy: /\/assets\/ragnar\/nordic-cinema-0[123]\.png(?:[?#]|$)/i.test(String(payload.blockedDesignerMedia||"")),
          blockedReviewStatus: ["approved","rejected","unavailable"].includes(String(payload.blockedDesignerReviewStatus||""))
            ? payload.blockedDesignerReviewStatus : null,
          blockedReviewChecks: payload.blockedDesignerReviewChecks && typeof payload.blockedDesignerReviewChecks === "object"
            ? Object.fromEntries(["singleScene","noCollage","tvFilled","legibleText","brandCorrect","originalGenericVisual"]
              .filter(key => typeof payload.blockedDesignerReviewChecks[key] === "boolean")
              .map(key => [key,payload.blockedDesignerReviewChecks[key]])) : null,
          recoveryAttempted: Boolean(payload.blockedDesignerRecoveryAttemptedAt),
          retries: Number(payload.retryCount || 0),
          publishedAt: payload.publishedAt || null,
          errorCode: /^[a-z_]+$/.test(code) ? code.slice(0, 80) : (code ? "external_api_error" : ""),
          createdAt: row.created_at, updatedAt: row.updated_at
        };
      });
      const jobs = (jobsResult?.results || []).filter(row => row.client_id === client.id).slice(0, 12).map(row => ({
        kind: row.kind, status: row.status, attempts: row.attempts,
        dueAt: row.due_at, updatedAt: row.updated_at,
        errorCode: /^[a-z_]+$/.test(String(row.last_error || "")) ? String(row.last_error).slice(0, 80) : (row.last_error ? "execution_error" : "")
      }));
      const provider = (openaiResult?.results || []).find(row => row.client_id === client.id);
      return {
        clientId: client.id,
        clientName: client.name,
        status: client.status,
        agents,
        allAgentsSeen: missing.length === 0,
        missingAgents: missing,
        instagramConnection: instagramHealth.get(String(client.id)) || {
          connected: false,
          source: "unknown",
          expired: false,
          expiresAt: null,
          fallbackReason: "",
          tokenValid: false,
          accountMatches: false,
          validation: "unknown"
        },
        publishingDiagnostic: {
          posts, jobs,
          openai: {
            status: provider?.status || "unknown",
            code: /^[a-z_0-9]+$/.test(String(provider?.detail || ""))
              ? String(provider.detail).slice(0, 80) : (provider?.detail ? "provider_error" : ""),
            updatedAt: provider?.updated_at || null
          }
        },
        leadCapture: {
          autoEnabled,
          lastRunAt: leadRun?.finished_at || null,
          lastRunStatus: leadRun?.status || "never",
          lastAnalyzed: Number(leadRun?.analyzed || 0),
          lastNew: Number(leadRun?.new_leads || 0),
          totalLeads: leadCounts.get(client.id) || 0
        }
      };
    });

    const schedulerHealthy = heartbeatAgeSeconds !== null && heartbeatAgeSeconds <= 180;
    const instagramCentral = await instagramMasterConfigStatus(env).catch(() => ({
      configured: false,
      appIdConfigured: false,
      appSecretConfigured: false,
      appIdSource: "unknown",
      appSecretSource: "unknown",
      updatedAt: null
    }));

    return json({
      ok: schedulerHealthy && clients.every(client => client.allAgentsSeen),
      runtime: "cloudflare-workers",
      automationActive: String(env.CLOUDFLARE_AUTOMATION_ACTIVE || "").toLowerCase() === "true",
      expectedAgents: expectedAgents.length,
      instagramCentral,
      scheduler: {
        healthy: schedulerHealthy,
        lastHeartbeatAt: heartbeatRow?.updated_at || heartbeat?.at || null,
        ageSeconds: heartbeatAgeSeconds,
        summary: heartbeat
      },
      clients
    }, 200);
  } catch (error) {
    return json({
      ok: false,
      runtime: "cloudflare-workers",
      error: String(error instanceof Error ? error.message : error).slice(0, 500)
    }, 503);
  }
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

    if (url.pathname === "/api/whatsapp/webhook") {
      return handleWhatsAppWebhook(request, env, url, ctx);
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

    if (url.pathname === "/api/autonomy-health" && request.method === "GET") {
      return autonomyHealth(env);
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

    if (url.pathname.startsWith("/api/whatsapp/")) {
      const denied = requireAuth(request, env);
      if (denied) return denied;
      const response = await handleWhatsAppProtected(request, env, url);
      if (response) return response;
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
