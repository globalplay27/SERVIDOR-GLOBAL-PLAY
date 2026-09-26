export class YoutubeDownloader {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch() {
    return new Response(JSON.stringify({
      ok: false,
      error: "legacy_youtube_downloader_disabled",
      service: "Servidor Nexus"
    }), {
      status: 410,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}

import { openAIKeyStatus } from "./openai-routing.js";
import { openAIResponses, tokenUsageToday } from "./openai.js";
import { getState, putState, deleteState } from "./storage.js";
import { handlePortalApi } from "./portal.js";
import { handleMaster } from "./master.js";
import { getClient } from "./clients.js";
import { publishPostNow } from "./posts.js";
import { runSchedulerTick } from "./scheduler.js";
import { processDueJobs } from "./executor.js";
import { masterCredentialsValid, createMasterSession, authenticatePortalUser, createPortalSession, masterSessionCookie, portalSessionCookie } from "./auth.js";

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

async function brandingMedia(env, url) {
  if (!env.MEDIA) return json({ error: "r2_unavailable" }, 503);

  let key = "";
  try {
    key = decodeURIComponent(url.pathname.slice("/media/".length));
  } catch {
    return json({ error: "invalid_media_path" }, 400);
  }

  const publicMedia = key.startsWith("branding/") || key.startsWith("posts/");
  if (!publicMedia || key.includes("..") || key.includes("\\")) {
    return json({ error: "not_found" }, 404);
  }

  const object = await env.MEDIA.get(key);
  if (!object) return json({ error: "not_found" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { status: 200, headers });
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
    migrationMode: true,
    database: d1 ? "d1-ready" : "d1-unavailable",
    media: env.MEDIA ? "r2-bound" : "r2-unavailable",
    assets: env.ASSETS ? "bound" : "unavailable",
    openai: {
      shared: openAIKeyStatus(env, "shared-client").configured,
      ragnar: openAIKeyStatus(env, env.RAGNAR_CLIENT_ID || "ragnar-one").configured
    }
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
      await processDueJobs(env, at);
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return redirect("/login");
    }

    if (url.pathname.startsWith("/media/") && request.method === "GET") {
      return brandingMedia(env, url);
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

      if (await masterCredentialsValid(env, username, password)) {
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

      return json({ ok: false, error: "invalid_credentials" }, 401);
    }


    const masterResponse = await handleMaster(request, env, url);
    if (masterResponse) return masterResponse;

    const portalResponse = await handlePortalApi(request, env, url);
    if (portalResponse) return portalResponse;

    if (url.pathname === "/api/internal/work-image-test" && request.method === "POST") {
      if (url.searchParams.get("k") !== "98f21e484c77cc043dde0c662327a1c3a2f26c6d4a2a35d7") return json({ error: "not_found" }, 404);

      const clientId = String(url.searchParams.get("clientId") || "");
      const allowed = new Set(["ragnar-one", "globalplay-streaming"]);
      if (!allowed.has(clientId)) return json({ error: "invalid_target" }, 400);
      if (!env.MEDIA) return json({ error: "r2_unavailable" }, 503);

      const contentType = String(request.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
      if (!["image/png","image/jpeg","image/webp"].includes(contentType)) {
        return json({ error: "invalid_image_type" }, 400);
      }

      const bytes = await request.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) {
        return json({ error: "invalid_image_size" }, 400);
      }

      const client = await getClient(env, clientId);
      if (!client) return json({ error: "client_not_found" }, 404);

      const postId = "work-test:" + clientId + ":" + crypto.randomUUID();
      const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
      const objectKey = "posts/" + clientId + "/" + postId + "/work-image." + ext;
      await env.MEDIA.put(objectKey, bytes, {
        httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
        customMetadata: { clientId, postId, kind: "work-test-image" }
      });

      const origin = new URL(request.url).origin;
      const imageUrl = origin + "/media/" + objectKey;
      const caption = clientId === "ragnar-one"
        ? "Uma nova saga começa no seu sofá. ⚔️\n\nEntretenimento para curtir no seu ritmo.\n\nComente QUERO para saber mais.\n\n#RagnarOne #Streaming #FilmesESeries #Entretenimento"
        : "Seu próximo filme favorito pode estar aqui. 🍿\n\nTransforme sua noite em cinema e aproveite seu entretenimento onde quiser.\n\nComente QUERO para saber mais.\n\n#GlobalPlay #Streaming #FilmesESeries #Entretenimento";

      const payload = JSON.stringify({
        imageUrl,
        source: "work-test-20260926",
        title: clientId === "ragnar-one" ? "Uma nova saga começa no seu sofá" : "Seu próximo filme favorito está aqui",
        testExtraordinary: true
      });

      await env.DB.prepare(
        `INSERT INTO post_ledger(
          id, client_id, scheduled_for, scheduled_hour, status, approval_status,
          media_id, caption, image_object_key, error, cost_usd, payload_json,
          created_at, updated_at
        ) VALUES(?1, ?2, NULL, '', 'ready', 'approved', '', ?3, ?4, '', 0, ?5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(postId, clientId, caption, objectKey, payload).run();

      try {
        const result = await publishPostNow(env, client, postId);
        return json({ ok: true, clientId, postId, imageUrl, permalink: result.permalink || "", post: result.post });
      } catch (error) {
        return json({
          ok: false,
          clientId,
          postId,
          imageUrl,
          error: error instanceof Error ? error.message : String(error),
          message: error?.messageForUser || null,
          post: error?.post || null
        }, Number(error?.status || 400));
      }
    }

    if (url.pathname === "/api/internal/test-post-control" && request.method === "POST") {
      const expected = String(env.NEXUS_TEST_PUBLISH_KEY || "");
      const provided = String(request.headers.get("authorization") || "");
      if (!expected || provided !== "Bearer " + expected) {
        return json({ error: "unauthorized" }, 401);
      }

      const body = await request.json().catch(() => ({}));
      const action = String(body.action || "list");
      const allowedClientIds = new Set(["ragnar-one", "globalplay-streaming"]);

      if (action === "list") {
        const result = {};
        for (const clientId of allowedClientIds) {
          const rows = await env.DB.prepare(
            `SELECT id, client_id, status, approval_status, caption, image_object_key, payload_json, created_at, updated_at
             FROM post_ledger
             WHERE client_id = ?1
               AND status != 'published'
             ORDER BY updated_at DESC, created_at DESC
             LIMIT 10`
          ).bind(clientId).all();

          result[clientId] = (rows?.results || []).map(row => {
            let payload = {};
            try { payload = JSON.parse(String(row.payload_json || "{}")); } catch {}
            return {
              id: row.id,
              clientId: row.client_id,
              status: row.status,
              approvalStatus: row.approval_status,
              caption: row.caption,
              imageObjectKey: row.image_object_key,
              imageUrl: payload.imageUrl || payload.publicImageUrl || "",
              source: payload.source || "",
              createdAt: row.created_at,
              updatedAt: row.updated_at
            };
          });
        }
        return json({ ok: true, result });
      }

      if (action === "publish") {
        const clientId = String(body.clientId || "");
        const postId = String(body.postId || "");
        if (!allowedClientIds.has(clientId) || !postId) {
          return json({ error: "invalid_target" }, 400);
        }

        const client = await getClient(env, clientId);
        if (!client) return json({ error: "client_not_found" }, 404);

        try {
          return json(await publishPostNow(env, client, postId));
        } catch (error) {
          return json({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            message: error?.messageForUser || null,
            post: error?.post || null
          }, Number(error?.status || 400));
        }
      }

      return json({ error: "invalid_action" }, 400);
    }

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
      migrationMode: true,
      message: "Cloudflare migration runtime is online. Legacy Railway remains untouched until cutover."
    });
  }
};
