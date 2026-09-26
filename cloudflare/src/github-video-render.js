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

export async function startGitHubVideoRender(env, clientId, jobId, patch = {}) {
  const ghToken = String(env.GITHUB_ACTIONS_TOKEN || "").trim();
  if (!ghToken) throw new Error("github_actions_token_missing");

  const row = await loadJob(env, jobId, clientId);
  if (!row) throw new Error("video_not_found");
  if (!row.source_object_key) throw new Error("video_source_missing");

  const settings = parseJson(row.settings_json, {});
  const result = parseJson(row.result_json, {});
  const duration = Math.max(10, Math.min(90, Number(patch.duration || patch.clipDuration || settings.clipDuration || 30)));
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

  await env.DB.prepare(
    "UPDATE video_jobs SET status='cutting',settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
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

  const repo = String(env.GITHUB_INGEST_REPOSITORY || "globalplay27/SERVIDOR-GLOBAL-PLAY");
  const [owner, name] = repo.split("/");
  const response = await fetch(`https://api.github.com/repos/${owner}/${name}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ghToken}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "NEXUS-Cloudflare-Worker"
    },
    body: JSON.stringify({
      event_type: "video-template-render",
      client_payload: {
        job_id: String(jobId),
        client_id: String(clientId),
        callback_token: settings.githubRenderToken,
        title: String(settings.contentTitle || settings.displayName || "Conteúdo").slice(0, 180),
        overview: String(settings.overview || "").slice(0, 1800),
        year: String(settings.releaseYear || "").slice(0, 12),
        media_type: String(settings.mediaType || "").slice(0, 24),
        poster_url: String(settings.posterUrl || "").slice(0, 1200),
        duration,
        edit_style: editStyle,
        end_text: String(settings.endText || "").slice(0, 120),
        end_contact: String(settings.endContact || "").slice(0, 120)
      }
    })
  });

  if (response.status !== 204) {
    const detail = (await response.text().catch(() => "")).slice(0, 250);
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
  if (!url.pathname.startsWith("/api/internal/video-render/")) return null;

  const jobId = String(request.headers.get("x-nexus-job-id") || "").trim();
  const clientId = String(request.headers.get("x-nexus-client-id") || "").trim();
  const token = String(request.headers.get("x-nexus-callback-token") || "").trim();
  const row = await loadJob(env, jobId, clientId);
  if (!row || !validRenderToken(row, token)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
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

  if (url.pathname === "/api/internal/video-render/upload" && request.method === "PUT") {
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
    const clipId = "clip_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    const key = clipKeyPrefix(clientId) + clipId + ".mp4";
    const object = await env.MEDIA.put(key, request.body, {
      httpMetadata: { contentType: "video/mp4", cacheControl: "private, no-store" },
      customMetadata: { clientId: String(clientId), jobId: String(jobId), kind: "video-clip", template: String(settings.editStyle || "cinematic-card-v1") }
    });
    if (!object) throw new Error("render_store_failed");

    const clipSettings = {
      rank: 1,
      title: settings.contentTitle || settings.displayName || "Corte NEXUS",
      caption: settings.contentTitle || "",
      start: 0,
      end: Number(settings.clipDuration || 30),
      endText: settings.endText || "",
      endContact: settings.endContact || "",
      templateStyle: settings.editStyle || "cinematic-card-v1",
      selectedForSchedule: false
    };
    const clipResult = {
      previewUrl: `/api/portal/videos/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}/media`,
      qualityScore: 92,
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
        message: "A renderização do modelo NEXUS falhou.",
        error: String(body.error || "github_render_failed").slice(0, 500)
      })
    ).run();
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
}
