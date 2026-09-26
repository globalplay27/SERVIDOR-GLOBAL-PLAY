import {
  authenticatePortalUser,
  createPortalSession,
  resolvePortalSession,
  deletePortalSession,
  portalSessionCookie,
  clearPortalSessionCookie
} from "./auth.js";
import { getClient, upsertClient, portalClientView } from "./clients.js";
import { tokenUsageToday } from "./openai.js";
import { startInstagramOAuth, handleInstagramOAuthCallback } from "./instagram.js";
import { searchTrailers } from "./trailers.js";
import { AGENT_CORE_MODULES, normalizeAgentCoreConfig, agentCoreState, agentExecutions, saveAgentCoreConfig } from "./agent-core.js";
import { leadsForClient, leadHunterSummary } from "./leads.js";
import { leadHunterView, saveLeadHunterConfig, runLeadHunter, discardLead } from "./lead-hunter.js";
import { createVideoFolder, renameVideoFolder, deleteVideoFolder, patchVideoJob, deleteVideoJob, setClipApproval, adjustClip, selectClip, scheduleClip, bulkScheduleClips } from "./video-library.js";
import { proxyRailwayVideoRequest, createVideoUploadTicket } from "./railway-video-bridge.js";
import { createR2VideoUpload, uploadR2VideoPart, completeR2VideoUpload, abortR2VideoUpload, importR2VideoFromUrl, createR2PublicTrailerImportJob, processR2PublicTrailerImportJob } from "./r2-video-upload.js";
import { decidePost, requestPostRevision, saveOwnPostContent, publishPostNow } from "./posts.js";

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

async function sessionClient(request, env) {
  const session = await resolvePortalSession(env, request);
  if (!session?.clientId) return { session: null, client: null };
  const client = await getClient(env, session.clientId);
  return { session, client };
}

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function profileLogoExtension(contentType) {
  const type = String(contentType || "").toLowerCase().split(";")[0].trim();
  if (type === "image/png") return "png";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  return "";
}

function profileLogoKeyBelongsToClient(key, clientId) {
  return String(key || "").startsWith("branding/" + String(clientId) + "/");
}

async function storeProfileLogo(env, clientId, request) {
  if (!env.MEDIA) throw new Error("r2_unavailable");

  const contentType = String(request.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
  const extension = profileLogoExtension(contentType);
  if (!extension) throw new Error("invalid_logo_type");

  const declaredSize = Number(request.headers.get("content-length") || 0);
  const maxBytes = 6 * 1024 * 1024;
  if (declaredSize > maxBytes) throw new Error("logo_too_large");

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) throw new Error("logo_empty");
  if (bytes.byteLength > maxBytes) throw new Error("logo_too_large");

  const key = "branding/" + String(clientId) + "/" + crypto.randomUUID() + "." + extension;
  await env.MEDIA.put(key, bytes, {
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable"
    },
    customMetadata: {
      clientId: String(clientId),
      kind: "profile-logo"
    }
  });

  return {
    objectKey: key,
    url: "/media/" + key
  };
}

async function deleteProfileLogoIfOwned(env, clientId, key) {
  if (!env.MEDIA || !profileLogoKeyBelongsToClient(key, clientId)) return;
  await env.MEDIA.delete(String(key)).catch(() => {});
}

function sanitizedAgentProfilePatch(body) {
  const source = body && typeof body === "object" ? body : {};
  const allowed = [
    "agentName", "brandName", "niche", "audience", "goal", "region",
    "offer", "services", "differentials", "tone", "cta", "avoidTopics",
    "notes", "whatsapp", "website", "primaryColor", "secondaryColor",
    "logoObjectKey", "logoUrl"
  ];
  const patch = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, key)) patch[key] = source[key];
  }
  return patch;
}

async function connectionSummary(env, clientId) {
  const result = await env.DB.prepare(
    `SELECT provider, payload_json, connected_at, updated_at
     FROM connections WHERE client_id = ?1 ORDER BY provider`
  ).bind(String(clientId)).all();

  const out = {};
  for (const row of result?.results || []) {
    const payload = parseJson(row.payload_json, {});
    out[String(row.provider)] = {
      connected: true,
      direct: true,
      source: "cloudflare",
      label: payload?.label || payload?.login || payload?.name || "",
      connectedAt: row.connected_at || row.updated_at || null
    };
  }

  if (!out.openai) {
    out.openai = {
      connected: true,
      direct: false,
      source: "managed-secret",
      label: clientId === String(env.RAGNAR_CLIENT_ID || "ragnar-one")
        ? "OpenAI exclusiva Ragnar"
        : "OpenAI compartilhada NEXUS",
      connectedAt: null
    };
  }
  return out;
}

