import { Container, getContainer } from "@cloudflare/containers";

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function videoKeyPrefix(clientId) {
  return "videos/" + String(clientId) + "/sources/";
}

function cleanSegment(value, fallback = "video") {
  return String(value || fallback)
    .trim()
    .replace(/[\r\n]/g, " ")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .slice(0, 180) || fallback;
}

export class YouTubeDownloader extends Container {
  defaultPort = 8080;
  enableInternet = true;
  sleepAfter = "10m";
}

YouTubeDownloader.outboundByHost = {
  "nexus-r2": async (request, env) => {
    if (request.method !== "PUT") return new Response("method_not_allowed", { status: 405 });
    if (!env.MEDIA || !env.DB) return new Response("bindings_unavailable", { status: 503 });

    const jobId = String(request.headers.get("x-nexus-job-id") || "").trim();
    const clientId = String(request.headers.get("x-nexus-client-id") || "").trim();
    const titleRaw = String(request.headers.get("x-nexus-title") || "");
    const extensionRaw = String(request.headers.get("x-nexus-extension") || "mp4").toLowerCase();
    const extension = ["mp4","webm","mov","m4v","mkv"].includes(extensionRaw) ? extensionRaw : "mp4";
    if (!jobId || !clientId || !request.body) return new Response("missing_fields", { status: 400 });

    const row = await env.DB.prepare(
      "SELECT id,client_id,status,settings_json,result_json FROM video_jobs WHERE id=?1 AND client_id=?2 LIMIT 1"
    ).bind(jobId, clientId).first();
    if (!row || String(row.status) !== "importing") return new Response("job_not_importing", { status: 409 });

    const key = videoKeyPrefix(clientId) + crypto.randomUUID() + "." + extension;
    const contentType = String(request.headers.get("content-type") || "video/mp4")
      .toLowerCase().split(";")[0].trim();
    let title = "trailer";
    try { title = decodeURIComponent(titleRaw) || "trailer"; } catch {}

    try {
      const object = await env.MEDIA.put(key, request.body, {
        httpMetadata: {
          contentType: contentType.startsWith("video/") ? contentType : "video/mp4",
          cacheControl: "private, no-store"
        },
        customMetadata: {
          clientId,
          originalName: cleanSegment(title) + "." + extension,
          sourceHost: "youtube.com",
          resolver: "cloudflare-container-yt-dlp",
          kind: "video-source"
        }
      });
      if (!object) throw new Error("r2_put_failed");

      const settings = parseJson(row.settings_json, {});
      settings.fileSize = Number(object.size || request.headers.get("content-length") || 0);
      settings.contentType = contentType.startsWith("video/") ? contentType : "video/mp4";
      settings.filename = cleanSegment(title) + "." + extension;
      settings.displayName = settings.filename;

      const result = {
        ...parseJson(row.result_json, {}),
        progress: 100,
        storage: "r2",
        objectEtag: object.httpEtag || "",
        resolver: "cloudflare-container-yt-dlp",
        message: "Vídeo salvo na biblioteca. Configure os cortes antes de iniciar.",
        error: ""
      };

      await env.DB.prepare(
        "UPDATE video_jobs SET source_object_key=?3,status='awaiting_configuration',settings_json=?4,result_json=?5,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
      ).bind(jobId, clientId, key, JSON.stringify(settings), JSON.stringify(result)).run();

      return Response.json({ ok: true, jobId, key, size: Number(object.size || 0) });
    } catch (error) {
      await env.MEDIA.delete(key).catch(() => {});
      throw error;
    }
  },

  "nexus-status": async (request, env) => {
    if (request.method !== "POST") return new Response("method_not_allowed", { status: 405 });
    const url = new URL(request.url);
    if (url.pathname !== "/fail") return new Response("not_found", { status: 404 });
    const body = await request.json().catch(() => ({}));
    const jobId = String(body.jobId || "").trim();
    const clientId = String(body.clientId || "").trim();
    const error = String(body.error || "trailer_download_failed").slice(0, 500);
    if (!jobId || !clientId) return new Response("missing_fields", { status: 400 });

    const row = await env.DB.prepare(
      "SELECT result_json FROM video_jobs WHERE id=?1 AND client_id=?2 LIMIT 1"
    ).bind(jobId, clientId).first();
    const result = {
      ...parseJson(row?.result_json, {}),
      progress: 0,
      message: "Falha ao trazer o vídeo para a biblioteca.",
      error
    };
    await env.DB.prepare(
      "UPDATE video_jobs SET status='failed',result_json=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
    ).bind(jobId, clientId, JSON.stringify(result)).run();
    return Response.json({ ok: true });
  }
};


export async function dispatchYouTubeImport(env, clientId, jobId, sourceUrl, title = "trailer") {
  if (!env.YOUTUBE_DOWNLOADER) throw new Error("youtube_container_unavailable");
  const stub = getContainer(env.YOUTUBE_DOWNLOADER, String(clientId || "shared"));
  const response = await stub.fetch("http://container/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jobId: String(jobId),
      clientId: String(clientId),
      sourceUrl: String(sourceUrl),
      title: String(title || "trailer")
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error || "youtube_container_dispatch_failed"));
  }
  return payload;
}
