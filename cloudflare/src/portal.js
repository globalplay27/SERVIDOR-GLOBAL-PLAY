import { resolveInstagramCredentials } from "./instagram-credentials.js";
import {
  authenticatePortalUser,
  createPortalSession,
  resolvePortalSession,
  deletePortalSession,
  portalSessionCookie,
  clearPortalSessionCookie,
  loginRateLimitStatus,
  recordLoginFailure,
  clearLoginFailures
} from "./auth.js";
import { getClient, portalClientView } from "./clients.js";
import { tokenUsageToday } from "./openai.js";
import { startInstagramOAuth, handleInstagramOAuthCallback } from "./instagram.js";
import { AGENT_CORE_MODULES, normalizeAgentCoreConfig, agentCoreState, agentExecutions, saveAgentCoreConfig } from "./agent-core.js";
import { leadsForClient, leadHunterSummary } from "./leads.js";
import { leadHunterView, saveLeadHunterConfig, runLeadHunter, discardLead } from "./lead-hunter.js";
import { decidePost, requestPostRevision, cancelPost, saveOwnPostContent, publishPostNow, useLibraryImageForPost } from "./posts.js";
import { addDirective, createCampaign, masterWorkspace } from "./master-workspace.js";
import { startGitHubVideoRender } from "./github-video-render.js";

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

async function connectionSummary(env, clientId) {
  const connection = await resolveInstagramCredentials(env, clientId);
  const out = {};

  if (connection?.connected) {
    out.instagram = {
      connected: true,
      direct: true,
      source: connection.source || "nexus",
      label: connection.label || connection.username || "Instagram conectado",
      username: connection.username || "",
      accountType: connection.accountType || "",
      scopes: Array.isArray(connection.scopes) ? connection.scopes : [],
      expiresAt: connection.expiresAt || null,
      expired: Boolean(connection.expired),
      connectedAt: connection.connectedAt || null
    };
  } else {
    out.instagram = {
      connected: false,
      direct: true,
      source: connection?.source || "none",
      label: "Instagram",
      username: "",
      accountType: "",
      scopes: [],
      expiresAt: connection?.expiresAt || null,
      expired: Boolean(connection?.expired),
      connectedAt: connection?.connectedAt || null
    };
  }

  out.ai = {
    connected: true,
    direct: false,
    source: "managed",
    label: clientId === String(env.RAGNAR_CLIENT_ID || "ragnar-one")
      ? "IA exclusiva do cliente"
      : "IA gerenciada pelo NEXUS",
    connectedAt: null
  };

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

async function listClientMedia(env, clientId, origin = "") {
  if (!env.MEDIA) return [];
  const prefix = "library/" + String(clientId) + "/";
  const result = await env.MEDIA.list({
    prefix,
    limit: 100,
    include: ["httpMetadata", "customMetadata"]
  });
  const base = String(origin || "").replace(/\/+$/, "");
  return (result?.objects || []).map(object => ({
    key: object.key,
    name: object.customMetadata?.originalName || object.key.split("/").pop() || "arquivo",
    purpose: object.customMetadata?.purpose || "reference",
    note: object.customMetadata?.note || "",
    contentType: object.httpMetadata?.contentType || "",
    size: Number(object.size || 0),
    uploadedAt: object.uploaded || null,
    url: base ? base + "/media/" + object.key : "/media/" + object.key
  })).sort((a, b) => String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || "")));
}


