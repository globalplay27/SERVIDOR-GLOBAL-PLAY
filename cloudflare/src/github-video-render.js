import { portugueseTrailerScore } from './video-catalog.js';
import { confirmedVideoSource, videoErrorMessages } from './video-source.js';
function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

async function loadJob(env, jobId, clientId) {
  return env.DB.prepare(
    "SELECT id,client_id,source_object_key,status,settings_json,result_json FROM video_jobs WHERE id=?1 AND client_id=?2 LIMIT 1"
  ).bind(String(jobId), String(clientId)).first();
}

function validRenderToken(row, token) {
  if (!row || !token) return false;
  const settings = parseJson(row.settings_json, {});
  return Boolean(settings.githubRenderToken && String(settings.githubRenderToken) === String(token));
}

function clipKeyPrefix(clientId) {
  return "videos/" + String(clientId).replace(/[^a-zA-Z0-9_-]+/g, "-") + "/clips/";
}


function sourceKeyPrefix(clientId) {
  return "videos/" + String(clientId).replace(/[^a-zA-Z0-9_-]+/g, "-") + "/sources/";
}

function validIngestToken(row, token) {
  if (!row || !token) return false;
  const settings = parseJson(row.settings_json, {});
  return Boolean(settings.ingestCallbackToken && String(settings.ingestCallbackToken) === String(token));
}

export async function startYouTubeVideoIngest(env, clientId, jobId) {
  const row = await loadJob(env, jobId, clientId);
  if (!row) throw new Error("video_not_found");
  const settings = parseJson(row.settings_json, {});
  const result = parseJson(row.result_json, {});
  const sourceUrl = String(settings.sourceUrl || "").trim();
  if (!sourceUrl) throw new Error("video_source_missing");

  const downloaderUrl = String(env.NEXUS_DOWNLOADER_URL || "").trim().replace(/\/+$/, "");
  settings.ingestStartedAt = new Date().toISOString();

  settings.ingestCallbackToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await env.DB.prepare(
    "UPDATE video_jobs SET status='importing',settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
  ).bind(
    String(jobId),
    String(clientId),
    JSON.stringify(settings),
    JSON.stringify({ ...result, progress: 10, message: "Importando o vídeo para o NEXUS antes da renderização.", error: "" })
  ).run();

  try {
  if (!downloaderUrl) throw new Error("youtube_downloader_not_configured");
  const response = await fetch(downloaderUrl + "/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(String(env.NEXUS_DOWNLOADER_SECRET || "").trim()
        ? { authorization: "Bearer " + String(env.NEXUS_DOWNLOADER_SECRET).trim() }
        : {})
    },
    body: JSON.stringify({
      source_url: sourceUrl,
      job_id: String(jobId),
      client_id: String(clientId),
      callback_token: settings.ingestCallbackToken,
      callback_base: String(env.PUBLIC_BASE_URL || "https://servidor-nexus.diamantehinode2015.workers.dev").replace(/\/+$/, ""),
      title: String(settings.contentTitle || settings.displayName || "video-youtube").slice(0, 180)
    }),
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error("youtube_downloader_http_" + response.status);
  }
  const accepted = await response.json().catch(() => null);
  if (accepted?.accepted !== true || String(accepted.job_id || accepted.jobId || "") !== String(jobId)) {
    throw new Error("youtube_downloader_invalid_response");
  }
  } catch (error) {
    const code = /^(youtube_downloader_)/.test(String(error?.message || "")) ? error.message
      : ["TimeoutError", "AbortError"].includes(error?.name) ? "youtube_downloader_timeout" : "youtube_downloader_transport_failed";
    delete settings.ingestCallbackToken;
    await env.DB.prepare(
      "UPDATE video_jobs SET status='failed',settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2 AND status='importing'"
    ).bind(
      String(jobId),
      String(clientId),
      JSON.stringify(settings),
      JSON.stringify({ ...result, progress: 0, message: videoErrorMessages[code] || "O importador recusou o pedido: " + code + ". Use Enviar arquivo.", error: code })
    ).run();
    throw new Error(code);
  }

  return { ok: true, jobId };
}

