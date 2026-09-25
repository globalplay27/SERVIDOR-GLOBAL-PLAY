import { DurableObject } from "cloudflare:workers";
import { openAIKeyStatus } from "./openai-routing.js";
import { openAIResponses, tokenUsageToday } from "./openai.js";
import { getState, putState, deleteState } from "./storage.js";
import { handlePortalApi } from "./portal.js";
import { handleMaster } from "./master.js";
import { runSchedulerTick } from "./scheduler.js";
import { processDueJobs } from "./executor.js";
import { masterCredentialsValid, createMasterSession, authenticatePortalUser, createPortalSession, masterSessionCookie, portalSessionCookie, loginRateLimitStatus, recordLoginFailure, clearLoginFailures, resolvePortalSession, resolveMasterSession } from "./auth.js";
import { processQueuedVideoJobs } from "./video-processing.js";
import { processQueuedVideoImports } from "./r2-video-upload.js";
import { runAgentCoreCycle } from "./agent-runtime.js";
import { decryptSecret } from "./secrets.js";

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

async function readCorePostSmokeStatus(env) {
  const result = await env.DB.prepare(
    `SELECT client_id, value_json, updated_at
     FROM nexus_state
     WHERE namespace = 'ops'
       AND item_key = 'post-smoke-20260925-v2'
       AND client_id IN ('ragnar-one','globalplay-streaming')
     ORDER BY client_id`
  ).all().catch(() => ({ results: [] }));

  return (result?.results || []).map(row => {
    let value = {};
    try { value = JSON.parse(String(row.value_json || "{}")); } catch {}
    return {
      clientId: String(row.client_id || ""),
      status: String(value.status || "unknown"),
      postId: String(value.postId || ""),
      error: String(value.error || ""),
      mediaId: String(value.mediaId || ""),
      metaStatus: String(value.metaStatus || ""),
      mediaPrepared: value.mediaPrepared === true,
      publisher: value.publisher && typeof value.publisher === "object" ? value.publisher : null,
      at: value.at || row.updated_at || null
    };
  });
}