async function listVideoJobs(env, clientId) {
  const result = await env.DB.prepare(
    `SELECT id, client_id, source_object_key, status, settings_json, result_json, created_at, updated_at
     FROM video_jobs WHERE client_id = ?1 ORDER BY created_at DESC LIMIT 100`
  ).bind(String(clientId)).all();
  const jobs = [];
  for (const row of result?.results || []) {
    const settings = parseJson(row.settings_json, {});
    const resultJson = parseJson(row.result_json, {});
    let clips = [];
    try {
      const clipRows = await env.DB.prepare(
        `SELECT id, output_object_key, status, approval_status, publish_status, settings_json, result_json, created_at, updated_at
         FROM video_clips WHERE job_id = ?1 AND client_id = ?2 ORDER BY created_at DESC`
      ).bind(String(row.id), String(clientId)).all();
      clips = (clipRows?.results || []).map(clip => ({
        id: clip.id,
        outputObjectKey: clip.output_object_key || "",
        status: clip.status || "pending",
        approvalStatus: clip.approval_status || "pending",
        publishStatus: clip.publish_status || "draft",
        ...parseJson(clip.settings_json, {}),
        ...parseJson(clip.result_json, {}),
        createdAt: clip.created_at || null,
        updatedAt: clip.updated_at || null
      }));
    } catch {}
    jobs.push({
      id: row.id,
      clientId: row.client_id,
      sourceObjectKey: row.source_object_key || "",
      status: row.status || "pending",
      filename: settings.filename || settings.displayName || "Vídeo",
      contentTitle: settings.contentTitle || "",
      overview: settings.overview || "",
      releaseYear: settings.releaseYear || "",
      mediaType: settings.mediaType || "",
      posterUrl: settings.posterUrl || "",
      logoEnabled: settings.logoEnabled === true,
      logoObjectKey: settings.logoObjectKey || "",
      editStyle: settings.editStyle || "cinematic-card-v1",
      endText: settings.endText || "",
      endContact: settings.endContact || "",
      progress: Number(resultJson.progress || 0),
      message: resultJson.message || "",
      error: resultJson.error || "",
      clips,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    });
  }
  return jobs;
}

function mediaExtension(contentType, originalName = "") {
  const byType = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov"
  };
  if (byType[contentType]) return byType[contentType];
  const match = String(originalName || "").toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return match ? match[1] : "bin";
}