export async function startGitHubVideoRender(env, clientId, jobId, patch = {}) {
  const ghToken = String(env.GITHUB_ACTIONS_TOKEN || env.GITHUB_TOKEN || "").trim();
  if (!ghToken) throw new Error("github_actions_token_missing");

  const row = await loadJob(env, jobId, clientId);
  if (!row) throw new Error("video_not_found");
  if (!row.source_object_key) throw new Error("video_source_missing");
  if (["importing", "cutting"].includes(row.status)) throw new Error("video_render_in_progress");
  await confirmedVideoSource(env, clientId, row.source_object_key);

  const settings = parseJson(row.settings_json, {});
  const result = parseJson(row.result_json, {});
  const duration = null; // Customer template always edits the complete source.
  const clips = Math.max(1, Math.min(12, Number(patch.clips || patch.requestedClips || settings.requestedClips || 3)));
  const outputFormat = ["reel","feed","square"].includes(String(patch.outputFormat || settings.outputFormat || "reel"))
    ? String(patch.outputFormat || settings.outputFormat || "reel") : "reel";
  const editStyle = String(patch.editStyle || settings.editStyle || "cinematic-card-v1") === "classic-cuts"
    ? "classic-cuts" : "cinematic-card-v1";

  Object.assign(settings, {
    goal: String(patch.goal || settings.goal || "viral").slice(0, 40),
    clipDuration: duration,
    requestedClips: clips,
    outputFormat,
    autoSubtitles: patch.autoSubtitles !== false,
    endText: String(patch.endText ?? settings.endText ?? "").trim().slice(0, 120),
    endContact: String(patch.endContact ?? settings.endContact ?? "").trim().slice(0, 120),
    editStyle,
    githubRenderToken: crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""),
    githubRenderState: "dispatching",
    githubRenderUpdatedAt: new Date().toISOString()
  });

  const claim = await env.DB.prepare(
    "UPDATE video_jobs SET status='cutting',settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2 AND status NOT IN ('importing','cutting')"
  ).bind(
    String(jobId),
    String(clientId),
    JSON.stringify(settings),
    JSON.stringify({
      ...result,
      progress: 25,
      message: editStyle === "cinematic-card-v1"
        ? "Aplicando o modelo cinematográfico NEXUS."
        : "Criando o corte.",
      error: ""
    })
  ).run();
  if (!claim?.meta?.changes) throw new Error("video_render_in_progress");

  const repo = String(env.GITHUB_INGEST_REPOSITORY || "globalplay27/SERVIDOR-GLOBAL-PLAY");
  const [owner, name] = repo.split("/");
  let response;
  try { response = await fetch(`https://api.github.com/repos/${owner}/${name}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ghToken}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "NEXUS-Cloudflare-Worker"
    },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      event_type: "video-template-render",
      client_payload: {
        job_id: String(jobId),
        client_id: String(clientId),
        callback_token: settings.githubRenderToken,
        render: {
          title: String(settings.contentTitle || settings.displayName || "Conteúdo").slice(0, 180),
          overview: String(settings.overview || "").slice(0, 1800),
          year: String(settings.releaseYear || "").slice(0, 12),
          media_type: String(settings.mediaType || "").slice(0, 24),
          poster_url: String(settings.posterUrl || "").slice(0, 1200),
          metadata: settings.movieMetadata || null,
          logo_enabled: settings.logoEnabled === true && Boolean(settings.logoObjectKey),
          duration,
          edit_style: editStyle,
          end_text: String(settings.endText || "").slice(0, 120),
          end_contact: String(settings.endContact || "").slice(0, 120)
        }
      }
    })
  }); } catch (error) {
    const code = ["TimeoutError", "AbortError"].includes(error?.name) ? "github_render_dispatch_timeout" : "github_render_dispatch_transport_failed";
    settings.githubRenderState = "failed";
    delete settings.githubRenderToken;
    await env.DB.prepare("UPDATE video_jobs SET status='failed',settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2 AND status='cutting'")
      .bind(jobId, clientId, JSON.stringify(settings), JSON.stringify({ ...result, progress: 0, message: "Falha na conexão com o renderizador. Tente gerar novamente.", error: code })).run();
    throw new Error(code);
  }

  if (response.status !== 204) {
    const detail = (await response.text().catch(() => "")).slice(0, 250);
    console.error("video_render_dispatch_failed", { status: response.status, detail, repo, jobId: String(jobId), clientId: String(clientId) });
    settings.githubRenderState = "failed";
    await env.DB.prepare(
      "UPDATE video_jobs SET status='failed',settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
    ).bind(
      String(jobId),
      String(clientId),
      JSON.stringify(settings),
      JSON.stringify({
        ...result,
        progress: 0,
        message: "Não foi possível iniciar a edição no GitHub.",
        error: ("github_render_dispatch_" + response.status + ":" + detail).slice(0, 500)
      })
    ).run();
    throw new Error("github_render_dispatch_failed");
  }

  settings.githubRenderState = "dispatched";
  settings.githubRenderUpdatedAt = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE video_jobs SET settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
  ).bind(
    String(jobId),
    String(clientId),
    JSON.stringify(settings),
    JSON.stringify({ ...result, progress: 35, message: "Modelo NEXUS enviado para renderização.", error: "" })
  ).run();

  return { ok: true, jobId };
}

export async function handleGitHubVideoRenderCallback(request, env, url) {
  if (!url.pathname.startsWith("/api/internal/video-render/") && !url.pathname.startsWith("/api/internal/video-ingest/")) return null;

  const jobId = String(request.headers.get("x-nexus-job-id") || "").trim();
  const clientId = String(request.headers.get("x-nexus-client-id") || "").trim();
  const token = String(request.headers.get("x-nexus-callback-token") || "").trim();
  const row = await loadJob(env, jobId, clientId);

  if (url.pathname.startsWith("/api/internal/video-ingest/")) {
    if (!row || !validIngestToken(row, token)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    if (url.pathname === "/api/internal/video-ingest/upload" && request.method === "PUT") {
      if (!env.MEDIA || !request.body) {
        return new Response(JSON.stringify({ error: "r2_unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
      }
      const declared = Number(request.headers.get("content-length") || 0);
      if (!declared || declared > 95 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: declared ? "video_too_large" : "video_size_required" }), {
          status: declared ? 413 : 400,
          headers: { "content-type": "application/json" }
        });
      }

      const settings = parseJson(row.settings_json, {});
      const result = parseJson(row.result_json, {});
      const key = sourceKeyPrefix(clientId) + crypto.randomUUID() + ".mp4";
      const object = await env.MEDIA.put(key, request.body, {
        httpMetadata: { contentType: "video/mp4", cacheControl: "private, no-store" },
        customMetadata: { clientId: String(clientId), jobId: String(jobId), kind: "video-source", source: "youtube" }
      });
      if (!object) return Response.json({ error: "video_store_failed" }, { status: 500 });
      await confirmedVideoSource(env, clientId, key, declared);

      delete settings.ingestCallbackToken;
      await env.DB.prepare(
        "UPDATE video_jobs SET source_object_key=?3,status='awaiting_configuration',settings_json=?4,result_json=?5,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
      ).bind(
        String(jobId),
        String(clientId),
        key,
        JSON.stringify(settings),
        JSON.stringify({ ...result, progress: 0, message: "MP4 original confirmado no R2. Configure o vídeo no Laboratório antes de gerar.", error: "" })
      ).run();

      return new Response(JSON.stringify({ ok: true, jobId, objectKey: key }), {
        status: 201,
        headers: { "content-type": "application/json" }
      });
    }

    if (url.pathname === "/api/internal/video-ingest/fail" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const settings = parseJson(row.settings_json, {});
      const result = parseJson(row.result_json, {});
      delete settings.ingestCallbackToken;
      await env.DB.prepare(
        "UPDATE video_jobs SET status='failed',settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
      ).bind(
        String(jobId),
        String(clientId),
        JSON.stringify(settings),
        JSON.stringify({ ...result, progress: 0, message: videoErrorMessages[body.error] || "A importação do vídeo do YouTube falhou. Use Enviar arquivo.", error: String(body.error || "youtube_ingest_failed").slice(0, 500) })
      ).run();
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
  }

  if (!row || !validRenderToken(row, token)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  if (url.pathname === "/api/internal/video-render/search-results" && request.method === "POST") {
    const settings = parseJson(row.settings_json);
    if (!settings.searchOnly) return new Response("invalid_search_job", { status: 400 });
    const body = await request.json();
    const results = (Array.isArray(body.results) ? body.results : []).slice(0, 30)
      .filter(x => /^[a-zA-Z0-9_-]{11}$/.test(String(x.id || "")))
      .map(x => ({ id: x.id, title: String(x.title || "").slice(0, 220), channel: String(x.channel || "").slice(0, 120), channelId: String(x.channelId || '').slice(0, 30), channelVerified: x.channelVerified === true, duration: Number(x.duration) || null, url: "https://www.youtube.com/watch?v=" + x.id, thumbnail: "https://i.ytimg.com/vi/" + x.id + "/hqdefault.jpg" }))
      .filter(x => portugueseTrailerScore(x) >= 0).sort((a, b) => portugueseTrailerScore(b) - portugueseTrailerScore(a)).slice(0, 8);
    delete settings.githubRenderToken;
    await env.DB.prepare("UPDATE video_jobs SET status='search_results',settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2")
      .bind(jobId, clientId, JSON.stringify(settings), JSON.stringify({ results })).run();
    return Response.json({ ok: true });
  }

  if (url.pathname === "/api/internal/video-render/poster" && request.method === "GET") {
    const settings = parseJson(row.settings_json, {});
    let key = "";
    try {
      const poster = new URL(String(settings.posterUrl || ""), url.origin);
      if (poster.pathname.startsWith("/media/")) key = decodeURIComponent(poster.pathname.slice(7));
    } catch {}
    if (!env.MEDIA || !key.startsWith("library/" + String(clientId) + "/") || key.includes("..") || key.includes("\\")) {
      return new Response(JSON.stringify({ error: "poster_not_found" }), { status: 404, headers: { "content-type": "application/json" } });
    }
    const object = await env.MEDIA.get(key);
    if (!object) return new Response(JSON.stringify({ error: "poster_not_found" }), { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("cache-control", "private, no-store");
    if (object.size) headers.set("content-length", String(object.size));
    return new Response(object.body, { status: 200, headers });
  }

  if (url.pathname === "/api/internal/video-render/logo" && request.method === "GET") {
    const settings = parseJson(row.settings_json, {});
    const key = String(settings.logoObjectKey || "");
    const allowed = key.startsWith("branding/" + String(clientId) + "/") && !key.includes("..");
    if (!env.MEDIA || !settings.logoEnabled || !allowed) {
      return new Response(JSON.stringify({ error: "logo_not_found" }), { status: 404, headers: { "content-type": "application/json" } });
    }
    const object = await env.MEDIA.get(key);
    if (!object) return new Response(JSON.stringify({ error: "logo_not_found" }), { status: 404, headers: { "content-type": "application/json" } });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("cache-control", "private, no-store");
    if (object.size) headers.set("content-length", String(object.size));
    return new Response(object.body, { status: 200, headers });
  }

  if (url.pathname === "/api/internal/video-render/source" && request.method === "GET") {
    if (!env.MEDIA || !row.source_object_key) {
      return new Response(JSON.stringify({ error: "video_source_missing" }), { status: 404, headers: { "content-type": "application/json" } });
    }
    const object = await env.MEDIA.get(String(row.source_object_key));
    if (!object) return new Response(JSON.stringify({ error: "video_source_missing" }), { status: 404, headers: { "content-type": "application/json" } });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("cache-control", "private, no-store");
    if (object.size) headers.set("content-length", String(object.size));
    return new Response(object.body, { status: 200, headers });
  }

  if (url.pathname.startsWith("/api/internal/video-render/upload/") && !env.MEDIA) return new Response("r2_unavailable", { status: 503 });
  if (url.pathname === "/api/internal/video-render/upload/start" && request.method === "POST") {
    const settings = parseJson(row.settings_json);
    const clipId = "clip_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    const key = clipKeyPrefix(clientId) + clipId + ".mp4";
    const upload = await env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType: "video/mp4", cacheControl: "private, no-store" }, customMetadata: { clientId, jobId, kind: "video-clip" } });
    settings.renderUpload = { key, clipId, uploadId: upload.uploadId };
    await env.DB.prepare("UPDATE video_jobs SET settings_json=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2").bind(jobId, clientId, JSON.stringify(settings)).run();
    return Response.json({ ok: true });
  }
  if (url.pathname === "/api/internal/video-render/upload/part" && request.method === "PUT") {
    const upload = parseJson(row.settings_json).renderUpload;
    const number = Number(url.searchParams.get("part"));
    const size = Number(request.headers.get("content-length"));
    if (!upload?.key?.startsWith(clipKeyPrefix(clientId)) || !Number.isInteger(number) || number < 1 || number > 10000 || !size || size > 90 * 1024 * 1024) return new Response("invalid_part", { status: 400 });
    const part = await env.MEDIA.resumeMultipartUpload(upload.key, upload.uploadId).uploadPart(number, request.body);
    return Response.json(part);
  }
  if ((url.pathname === "/api/internal/video-render/upload" && request.method === "PUT") || (url.pathname === "/api/internal/video-render/upload/complete" && request.method === "POST")) {
    if (!env.MEDIA || !request.body) {
      return new Response(JSON.stringify({ error: "r2_unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
    }
    const multipart = url.pathname.endsWith("/complete");
    const declared = Number(request.headers.get("content-length") || 0);
    if (!multipart && (!declared || declared > 95 * 1024 * 1024)) {
      return new Response(JSON.stringify({ error: declared ? "video_too_large" : "video_size_required" }), {
        status: declared ? 413 : 400,
        headers: { "content-type": "application/json" }
      });
    }

    const settings = parseJson(row.settings_json, {});
    const result = parseJson(row.result_json, {});
    const clipId = multipart ? settings.renderUpload?.clipId : "clip_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    const key = multipart ? settings.renderUpload?.key : clipKeyPrefix(clientId) + clipId + ".mp4";
    let object;
    if (multipart) {
      const upload = settings.renderUpload;
      const body = await request.json();
      if (!upload?.key?.startsWith(clipKeyPrefix(clientId)) || !Array.isArray(body.parts) || !body.parts.length || body.parts.length > 10000 || !body.parts.every((p, i) => p.partNumber === i + 1 && typeof p.etag === "string" && p.etag.length < 200)) return new Response("invalid_upload", { status: 400 });
      object = await env.MEDIA.resumeMultipartUpload(upload.key, upload.uploadId).complete(body.parts);
      delete settings.renderUpload;
    } else object = await env.MEDIA.put(key, request.body, {
      httpMetadata: { contentType: "video/mp4", cacheControl: "private, no-store" },
      customMetadata: { clientId: String(clientId), jobId: String(jobId), kind: "video-clip", template: String(settings.editStyle || "cinematic-card-v1") }
    });
    if (!object) throw new Error("render_store_failed");
    const stored = await env.MEDIA.head(key);
    if (!stored || !Number(stored.size) || (object.size && Number(stored.size) !== Number(object.size))) throw new Error("render_store_unconfirmed");

    const clipSettings = {
      rank: 1,
      title: settings.contentTitle || settings.displayName || "Corte NEXUS",
      caption: settings.contentTitle || "",
      start: 0,
      end: Number(request.headers.get("x-nexus-duration") || settings.clipDuration || 0),
      endText: settings.endText || "",
      endContact: settings.endContact || "",
      templateStyle: settings.editStyle || "cinematic-card-v1",
      selectedForSchedule: false
    };
    const clipResult = {
      previewUrl: `/api/portal/videos/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}/media`,
      reason: settings.editStyle === "cinematic-card-v1"
        ? "Modelo cinematográfico NEXUS com vídeo, pôster e ficha visual."
        : "Corte gerado pelo NEXUS.",
      subtitlesApplied: false
    };

    await env.DB.prepare(
      `INSERT INTO video_clips(id,job_id,client_id,source_object_key,output_object_key,status,approval_status,publish_status,settings_json,result_json,created_at,updated_at)
       VALUES(?1,?2,?3,?4,?5,'ready','pending','draft',?6,?7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    ).bind(
      clipId,
      String(jobId),
      String(clientId),
      String(row.source_object_key),
      key,
      JSON.stringify(clipSettings),
      JSON.stringify(clipResult)
    ).run();

    settings.githubRenderState = "completed";
    delete settings.githubRenderToken;
    await env.DB.prepare(
      "UPDATE video_jobs SET status='ready',settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
    ).bind(
      String(jobId),
      String(clientId),
      JSON.stringify(settings),
      JSON.stringify({ ...result, progress: 100, message: "Edição cinematográfica pronta para revisão.", error: "" })
    ).run();

    return new Response(JSON.stringify({ ok: true, jobId, clipId, objectKey: key }), {
      status: 201,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  if (url.pathname === "/api/internal/video-render/fail" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const settings = parseJson(row.settings_json, {});
    const result = parseJson(row.result_json, {});
    if (settings.renderUpload?.key?.startsWith(clipKeyPrefix(clientId))) {
      await env.MEDIA?.resumeMultipartUpload(settings.renderUpload.key, settings.renderUpload.uploadId).abort().catch(() => {});
      delete settings.renderUpload;
    }
    settings.githubRenderState = "failed";
    delete settings.githubRenderToken;
    await env.DB.prepare(
      "UPDATE video_jobs SET status='failed',settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
    ).bind(
      String(jobId),
      String(clientId),
      JSON.stringify(settings),
      JSON.stringify({
        ...result,
        progress: 0,
        message: body.error === "trailer_not_portuguese" ? "O áudio deste trailer não foi confirmado em português. Escolha outro trailer oficial dublado." : body.error === "trailer_not_official" ? "Este vídeo não foi confirmado como trailer de um canal oficial. Escolha outro resultado." : "A renderização do modelo NEXUS falhou.",
        error: String(body.error || "github_render_failed").slice(0, 500)
      })
    ).run();
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
}
