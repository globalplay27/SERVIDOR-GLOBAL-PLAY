function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function safeClientId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "client";
}

function extensionForUpload(fileName, contentType) {
  const type = String(contentType || "").toLowerCase().split(";")[0].trim();
  const ext = String(fileName || "").toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] || "";
  if (["mp4", "webm", "mov", "mkv"].includes(ext)) return ext;
  if (type.includes("webm")) return "webm";
  if (type.includes("quicktime")) return "mov";
  if (type.includes("matroska")) return "mkv";
  return "mp4";
}

async function loadJob(env, jobId, clientId) {
  if (!jobId || !clientId) return null;
  return env.DB.prepare(
    "SELECT id,client_id,status,settings_json,result_json FROM video_jobs WHERE id=?1 AND client_id=?2 LIMIT 1"
  ).bind(String(jobId), String(clientId)).first();
}

function validToken(row, token) {
  if (!row || !token) return false;
  const settings = parseJson(row.settings_json, {});
  const expected = String(settings.githubIngestToken || "");
  return Boolean(expected && expected === String(token));
}

export async function dispatchGitHubVideoIngest(env, clientId, jobId, sourceUrl, title = "trailer") {
  const token = String(env.NEXUS_ACTIONS_TOKEN || "").trim();
  if (!token) throw new Error("github_actions_token_missing");

  const repo = String(env.GITHUB_INGEST_REPOSITORY || "globalplay27/SERVIDOR-GLOBAL-PLAY").trim();
  const parts = repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("github_ingest_repository_invalid");

  const row = await loadJob(env, jobId, clientId);
  if (!row || String(row.status) !== "importing") throw new Error("video_job_not_importing");
  const settings = parseJson(row.settings_json, {});
  const result = parseJson(row.result_json, {});
  const ingestToken = String(settings.githubIngestToken || "");
  if (!ingestToken) throw new Error("github_ingest_token_missing");

  const attempt = Math.max(0, Number(settings.githubDispatchAttempts || 0)) + 1;
  settings.githubDispatchAttempts = attempt;
  settings.githubDispatchState = "dispatching";
  settings.githubDispatchUpdatedAt = new Date().toISOString();

  await env.DB.prepare(
    "UPDATE video_jobs SET settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
  ).bind(
    String(jobId),
    String(clientId),
    JSON.stringify(settings),
    JSON.stringify({
      ...result,
      progress: 8,
      message: "Enviando importação para o processador gratuito do GitHub.",
      error: ""
    })
  ).run();

  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "NEXUS-Cloudflare-Worker"
    },
    body: JSON.stringify({
      event_type: "library-ingest",
      client_payload: {
        job_id: String(jobId),
        client_id: String(clientId),
        source_url: String(sourceUrl || "").slice(0, 1200),
        title: String(title || "trailer").slice(0, 160),
        callback_token: ingestToken
      }
    })
  });

  if (response.status !== 204) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    settings.githubDispatchState = "error";
    settings.githubDispatchUpdatedAt = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE video_jobs SET settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
    ).bind(
      String(jobId),
      String(clientId),
      JSON.stringify(settings),
      JSON.stringify({
        ...result,
        progress: 5,
        message: "Falha ao iniciar a importação no GitHub.",
        error: `github_dispatch_http_${response.status}${detail ? ":" + detail : ""}`.slice(0, 500)
      })
    ).run();
    throw new Error(`github_dispatch_http_${response.status}`);
  }

  settings.githubDispatchState = "dispatched";
  settings.githubDispatchUpdatedAt = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE video_jobs SET settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
  ).bind(
    String(jobId),
    String(clientId),
    JSON.stringify(settings),
    JSON.stringify({
      ...result,
      progress: 12,
      message: "GitHub recebeu a importação. Baixando o vídeo.",
      error: ""
    })
  ).run();

  return { ok: true, attempt };
}