async function runCorePostSmokeTestOnce(env, now = new Date()) {
  const testKey = "post-smoke-20260925-v2";
  const clientIds = ["ragnar-one", "globalplay-streaming"];

  for (const clientId of clientIds) {
    const existing = await env.DB.prepare(
      `SELECT value_json FROM nexus_state
       WHERE namespace='ops' AND item_key=?1 AND client_id=?2 LIMIT 1`
    ).bind(testKey, clientId).first().catch(() => null);
    if (existing) continue;

    const startedAt = now.toISOString();
    const save = async value => {
      await env.DB.prepare(
        `INSERT INTO nexus_state(namespace,item_key,client_id,value_json,updated_at)
         VALUES('ops',?1,?2,?3,CURRENT_TIMESTAMP)
         ON CONFLICT(namespace,item_key,client_id) DO UPDATE SET
           value_json=excluded.value_json,
           updated_at=CURRENT_TIMESTAMP`
      ).bind(testKey, clientId, JSON.stringify({ at: startedAt, ...value })).run();
    };

    try {
      await save({ status: "running", metaStatus: "checking" });

      const connection = await env.DB.prepare(
        `SELECT provider,payload_json,connected_at,updated_at
         FROM connections
         WHERE client_id=?1 AND provider IN ('meta','instagram')
         ORDER BY CASE provider WHEN 'meta' THEN 0 ELSE 1 END
         LIMIT 1`
      ).bind(clientId).first();

      if (!connection) {
        await save({
          status: "failed",
          metaStatus: "missing",
          error: "instagram_not_connected"
        });
        continue;
      }

      let connectionPayload = {};
      try { connectionPayload = JSON.parse(String(connection.payload_json || "{}")); } catch {}

      const igUserId = String(connectionPayload.igUserId || "").trim();
      const encryptedToken = String(connectionPayload.accessToken || "");
      const expiresAt = connectionPayload.expiresAt ? new Date(connectionPayload.expiresAt).getTime() : 0;

      if (!igUserId || !encryptedToken) {
        await save({
          status: "failed",
          metaStatus: "incomplete",
          error: "instagram_connection_incomplete"
        });
        continue;
      }
      if (expiresAt && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        await save({
          status: "failed",
          metaStatus: "expired",
          error: "instagram_token_expired"
        });
        continue;
      }

      const accessToken = await decryptSecret(env, encryptedToken).catch(() => "");
      if (!accessToken) {
        await save({
          status: "failed",
          metaStatus: "decrypt_failed",
          error: "instagram_token_unreadable"
        });
        continue;
      }

      const mediaUrl = new URL("https://graph.instagram.com/" + encodeURIComponent(igUserId) + "/media");
      mediaUrl.searchParams.set("fields", "id,media_type,media_url,thumbnail_url");
      mediaUrl.searchParams.set("limit", "12");

      const mediaResponse = await fetch(mediaUrl.toString(), {
        headers: {
          authorization: "Bearer " + accessToken,
          accept: "application/json",
          "user-agent": "NEXUS-PostSmoke/2.0"
        },
        signal: AbortSignal.timeout(12000)
      });
      const mediaPayload = await mediaResponse.json().catch(() => ({}));

      if (!mediaResponse.ok) {
        const message = String(mediaPayload?.error?.message || ("instagram_media_http_" + mediaResponse.status));
        await save({
          status: "failed",
          metaStatus: "api_failed",
          error: message.slice(0,900)
        });
        continue;
      }

      const mediaItems = Array.isArray(mediaPayload?.data) ? mediaPayload.data : [];
      const source = mediaItems
        .map(item => {
          const type = String(item?.media_type || "").toUpperCase();
          const url = type === "VIDEO"
            ? String(item?.thumbnail_url || "")
            : String(item?.media_url || item?.thumbnail_url || "");
          return { type, url };
        })
        .find(item => /^https:\/\//i.test(item.url));

      if (!source?.url) {
        await save({
          status: "failed",
          metaStatus: "valid",
          error: "instagram_no_reusable_media"
        });
        continue;
      }

      let row = await env.DB.prepare(
        `SELECT id,status,approval_status,scheduled_for,media_id,error,payload_json
         FROM post_ledger
         WHERE client_id=?1
           AND status IN ('ready','scheduled','failed')
         ORDER BY COALESCE(scheduled_for,created_at) ASC
         LIMIT 1`
      ).bind(clientId).first();

      if (!row) {
        await runAgentCoreCycle(env, clientId, {
          trigger: "forced-post-smoke-test-v2",
          agent: "all"
        });

        row = await env.DB.prepare(
          `SELECT id,status,approval_status,scheduled_for,media_id,error,payload_json
           FROM post_ledger
           WHERE client_id=?1
             AND status IN ('ready','scheduled','failed')
           ORDER BY COALESCE(scheduled_for,created_at) ASC
           LIMIT 1`
        ).bind(clientId).first();
      }

      if (!row?.id) {
        await save({
          status: "failed",
          metaStatus: "valid",
          error: "no_post_candidate"
        });
        continue;
      }

      if (!env.MEDIA) {
        await save({
          status: "failed",
          metaStatus: "valid",
          error: "r2_unavailable"
        });
        continue;
      }

      const sourceResponse = await fetch(source.url, {
        headers: {
          accept: "image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.2",
          "user-agent": "NEXUS-PostSmoke/2.0"
        },
        signal: AbortSignal.timeout(12000)
      });

      if (!sourceResponse.ok || !sourceResponse.body) {
        await save({
          status: "failed",
          metaStatus: "valid",
          error: "instagram_media_download_failed_" + sourceResponse.status
        });
        continue;
      }

      const type = String(sourceResponse.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
      if (!type.startsWith("image/")) {
        await save({
          status: "failed",
          metaStatus: "valid",
          error: "instagram_reusable_media_not_image"
        });
        continue;
      }

      const size = Number(sourceResponse.headers.get("content-length") || 0);
      if (size > 10 * 1024 * 1024) {
        await save({
          status: "failed",
          metaStatus: "valid",
          error: "instagram_reusable_media_too_large"
        });
        continue;
      }

      const extension = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
      const objectKey = "posts/" + clientId + "/" + String(row.id) + "/smoke-" + crypto.randomUUID() + "." + extension;
      await env.MEDIA.put(objectKey, sourceResponse.body, {
        httpMetadata: {
          contentType: type || "image/jpeg",
          cacheControl: "public, max-age=31536000, immutable"
        },
        customMetadata: {
          clientId,
          postId: String(row.id),
          kind: "forced-post-smoke-v2"
        }
      });

      const origin = String(env.PUBLIC_BASE_URL || "").replace(/\/+$/,"");
      if (!origin) throw new Error("public_origin_required");
      const publicImageUrl = origin + "/media/" + objectKey;

      let payload = {};
      try { payload = JSON.parse(String(row.payload_json || "{}")); } catch {}
      payload.imageUrl = publicImageUrl;
      payload.smokeTest = "v2";
      payload.smokePreparedAt = startedAt;

      await env.DB.prepare(
        `UPDATE post_ledger
         SET scheduled_for=?2,
             approval_status='approved',
             status='ready',
             error='',
             image_object_key=?3,
             payload_json=?4,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=?1`
      ).bind(String(row.id), startedAt, objectKey, JSON.stringify(payload)).run();

      const result = await runAgentCoreCycle(env, clientId, {
        trigger: "forced-post-smoke-test-v2",
        agent: "publisher"
      });

      const after = await env.DB.prepare(
        `SELECT id,status,approval_status,scheduled_for,media_id,error
         FROM post_ledger WHERE id=?1 LIMIT 1`
      ).bind(String(row.id)).first();

      await save({
        status: String(after?.status || "unknown"),
        postId: String(after?.id || row.id || ""),
        mediaId: String(after?.media_id || ""),
        error: String(after?.error || ""),
        metaStatus: "valid",
        mediaPrepared: true,
        publisher: result?.agents?.publisher || null
      });
    } catch (error) {
      await save({
        status: "failed",
        metaStatus: "unknown",
        error: String(error instanceof Error ? error.message : error).slice(0,900)
      });
    }
  }
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
    postSmokeTests: await readCorePostSmokeStatus(env)
  }, d1 ? 200 : 503);
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
      await runCorePostSmokeTestOnce(env, at);
      await processDueJobs(env, at);
      await processQueuedVideoImports(env, 1);
      await processQueuedVideoJobs(env, 1);
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
      const rate = await loginRateLimitStatus(env, request, "login");
      if (!rate.allowed) {
        return json(
          { ok: false, error: "too_many_login_attempts", retryAfter: rate.retryAfter },
          429,
          { "retry-after": String(rate.retryAfter) }
        );
      }

      const body = await request.json().catch(() => ({}));
      const username = String(body?.username || "").trim();
      const password = String(body?.password || "");

      if (!username || !password) {
        await recordLoginFailure(env, request, "login");
        return json({ ok: false, error: "username_and_password_required" }, 400);
      }

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