async function listSupport(env, clientId) {
  const result = await env.DB.prepare(
    `SELECT id, client_id, status, subject, payload_json, created_at, updated_at
     FROM support_tickets WHERE client_id = ?1 ORDER BY created_at DESC LIMIT 100`
  ).bind(String(clientId)).all();
  return (result?.results || []).map(row => {
    const payload = parseJson(row.payload_json, {});
    return {
      id: row.id,
      clientId: row.client_id,
      category: payload.category || "",
      subject: row.subject || "",
      message: payload.message || "",
      status: row.status || "open",
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || row.created_at || null
    };
  });
}

async function listPosts(env, clientId) {
  const result = await env.DB.prepare(
    `SELECT id, client_id, scheduled_for, scheduled_hour, status, approval_status,
            media_id, caption, image_object_key, error, cost_usd, payload_json,
            created_at, updated_at
     FROM post_ledger WHERE client_id = ?1
     ORDER BY COALESCE(scheduled_for, created_at) DESC LIMIT 250`
  ).bind(String(clientId)).all();
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

async function listVideoFolders(env, clientId) {
  const result = await env.DB.prepare(
    `SELECT id, name, created_at, updated_at
     FROM video_folders WHERE client_id = ?1 ORDER BY name COLLATE NOCASE`
  ).bind(String(clientId)).all();
  return [
    { id: "default", name: "Meus vídeos", system: true },
    ...(result?.results || []).map(row => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    }))
  ];
}

async function listVideos(env, clientId) {
  const result = await env.DB.prepare(
    `SELECT id, client_id, source_object_key, status, settings_json, result_json,
            created_at, updated_at
     FROM video_jobs WHERE client_id = ?1 ORDER BY created_at DESC LIMIT 250`
  ).bind(String(clientId)).all();

  const jobs = [];
  for (const row of result?.results || []) {
    const settings = parseJson(row.settings_json, {});
    const resultJson = parseJson(row.result_json, {});
    const clipsResult = await env.DB.prepare(
      `SELECT id, source_object_key, output_object_key, status, approval_status,
              publish_status, scheduled_for, settings_json, result_json, created_at, updated_at
       FROM video_clips WHERE job_id = ?1 AND client_id = ?2 ORDER BY created_at`
    ).bind(String(row.id), String(clientId)).all();

    jobs.push({
      id: row.id,
      clientId: row.client_id,
      sourceObjectKey: row.source_object_key || "",
      status: row.status || "pending",
      folderId: settings.folderId || "default",
      contentTitle: settings.contentTitle || "",
      goal: settings.goal || "viral",
      clipDuration: Number(settings.clipDuration || settings.duration || 30),
      requestedClips: Number(settings.requestedClips || settings.clips || 3),
      outputFormat: settings.outputFormat || "reel",
      autoSubtitles: settings.autoSubtitles !== false,
      message: resultJson.message || "",
      error: resultJson.error || "",
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      clips: (clipsResult?.results || []).map(clip => ({
        id: clip.id,
        sourceObjectKey: clip.source_object_key || "",
        outputObjectKey: clip.output_object_key || "",
        status: clip.status || "pending",
        approvalStatus: clip.approval_status || "pending",
        publishStatus: clip.publish_status || "draft",
        scheduledFor: clip.scheduled_for || null,
        ...parseJson(clip.settings_json, {}),
        ...parseJson(clip.result_json, {}),
        createdAt: clip.created_at || null,
        updatedAt: clip.updated_at || null
      }))
    });
  }
  return jobs;
}

async function patchClientConfig(env, client, patch) {
  const config = {
    ...(client.config && typeof client.config === "object" ? client.config : {}),
    ...(patch && typeof patch === "object" ? patch : {})
  };
  return upsertClient(env, { ...client, config });
}