async function listPosts(env, clientId) {
  const result = await env.DB.prepare(
    `SELECT id, client_id, scheduled_for, scheduled_hour, status, approval_status,
            media_id, caption, image_object_key, error, cost_usd, payload_json,
            created_at, updated_at
     FROM post_ledger WHERE client_id = ?1
     ORDER BY updated_at DESC LIMIT 100`
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

export async function handlePortalApi(request, env, url, ctx) {
  const instagramCallback = await handleInstagramOAuthCallback(env, request, url);
  if (instagramCallback) return instagramCallback;

  if (url.pathname === "/portal-login" && request.method === "POST") {
    const rate = await loginRateLimitStatus(env, request, "login");
    if (!rate.allowed) {
      return redirect("/portal.html?error=rate-limit&retry=" + encodeURIComponent(String(rate.retryAfter)), {
        "retry-after": String(rate.retryAfter)
      });
    }

    const form = await request.formData().catch(() => null);
    const username = String(form?.get("username") || "").trim();
    const password = String(form?.get("password") || "");
    const clientId = await authenticatePortalUser(env, username, password);
    if (!clientId) {
      await recordLoginFailure(env, request, "login");
      return redirect("/portal.html?error=1");
    }
    const client = await getClient(env, clientId);
    if (!client) {
      await recordLoginFailure(env, request, "login");
      return redirect("/portal.html?error=1");
    }
    await clearLoginFailures(env, request, "login");
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
    const rate = await loginRateLimitStatus(env, request, "login");
    if (!rate.allowed) {
      return json(
        { error: "too_many_login_attempts", retryAfter: rate.retryAfter },
        429,
        { "retry-after": String(rate.retryAfter) }
      );
    }

    const body = await request.json().catch(() => ({}));
    const clientId = await authenticatePortalUser(env, body.username, body.password);
    if (!clientId) {
      await recordLoginFailure(env, request, "login");
      return json({ error: "unauthorized" }, 401);
    }
    const client = await getClient(env, clientId);
    if (!client) {
      await recordLoginFailure(env, request, "login");
      return json({ error: "client_not_found" }, 404);
    }
    await clearLoginFailures(env, request, "login");
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

  if (url.pathname === "/api/portal/session" && request.method === "GET") {
    return json(
      portalClientView(client),
      200,
      { "set-cookie": portalSessionCookie(session.token) }
    );
  }

  if (url.pathname === "/api/portal/profile" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim().slice(0, 120);
    const phone = String(body.phone || "").trim().slice(0, 40);
    const instagram = String(body.instagram || "").trim()
      .replace(/^@/, "")
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
      .replace(/\/$/, "")
      .slice(0, 120);

    if (!name) return json({ error: "name_required", message: "Informe o nome do responsável ou da empresa." }, 400);
    if (!instagram) return json({ error: "instagram_required", message: "Informe o @ do Instagram." }, 400);

    const config = client.config && typeof client.config === "object" ? client.config : {};
    const nextConfig = {
      ...config,
      contact: {
        ...(config.contact && typeof config.contact === "object" ? config.contact : {}),
        name,
        phone
      }
    };

    await env.DB.prepare(
      "UPDATE clients SET name = ?1, instagram = ?2, config_json = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = ?4"
    ).bind(name, instagram, JSON.stringify(nextConfig), client.id).run();

    const updated = await getClient(env, client.id);
    return json({ ok: true, message: "Dados da conta atualizados.", client: portalClientView(updated) });
  }

  if (url.pathname === "/api/portal/branding/logo" && request.method === "POST") {
    if (!env.MEDIA) return json({ error: "r2_unavailable", message: "O armazenamento de mídia do NEXUS não está disponível." }, 503);
    const form = await request.formData().catch(() => null);
    const file = form?.get("logo");
    if (!file || typeof file.arrayBuffer !== "function") {
      return json({ error: "logo_required", message: "Selecione uma imagem para a logo." }, 400);
    }

    const contentType = String(file.type || "").toLowerCase();
    const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
    if (!allowed.has(contentType)) {
      return json({ error: "unsupported_logo_type", message: "Use PNG, JPG ou WEBP." }, 415);
    }

    const maxBytes = 5 * 1024 * 1024;
    const bytes = await file.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > maxBytes) {
      return json({ error: "logo_too_large", message: "A logo deve ter no máximo 5 MB." }, 413);
    }

    const extension = mediaExtension(contentType, file.name || "logo");
    const key = "branding/" + String(client.id) + "/logo-" + Date.now() + "." + extension;
    await env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { clientId: String(client.id), kind: "client-logo" }
    });

    const config = client.config && typeof client.config === "object" ? client.config : {};
    const previousKey = String(config.branding?.logoKey || "");
    const nextConfig = {
      ...config,
      branding: {
        ...(config.branding && typeof config.branding === "object" ? config.branding : {}),
        logoKey: key,
        logoUpdatedAt: new Date().toISOString()
      }
    };

    await env.DB.prepare(
      "UPDATE clients SET config_json = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2"
    ).bind(JSON.stringify(nextConfig), client.id).run();

    if (previousKey && previousKey !== key && previousKey.startsWith("branding/" + String(client.id) + "/")) {
      await env.MEDIA.delete(previousKey).catch(() => {});
    }

    return json({
      ok: true,
      message: "Logo atualizada.",
      logoKey: key,
      logoUrl: url.origin + "/media/" + key
    }, 201);
  }

  if (url.pathname === "/api/portal/live-status" && request.method === "GET") {
    return json({
      ok: true,
      clientId: client.id,
      runtime: "cloudflare-workers",
      service: "Servidor Nexus",
      database: "d1",
      media: env.MEDIA ? "r2" : "unavailable",
      migrationMode: false
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


  if (url.pathname === "/api/portal/videos" && request.method === "GET") {
    return json({ ok: true, jobs: await listVideoJobs(env, client.id) });
  }

  const videoProcessMatch = url.pathname.match(/^\/api\/portal\/videos\/([^/]+)\/process$/);
  if (videoProcessMatch && request.method === "POST") {
    const jobId = decodeURIComponent(videoProcessMatch[1]);
    const body = await request.json().catch(() => ({}));
    const row = await env.DB.prepare(
      "SELECT id, settings_json FROM video_jobs WHERE id=?1 AND client_id=?2 LIMIT 1"
    ).bind(jobId, client.id).first();
    if (!row) return json({ error: "video_not_found", message: "Vídeo não encontrado." }, 404);

    const current = parseJson(row.settings_json, {});
    const branding = client.config?.branding && typeof client.config.branding === "object" ? client.config.branding : {};
    const settings = {
      ...current,
      contentTitle: String(body.title || current.contentTitle || current.displayName || "Conteúdo").trim().slice(0, 180),
      overview: String(body.overview || current.overview || "").trim().slice(0, 1800),
      releaseYear: String(body.year || current.releaseYear || "").trim().slice(0, 12),
      mediaType: String(body.mediaType || current.mediaType || "").trim().slice(0, 24),
      posterUrl: String(body.posterUrl || current.posterUrl || "").trim().slice(0, 1200),
      editStyle: "cinematic-card-v1",
      clipDuration: Math.max(6, Math.min(90, Number(body.duration || current.clipDuration || 30))),
      requestedClips: 1,
      outputFormat: "reel",
      logoEnabled: body.logoEnabled !== false && Boolean(branding.logoKey),
      logoObjectKey: body.logoEnabled !== false ? String(branding.logoKey || "") : "",
      endText: String(body.endText || current.endText || "").trim().slice(0, 120),
      endContact: String(body.endContact || current.endContact || "").trim().slice(0, 120)
    };
    await env.DB.prepare(
      "UPDATE video_jobs SET settings_json=?3, updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
    ).bind(jobId, client.id, JSON.stringify(settings)).run();

    try {
      await startGitHubVideoRender(env, client.id, jobId, settings);
      const jobs = await listVideoJobs(env, client.id);
      return json({ ok: true, job: jobs.find(item => item.id === jobId) || null }, 202);
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      return json({ error: code, message: code === "github_actions_token_missing"
        ? "O renderizador ainda não está autorizado no Worker."
        : "Não foi possível iniciar a geração do vídeo." }, 400);
    }
  }

  const clipMediaMatch = url.pathname.match(/^\/api\/portal\/videos\/([^/]+)\/clips\/([^/]+)\/media$/);
  if (clipMediaMatch && request.method === "GET") {
    const jobId = decodeURIComponent(clipMediaMatch[1]);
    const clipId = decodeURIComponent(clipMediaMatch[2]);
    const clip = await env.DB.prepare(
      "SELECT output_object_key FROM video_clips WHERE id=?1 AND job_id=?2 AND client_id=?3 LIMIT 1"
    ).bind(clipId, jobId, client.id).first();
    if (!clip?.output_object_key || !env.MEDIA) return json({ error: "clip_not_found" }, 404);
    const object = await env.MEDIA.get(String(clip.output_object_key));
    if (!object) return json({ error: "clip_not_found" }, 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("cache-control", "private, no-store");
    headers.set("content-disposition", 'attachment; filename="nexus-video.mp4"');
    if (object.size) headers.set("content-length", String(object.size));
    return new Response(object.body, { status: 200, headers });
  }

  if (url.pathname === "/api/portal/media" && request.method === "GET") {
    return json({
      ok: true,
      media: await listClientMedia(env, client.id, url.origin),
      storage: env.MEDIA ? "r2" : "unavailable"
    });
  }

  if (url.pathname === "/api/portal/media" && request.method === "POST") {
    if (!env.MEDIA) return json({ error: "r2_unavailable", message: "O armazenamento de mídia do NEXUS não está disponível." }, 503);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file.arrayBuffer !== "function") {
      return json({ error: "file_required", message: "Selecione uma imagem ou vídeo." }, 400);
    }

    const contentType = String(file.type || "").toLowerCase();
    const allowed = new Set(["image/png","image/jpeg","image/webp","video/mp4","video/webm","video/quicktime"]);
    if (!allowed.has(contentType)) {
      return json({ error: "unsupported_media_type", message: "Use PNG, JPG, WEBP, MP4, WEBM ou MOV." }, 415);
    }

    const maxBytes = 25 * 1024 * 1024;
    const size = Number(file.size || 0);
    if (!size || size > maxBytes) {
      return json({ error: "media_too_large", message: "O arquivo deve ter no máximo 25 MB." }, 413);
    }

    const purpose = String(form.get("purpose") || "reference") === "publish" ? "publish" : "reference";
    const note = String(form.get("note") || "").trim().slice(0, 800);
    const originalName = String(file.name || "midia").replace(/[\r\n]/g, " ").slice(0, 180);
    const extension = mediaExtension(contentType, originalName);
    const key = "library/" + String(client.id) + "/" + new Date().toISOString().slice(0, 10) + "/" + crypto.randomUUID() + "." + extension;
    const bytes = await file.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > maxBytes) {
      return json({ error: "media_too_large", message: "O arquivo deve ter no máximo 25 MB." }, 413);
    }

    await env.MEDIA.put(key, bytes, {
      httpMetadata: {
        contentType,
        cacheControl: "private, no-store"
      },
      customMetadata: {
        clientId: String(client.id),
        originalName,
        purpose,
        note,
        kind: purpose === "reference" ? "creative-reference" : "client-owned-media"
      }
    });

    let videoJobId = "";
    if (purpose === "publish" && contentType.startsWith("video/")) {
      videoJobId = "video_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
      const settings = {
        filename: originalName,
        displayName: originalName.replace(/\.[a-z0-9]{2,5}$/i, ""),
        contentTitle: String(form.get("title") || "").trim().slice(0, 180),
        overview: String(form.get("overview") || "").trim().slice(0, 1800),
        releaseYear: String(form.get("year") || "").trim().slice(0, 12),
        mediaType: String(form.get("mediaType") || "").trim().slice(0, 24),
        posterUrl: String(form.get("posterUrl") || "").trim().slice(0, 1200),
        clipDuration: 30,
        requestedClips: 1,
        outputFormat: "reel",
        editStyle: "cinematic-card-v1"
      };
      await env.DB.prepare(
        `INSERT INTO video_jobs(id, client_id, source_object_key, status, settings_json, result_json, created_at, updated_at)
         VALUES(?1, ?2, ?3, 'awaiting_configuration', ?4, ?5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(
        videoJobId,
        String(client.id),
        key,
        JSON.stringify(settings),
        JSON.stringify({ progress: 15, message: "Vídeo enviado. Preencha os dados e gere o MP4.", error: "" })
      ).run();
    }

    return json({
      ok: true,
      message: videoJobId ? "Vídeo enviado. Agora complete os dados e gere o MP4." : (purpose === "reference"
        ? "Mídia salva como referência de estilo."
        : "Mídia salva na biblioteca do cliente."),
      videoJobId,
      media: (await listClientMedia(env, client.id, url.origin)).find(item => item.key === key) || { key, url: url.origin + "/media/" + key }
    }, 201);
  }

  if (url.pathname === "/api/portal/media/use" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      return json(await useLibraryImageForPost(
        env,
        client,
        String(body.postId || ""),
        String(body.key || ""),
        url.origin
      ));
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      const status = code === "post_not_found" || code === "library_media_not_found" ? 404
        : code === "already_published" ? 409
        : code === "image_too_large" ? 413
        : code === "r2_unavailable" ? 503
        : 400;
      const messages = {
        library_media_image_required: "Escolha uma imagem da biblioteca. Vídeos permanecem armazenados para uso futuro.",
        already_published: "Esta postagem já foi publicada.",
        image_too_large: "A imagem deve ter no máximo 10 MB para ser aplicada a uma postagem."
      };
      return json({ error: code, message: messages[code] || "Não foi possível aplicar esta mídia à postagem." }, status);
    }
  }

  const mediaDeleteMatch = url.pathname.match(/^\/api\/portal\/media\/(.+)$/);
  if (mediaDeleteMatch && request.method === "DELETE") {
    let key = "";
    try { key = decodeURIComponent(mediaDeleteMatch[1]); } catch {}
    const prefix = "library/" + String(client.id) + "/";
    if (!key.startsWith(prefix) || key.includes("..") || key.includes("\\")) {
      return json({ error: "not_found" }, 404);
    }
    await env.MEDIA?.delete(key);
    return json({ ok: true, deleted: true });
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

  const postCancelMatch = url.pathname.match(/^\/api\/portal\/posts\/([^/]+)\/cancel$/);
  if (postCancelMatch && request.method === "POST") {
    try {
      return json(await cancelPost(env, client, decodeURIComponent(postCancelMatch[1])));
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      const status = code === "post_not_found" ? 404
        : ["already_published", "publishing_in_progress"].includes(code) ? 409
        : 400;
      const messages = {
        already_published: "A postagem já foi publicada. Abra no Instagram para gerenciá-la.",
        publishing_in_progress: "A postagem já está em processo de publicação."
      };
      return json({ error: code, message: messages[code] || "Não foi possível cancelar esta postagem." }, status);
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

  if (url.pathname === "/api/portal/workspace" && request.method === "GET") {
    return json(await masterWorkspace(env, client.id));
  }

  if (url.pathname === "/api/portal/directives" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    try {
      const directive = await addDirective(env, client.id, {
        ...body,
        author: "CLIENT",
        appliesTo: Array.isArray(body.appliesTo) && body.appliesTo.length ? body.appliesTo : ["all"]
      });
      return json({ ok: true, directive }, 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  if (url.pathname === "/api/portal/campaigns" && request.method === "POST") {
    const form = await request.formData().catch(() => null);
    try {
      const campaign = await createCampaign(env, client.id, {
        title: form?.get("title"),
        brief: form?.get("brief"),
        startDate: form?.get("startDate"),
        file: form?.get("creative")
      });
      return json({ ok: true, campaign }, 201);
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      const status = code === "creative_too_large" ? 413 : code === "r2_unavailable" ? 503 : 400;
      return json({ error: code }, status);
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