export async function dispatchPendingGitHubVideoImports(env, limit = 2) {
  if (!env?.DB || !env.NEXUS_ACTIONS_TOKEN) return { processed: 0 };
  const rows = await env.DB.prepare(
    "SELECT id,client_id,settings_json FROM video_jobs WHERE status='importing' ORDER BY updated_at ASC LIMIT ?1"
  ).bind(Math.max(1, Math.min(5, Number(limit || 1)))).all();

  let processed = 0;
  for (const row of rows?.results || []) {
    const settings = parseJson(row.settings_json, {});
    if (String(settings.sourceType || "") !== "youtube-public") continue;
    const sourceUrl = String(settings.sourceUrl || "").trim();
    if (!sourceUrl) continue;

    const attempts = Number(settings.githubDispatchAttempts || 0);
    const state = String(settings.githubDispatchState || "");
    const last = Date.parse(String(settings.githubDispatchUpdatedAt || "")) || 0;
    const stale = last && (Date.now() - last) > 20 * 60 * 1000;
    if (state === "dispatched" && !stale) continue;
    if (attempts >= 3) continue;

    await dispatchGitHubVideoIngest(
      env,
      row.client_id,
      row.id,
      sourceUrl,
      String(settings.contentTitle || settings.displayName || "trailer")
    ).catch(() => {});
    processed += 1;
  }
  return { processed };
}

export async function handleGitHubVideoIngestCallback(request, env, url) {
  if (!url.pathname.startsWith("/api/internal/video-ingest/")) return null;

  const jobId = String(request.headers.get("x-nexus-job-id") || url.searchParams.get("jobId") || "").trim();
  const clientId = String(request.headers.get("x-nexus-client-id") || url.searchParams.get("clientId") || "").trim();
  const token = String(request.headers.get("x-nexus-callback-token") || "").trim();
  const row = await loadJob(env, jobId, clientId);
  if (!row || !validToken(row, token)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  if (url.pathname === "/api/internal/video-ingest/upload" && request.method === "PUT") {
    if (!env.MEDIA) {
      return new Response(JSON.stringify({ error: "r2_unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
    }
    if (String(row.status) !== "importing") {
      return new Response(JSON.stringify({ error: "job_not_importing" }), { status: 409, headers: { "content-type": "application/json" } });
    }

    const declared = Number(request.headers.get("content-length") || 0);
    const maxBytes = 95 * 1024 * 1024;
    if (!declared || declared > maxBytes || !request.body) {
      return new Response(JSON.stringify({ error: declared > maxBytes ? "video_too_large" : "video_size_required" }), {
        status: declared > maxBytes ? 413 : 400,
        headers: { "content-type": "application/json" }
      });
    }

    const settings = parseJson(row.settings_json, {});
    const result = parseJson(row.result_json, {});
    const contentType = String(request.headers.get("content-type") || "video/mp4").split(";")[0].trim();
    const originalName = String(request.headers.get("x-nexus-file-name") || settings.contentTitle || "trailer.mp4").slice(0, 180);
    const ext = extensionForUpload(originalName, contentType);
    const key = `videos/${safeClientId(clientId)}/sources/${crypto.randomUUID()}.${ext}`;

    let object;
    try {
      object = await env.MEDIA.put(key, request.body, {
        httpMetadata: { contentType, cacheControl: "private, no-store" },
        customMetadata: {
          clientId: String(clientId),
          originalName,
          sourceHost: "youtube.com",
          resolver: "github-actions-yt-dlp",
          kind: "video-source"
        }
      });
    } catch {
      return new Response(JSON.stringify({ error: "r2_upload_failed" }), { status: 502, headers: { "content-type": "application/json" } });
    }

    settings.fileSize = Number(object?.size || declared || 0);
    settings.contentType = contentType;
    settings.filename = originalName;
    settings.displayName = originalName;
    settings.githubDispatchState = "completed";
    delete settings.githubIngestToken;

    await env.DB.prepare(
      "UPDATE video_jobs SET source_object_key=?3,status='awaiting_configuration',settings_json=?4,result_json=?5,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
    ).bind(
      String(jobId),
      String(clientId),
      key,
      JSON.stringify(settings),
      JSON.stringify({
        ...result,
        progress: 100,
        storage: "r2",
        resolver: "github-actions-yt-dlp",
        message: "Vídeo recebido na biblioteca. Configure os cortes.",
        error: ""
      })
    ).run();

    return new Response(JSON.stringify({ ok: true, jobId, objectKey: key }), {
      status: 201,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  if (url.pathname === "/api/internal/video-ingest/fail" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const settings = parseJson(row.settings_json, {});
    const result = parseJson(row.result_json, {});
    settings.githubDispatchState = "failed";
    delete settings.githubIngestToken;
    await env.DB.prepare(
      "UPDATE video_jobs SET status='failed',settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
    ).bind(
      String(jobId),
      String(clientId),
      JSON.stringify(settings),
      JSON.stringify({
        ...result,
        progress: 0,
        message: "Não foi possível importar este vídeo do YouTube.",
        error: String(body.error || "github_ingest_failed").slice(0, 500)
      })
    ).run();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  return new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