export async function handlePortalApi(request, env, url, ctx = null) {
  const instagramCallback = await handleInstagramOAuthCallback(env, request, url);
  if (instagramCallback) return instagramCallback;

  if (url.pathname === "/portal-login" && request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const username = String(form?.get("username") || "").trim();
    const password = String(form?.get("password") || "");
    const clientId = await authenticatePortalUser(env, username, password);
    if (!clientId) return redirect("/portal.html?error=1");
    const client = await getClient(env, clientId);
    if (!client) return redirect("/portal.html?error=1");
    const session = await createPortalSession(env, clientId, {
      persistent: true,
      remembered: String(form?.get("remember") || "") === "1",
      source: "cloudflare"
    });
    return redirect("/portal.html?auth=1", {
      "set-cookie": portalSessionCookie(session.token)
    });
  }

  if (url.pathname === "/api/portal/login" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const clientId = await authenticatePortalUser(env, body.username, body.password);
    if (!clientId) return json({ error: "unauthorized" }, 401);
    const client = await getClient(env, clientId);
    if (!client) return json({ error: "client_not_found" }, 404);
    const session = await createPortalSession(env, clientId, {
      persistent: true,
      source: "cloudflare"
    });
    return json(
      { token: session.token, client: portalClientView(client) },
      200,
      { "set-cookie": portalSessionCookie(session.token) }
    );
  }

  if (url.pathname === "/api/portal/diagnostic" && request.method === "GET") {
    let d1Ready = false;
    let clients = 0;
    let portalUsers = 0;
    try {
      const [health, clientCount, userCount] = await Promise.all([
        env.DB.prepare("SELECT 1 AS ok").first(),
        env.DB.prepare("SELECT COUNT(*) AS count FROM clients").first(),
        env.DB.prepare("SELECT COUNT(*) AS count FROM portal_users").first()
      ]);
      d1Ready = Number(health?.ok || 0) === 1;
      clients = Number(clientCount?.count || 0);
      portalUsers = Number(userCount?.count || 0);
    } catch {}
    let fallbackClientExists = false;
    const fallbackClientId = String(env.CLIENT_PORTAL_CLIENT_ID || "").trim();
    if (fallbackClientId) {
      try {
        fallbackClientExists = Boolean(
          await env.DB.prepare("SELECT id FROM clients WHERE id = ?1 LIMIT 1").bind(fallbackClientId).first()
        );
      } catch {}
    }
    return json({
      ok: d1Ready,
      runtime: "cloudflare-workers",
      service: "Servidor Nexus",
      clients,
      portalUsers,
      portalClientIdConfigured: Boolean(env.CLIENT_PORTAL_CLIENT_ID),
      portalUsernameConfigured: Boolean(env.CLIENT_PORTAL_USERNAME),
      portalPasswordConfigured: Boolean(env.CLIENT_PORTAL_PASSWORD),
      fallbackPortalCredentialsConfigured: Boolean(
        env.CLIENT_PORTAL_CLIENT_ID && env.CLIENT_PORTAL_USERNAME && env.CLIENT_PORTAL_PASSWORD
      ),
      fallbackClientExists,
      nexusSecretConfigured: Boolean(env.NEXUS_SECRET_KEY)
    }, d1Ready ? 200 : 503);
  }

  if (!url.pathname.startsWith("/api/portal/")) return null;

  if (url.pathname === "/api/portal/logout" && request.method === "POST") {
    await deletePortalSession(env, request).catch(() => {});
    return json({ ok: true }, 200, { "set-cookie": clearPortalSessionCookie() });
  }

  const { session, client } = await sessionClient(request, env);
  if (!session || !client) return json({ error: "unauthorized" }, 401);

  if (url.pathname === "/api/portal/video-upload-ticket" && request.method === "POST") {
    try {
      return json({ ok: true, ...(await createVideoUploadTicket(env, client.id)) });
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : String(error)
      }, 503);
    }
  }

  if (url.pathname === "/api/portal/logo" && request.method === "POST") {
    try {
      const logo = await storeProfileLogo(env, client.id, request);
      return json({ ok: true, ...logo }, 201);
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      const status = code === "r2_unavailable" ? 503
        : code === "logo_too_large" ? 413
        : 400;
      return json({ error: code }, status);
    }
  }

  if (url.pathname === "/api/portal/video-uploads" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      return json({ ok: true, ...(await createR2VideoUpload(env, client.id, body)) }, 201);
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      const status = code === "r2_unavailable" ? 503
        : code === "video_too_large" ? 413
        : 400;
      return json({ error: code }, status);
    }
  }

  if (url.pathname === "/api/portal/video-uploads/part" && request.method === "PUT") {
    try {
      const part = await uploadR2VideoPart(env, client.id, request, {
        key: url.searchParams.get("key"),
        uploadId: url.searchParams.get("uploadId"),
        partNumber: url.searchParams.get("partNumber")
      });
      return json({ ok: true, ...part });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      const status = code === "r2_unavailable" ? 503
        : code === "video_part_too_large" ? 413
        : 400;
      return json({ error: code }, status);
    }
  }

  if (url.pathname === "/api/portal/video-uploads/complete" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      const completed = await completeR2VideoUpload(env, client.id, body);
      const jobs = await listVideos(env, client.id);
      return json({
        ok: true,
        ...completed,
        job: jobs.find(job => job.id === completed.jobId) || null
      }, 201);
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      const status = code === "r2_unavailable" ? 503
        : code === "video_too_large" ? 413
        : 400;
      return json({ error: code }, status);
    }
  }

  if (url.pathname === "/api/portal/video-uploads" && request.method === "DELETE") {
    try {
      return json({
        ok: true,
        ...(await abortR2VideoUpload(
          env,
          client.id,
          url.searchParams.get("key"),
          url.searchParams.get("uploadId")
        ))
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      return json({ error: code }, code === "r2_unavailable" ? 503 : 400);
    }
  }

  if (
    (url.pathname === "/api/portal/videos/import" || url.pathname === "/api/portal/videos/import-trailer")
    && request.method === "POST"
  ) {
    const body = await request.json().catch(() => ({}));
    try {
      const isTrailerImport = url.pathname.endsWith("/import-trailer");
      const imported = isTrailerImport
        ? await createR2PublicTrailerImportJob(env, client.id, body)
        : await importR2VideoFromUrl(env, client.id, body);

      if (isTrailerImport) {
        if (ctx?.waitUntil) {
          ctx.waitUntil(processR2PublicTrailerImportJob(env, client.id, imported.jobId).catch(() => {}));
        } else {
          processR2PublicTrailerImportJob(env, client.id, imported.jobId).catch(() => {});
        }
      }

      const jobs = await listVideos(env, client.id);
      return json({
        ok: true,
        ...imported,
        job: jobs.find(job => job.id === imported.jobId) || null
      }, isTrailerImport ? 202 : 201);
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      const status = code === "r2_unavailable" ? 503
        : code === "video_too_large" ? 413
        : code.startsWith("video_source_http_") ? 502
        : code.startsWith("invidious_resolve_failed") ? 502
        : 400;
      return json({ error: code }, status);
    }
  }

  if (url.pathname === "/api/portal/trailers/search" && request.method === "GET") {
    const query = String(url.searchParams.get("q") || "").trim();
    const type = String(url.searchParams.get("type") || "movie") === "series" ? "series" : "movie";
    if (!query) return json({ error: "query_required" }, 400);

    const cacheUrl = new URL(request.url);
    cacheUrl.pathname = "/__cache/trailer-catalog";
    cacheUrl.search = "";
    cacheUrl.searchParams.set("client", String(client.id));
    cacheUrl.searchParams.set("type", type);
    cacheUrl.searchParams.set("q", query.toLowerCase());
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

    try {
      const cached = await caches.default.match(cacheKey);
      if (cached) {
        const body = await cached.text();
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "private, max-age=0",
            "x-nexus-search-cache": "hit"
          }
        });
      }
    } catch {}

    try {
      const payload = await searchTrailers(env, client.id, query, type);
      const response = json(payload);
      try {
        const cacheResponse = new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=21600"
          }
        });
        if (ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, cacheResponse));
      } catch {}
      return response;
    } catch (error) {
      return json({
        error: "trailer_search_failed",
        message: error instanceof Error ? error.message : String(error)
      }, 502);
    }
  }

  const videoBridgeResponse = await proxyRailwayVideoRequest(request, env, url, client.id);
  if (videoBridgeResponse) return videoBridgeResponse;

  if (url.pathname === "/api/portal/session" && request.method === "GET") {
    return json(
      portalClientView(client),
      200,
      { "set-cookie": portalSessionCookie(session.token) }
    );
  }

  if (url.pathname === "/api/portal/live-status" && request.method === "GET") {
    return json({
      ok: true,
      clientId: client.id,
      runtime: "cloudflare-workers",
      service: "Servidor Nexus",
      database: "d1",
      media: env.MEDIA ? "r2" : "unavailable",
      migrationMode: true
    });
  }

  if (url.pathname === "/api/portal/token-usage" && request.method === "GET") {
    const usage = await tokenUsageToday(env, client.id);
    return json({ ok: true, ...usage, usage });
  }

  if (url.pathname === "/api/portal/provider-usage" && request.method === "GET") {
    const usage = await tokenUsageToday(env, client.id);
    return json({
      ok: true,
      openai: {
        ...usage,
        connected: usage.connected,
        costAvailable: true,
        cost31dUsd: usage.estimatedCostUsd,
        costIsEstimate: true
      },
      cloudflare: {
        runtime: "workers-ai",
        connected: Boolean(env.AI),
        strategy: String(env.NEXUS_AI_PROVIDER || "workers-first")
      }
    });
  }

  if (url.pathname === "/api/portal/connections" && request.method === "GET") {
    return json({ ok: true, connections: await connectionSummary(env, client.id) });
  }

  if (url.pathname === "/api/portal/instagram/test" && request.method === "GET") {
    const appConfigured = Boolean(String(env.INSTAGRAM_APP_ID || "").trim() && String(env.INSTAGRAM_APP_SECRET || "").trim());
    const payload = JSON.stringify({
      type: "nexus-instagram-oauth-test",
      ok: true,
      appConfigured
    }).replace(/</g, "\\u003c");
    return new Response(
      `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
      <title>NEXUS AI · Teste Instagram</title>
      <body style="margin:0;background:#050807;color:#eef8ff;font-family:system-ui;display:grid;place-items:center;min-height:100vh">
      <main style="max-width:520px;padding:30px;border:1px solid #173549;border-radius:20px;background:#071018;text-align:center">
      <h1 style="color:#5dd3ff">Fluxo do painel OK</h1>
      <p style="color:#aab9c2;line-height:1.6">O painel do cliente, a sessão e o retorno do NEXUS estão funcionando.</p>
      <p style="color:#aab9c2;line-height:1.6">Para conectar uma conta de verdade e publicar automaticamente, a conta do Instagram precisa ser Profissional (Comercial ou Criador).</p>
      </main>
      <script>
      try{if(window.opener)window.opener.postMessage(${payload},"*");}catch(e){}
      setTimeout(()=>window.close(),1800);
      <\/script></body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
    );
  }

  if (url.pathname === "/api/portal/instagram/start" && request.method === "GET") {
    try {
      return json({ ok: true, ...(await startInstagramOAuth(env, request, client.id)) });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code === "instagram_nexus_not_configured") {
        return json({
          error: code,
          message: "O administrador ainda precisa ativar a conexão central do Instagram."
        }, 503);
      }
      return json({ error: code || "instagram_oauth_start_failed" }, 400);
    }
  }


  if (url.pathname === "/api/portal/support") {
    if (request.method === "GET") {
      return json({ ok: true, tickets: await listSupport(env, client.id) });
    }
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const id = crypto.randomUUID();
      const subject = String(body.subject || "Suporte").trim().slice(0, 180);
      const payload = {
        category: String(body.category || "general").slice(0, 80),
        message: String(body.message || "").slice(0, 5000)
      };
      await env.DB.prepare(
        `INSERT INTO support_tickets(id, client_id, status, subject, payload_json, created_at, updated_at)
         VALUES(?1, ?2, 'open', ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(id, client.id, subject, JSON.stringify(payload)).run();
      return json({ ok: true, ticket: (await listSupport(env, client.id))[0] }, 201);
    }
  }

  if (url.pathname === "/api/portal/posts" && request.method === "GET") {
    return json({ ok: true, posts: await listPosts(env, client.id) });
  }

  const postDecisionMatch = url.pathname.match(/^\/api\/portal\/posts\/([^/]+)\/decision$/);
  if (postDecisionMatch && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      return json(await decidePost(env, client, decodeURIComponent(postDecisionMatch[1]), body.decision));
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      return json({ error: code }, code === "not_found" ? 404 : 400);
    }
  }

  const postRevisionMatch = url.pathname.match(/^\/api\/portal\/posts\/([^/]+)\/revision$/);
  if (postRevisionMatch && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      return json(await requestPostRevision(env, client, decodeURIComponent(postRevisionMatch[1]), body.instructions));
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      return json({ error: code, message: code === "revision_instructions_required" ? "Explique o que precisa ser corrigido." : "Não foi possível pedir a correção." }, code === "post_not_found" ? 404 : 400);
    }
  }

  const postContentMatch = url.pathname.match(/^\/api\/portal\/posts\/([^/]+)\/content$/);
  if (postContentMatch && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      return json(await saveOwnPostContent(env, client, decodeURIComponent(postContentMatch[1]), body, url.origin));
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      const status = code === "post_not_found" ? 404
        : code === "r2_unavailable" ? 503
        : code === "image_too_large" ? 413
        : 400;
      return json({ error: code, message: code === "r2_unavailable" ? "O armazenamento de mídia do NEXUS ainda não está disponível." : code }, status);
    }
  }

  const postManualMatch = url.pathname.match(/^\/api\/portal\/posts\/([^/]+)\/manual$/);
  if (postManualMatch && request.method === "POST") {
    try {
      return json(await publishPostNow(env, client, decodeURIComponent(postManualMatch[1])));
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      return json({
        error: code,
        message: error?.messageForUser || code,
        post: error?.post || null
      }, Number(error?.status || (code === "post_not_found" ? 404 : 400)));
    }
  }


  if (url.pathname === "/api/portal/video-folders" && request.method === "GET") {
    return json({ ok: true, folders: await listVideoFolders(env, client.id) });
  }
  if (url.pathname === "/api/portal/video-folders" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      return json({ ok: true, ...(await createVideoFolder(env, client.id, body.name)) }, 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  const folderMatch = url.pathname.match(/^\/api\/portal\/video-folders\/([^/]+)$/);
  if (folderMatch && request.method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    try {
      return json({ ok: true, ...(await renameVideoFolder(env, client.id, decodeURIComponent(folderMatch[1]), body.name)) });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      return json({ error: code }, code === "folder_not_found" ? 404 : 400);
    }
  }

  if (folderMatch && request.method === "DELETE") {
    try {
      return json({ ok: true, ...(await deleteVideoFolder(env, client.id, decodeURIComponent(folderMatch[1]))) });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      return json({ error: code }, code === "folder_not_found" ? 404 : 400);
    }
  }

  if (url.pathname === "/api/portal/videos" && request.method === "GET") {
    return json({
      ok: true,
      jobs: await listVideos(env, client.id),
      folders: await listVideoFolders(env, client.id)
    });
  }
  if (url.pathname === "/api/portal/videos/bulk-schedule" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      return json({ ok: true, ...(await bulkScheduleClips(env, client.id, body.items || [])) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  const videoManageMatch = url.pathname.match(/^\/api\/portal\/videos\/([^/]+)$/);
  if (videoManageMatch && request.method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    try {
      await patchVideoJob(env, client.id, decodeURIComponent(videoManageMatch[1]), body);
      return json({ ok: true, jobs: await listVideos(env, client.id) });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      return json({ error: code }, code === "video_not_found" ? 404 : 400);
    }
  }

  if (videoManageMatch && request.method === "DELETE") {
    try {
      const result = await deleteVideoJob(env, client.id, decodeURIComponent(videoManageMatch[1]));
      return json({ ok: true, ...result });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      return json({ error: code }, code === "video_not_found" ? 404 : 400);
    }
  }

  const clipApprovalMatch = url.pathname.match(/^\/api\/portal\/videos\/([^/]+)\/clips\/([^/]+)\/approval$/);
  if (clipApprovalMatch && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      const clip = await setClipApproval(env, client.id, decodeURIComponent(clipApprovalMatch[1]), decodeURIComponent(clipApprovalMatch[2]), body.status);
      return json({ ok: true, clip });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  const clipAdjustMatch = url.pathname.match(/^\/api\/portal\/videos\/([^/]+)\/clips\/([^/]+)\/adjust$/);
  if (clipAdjustMatch && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      const clip = await adjustClip(env, client.id, decodeURIComponent(clipAdjustMatch[1]), decodeURIComponent(clipAdjustMatch[2]), body);
      return json({ ok: true, clip });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  const clipSelectMatch = url.pathname.match(/^\/api\/portal\/videos\/([^/]+)\/clips\/([^/]+)\/select$/);
  if (clipSelectMatch && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      const clip = await selectClip(env, client.id, decodeURIComponent(clipSelectMatch[1]), decodeURIComponent(clipSelectMatch[2]), body.selected);
      return json({ ok: true, clip });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  const clipScheduleMatch = url.pathname.match(/^\/api\/portal\/videos\/([^/]+)\/clips\/([^/]+)\/schedule$/);
  if (clipScheduleMatch && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      const clip = await scheduleClip(env, client.id, decodeURIComponent(clipScheduleMatch[1]), decodeURIComponent(clipScheduleMatch[2]), body.scheduledFor, body.caption || "");
      return json({ ok: true, clip });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  if (url.pathname === "/api/portal/onboarding" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const next = {
      ...(client.config?.onboarding && typeof client.config.onboarding === "object"
        ? client.config.onboarding
        : {}),
      ...(body && typeof body === "object" ? body : {})
    };
    const updated = await patchClientConfig(env, client, { onboarding: next });
    return json({ ok: true, client: portalClientView(updated) });
  }

  if (url.pathname === "/api/portal/agent-profile" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const current = client.config?.agentProfile && typeof client.config.agentProfile === "object"
      ? client.config.agentProfile
      : {};
    const patch = sanitizedAgentProfilePatch(body);
    const next = { ...current, ...patch };

    if (body?.removeLogo === true) {
      await deleteProfileLogoIfOwned(env, client.id, current.logoObjectKey);
      delete next.logoObjectKey;
      delete next.logoUrl;
    } else if (
      patch.logoObjectKey
      && patch.logoObjectKey !== current.logoObjectKey
      && profileLogoKeyBelongsToClient(patch.logoObjectKey, client.id)
    ) {
      await deleteProfileLogoIfOwned(env, client.id, current.logoObjectKey);
    }

    // Never persist base64/data URLs in D1. Logo bytes live in R2 only.
    delete next.logoDataUrl;
    next.submittedAt = new Date().toISOString();

    const updated = await patchClientConfig(env, client, { agentProfile: next });
    return json({ ok: true, client: portalClientView(updated) });
  }

  if (url.pathname === "/api/portal/agent-core" && request.method === "GET") {
    const [state, executions] = await Promise.all([
      agentCoreState(env, client.id),
      agentExecutions(env, client.id, 60)
    ]);
    const pendingRow = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM post_ledger WHERE client_id = ?1 AND approval_status = 'pending'"
    ).bind(client.id).first();
    const correctionRow = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM post_ledger WHERE client_id = ?1 AND approval_status = 'correction_requested'"
    ).bind(client.id).first();
    return json({
      ok: true,
      modules: AGENT_CORE_MODULES,
      config: normalizeAgentCoreConfig(client),
      state,
      executions,
      pendingApproval: Number(pendingRow?.count || 0),
      correctionRequested: Number(correctionRow?.count || 0)
    });
  }

  if (url.pathname === "/api/portal/agent-core" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      const config = await saveAgentCoreConfig(env, client.id, body);
      const updated = await getClient(env, client.id);
      return json({ ok: true, config, client: portalClientView(updated) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  if (url.pathname === "/api/portal/lead-hunter" && request.method === "GET") {
    return json(await leadHunterView(env, client));
  }

  if (url.pathname === "/api/portal/lead-hunter/config" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const config = await saveLeadHunterConfig(env, client, body);
    const summary = await leadHunterSummary(env, client.id);
    return json({ ok: true, config, summary });
  }

  if (url.pathname === "/api/portal/lead-hunter/run" && request.method === "POST") {
    try {
      return json(await runLeadHunter(env, client.id, { trigger: "manual" }));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  const discardMatch = url.pathname.match(/^\/api\/portal\/lead-hunter\/leads\/([^/]+)\/discard$/);
  if (discardMatch && request.method === "POST") {
    try {
      const view = await discardLead(env, client.id, decodeURIComponent(discardMatch[1]));
      return json({ ok: true, view });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }
  if (url.pathname === "/api/portal/leads" && request.method === "GET") {
    const [summary, leads] = await Promise.all([
      leadHunterSummary(env, client.id),
      leadsForClient(env, client.id, 200)
    ]);
    return json({ ok: true, summary, leads, source: "cloudflare-d1" });
  }

  if (
    url.pathname === "/api/portal/connect/openai"
    && (request.method === "GET" || request.method === "POST")
  ) {
    return json({
      ok: true,
      managed: true,
      source: client.id === String(env.RAGNAR_CLIENT_ID || "ragnar-one")
        ? "ragnar-exclusive"
        : "shared"
    });
  }

  return json({
    error: "not_migrated_yet",
    runtime: "cloudflare-workers",
    path: url.pathname
  }, 501);
}
