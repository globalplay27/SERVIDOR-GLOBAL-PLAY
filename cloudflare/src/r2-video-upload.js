const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;

function cleanFileName(value) {
  return String(value || "video").trim().replace(/[\\/\0-\x1f\x7f]+/g, "_").slice(0, 180) || "video";
}

function extensionForVideo(fileName, contentType) {
  const type = String(contentType || "").toLowerCase().split(";")[0].trim();
  const byType = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-matroska": "mkv",
    "application/octet-stream": ""
  };
  const ext = String(fileName || "").toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] || "";
  const allowed = new Set(["mp4", "mov", "webm", "mkv"]);
  if (allowed.has(ext)) return ext;
  const mapped = byType[type] || "";
  return allowed.has(mapped) ? mapped : "";
}

function videoKeyPrefix(clientId) {
  return "videos/" + String(clientId) + "/sources/";
}

export function videoSourceKeyBelongsToClient(key, clientId) {
  const value = String(key || "");
  return value.startsWith(videoKeyPrefix(clientId)) && !value.includes("..") && !value.includes("\\");
}

function normalizeSettings(input = {}, file = {}) {
  const settings = input && typeof input === "object" ? input : {};
  const clipDuration = Math.max(10, Math.min(90, Number(settings.duration || settings.clipDuration || 30)));
  const requestedClips = Math.max(1, Math.min(12, Number(settings.clips || settings.requestedClips || 3)));
  const outputFormat = ["reel", "story", "feed"].includes(String(settings.outputFormat || "reel"))
    ? String(settings.outputFormat || "reel")
    : "reel";

  return {
    filename: cleanFileName(file.fileName),
    displayName: cleanFileName(file.fileName),
    fileSize: Math.max(0, Number(file.size || 0)),
    contentType: String(file.contentType || "application/octet-stream").slice(0, 120),
    folderId: String(settings.folderId || "default").slice(0, 120),
    contentTitle: String(settings.contentTitle || "").trim().slice(0, 180),
    goal: String(settings.goal || "viral").slice(0, 40),
    clipDuration,
    requestedClips,
    outputFormat,
    autoSubtitles: settings.autoSubtitles !== false,
    subtitleSize: String(settings.subtitleSize || "auto").slice(0, 30),
    subtitleColor: String(settings.subtitleColor || "white").slice(0, 30),
    subtitleWeight: String(settings.subtitleWeight || "bold").slice(0, 30),
    subtitleBg: String(settings.subtitleBg || "black").slice(0, 30),
    endText: String(settings.endText || "").trim().slice(0, 120),
    endContact: String(settings.endContact || "").trim().slice(0, 120),
    storage: "r2"
  };
}

async function validFolderId(env, clientId, folderId) {
  if (!folderId || folderId === "default") return "default";
  const row = await env.DB.prepare(
    "SELECT id FROM video_folders WHERE id=?1 AND client_id=?2 LIMIT 1"
  ).bind(String(folderId), String(clientId)).first();
  return row?.id ? String(row.id) : "default";
}

export async function createR2VideoUpload(env, clientId, metadata = {}) {
  if (!env.MEDIA) throw new Error("r2_unavailable");

  const fileName = cleanFileName(metadata.fileName);
  const contentType = String(metadata.contentType || "application/octet-stream").toLowerCase().split(";")[0].trim();
  const size = Number(metadata.size || 0);
  if (!Number.isFinite(size) || size <= 0) throw new Error("video_size_required");
  if (size > MAX_VIDEO_BYTES) throw new Error("video_too_large");

  const extension = extensionForVideo(fileName, contentType);
  if (!extension) throw new Error("invalid_video_type");

  const key = videoKeyPrefix(clientId) + crypto.randomUUID() + "." + extension;
  const upload = await env.MEDIA.createMultipartUpload(key, {
    httpMetadata: { contentType: contentType || "application/octet-stream" },
    customMetadata: {
      clientId: String(clientId),
      originalName: fileName.slice(0, 256),
      kind: "video-source"
    }
  });

  return {
    key: upload.key,
    uploadId: upload.uploadId,
    chunkSize: DEFAULT_CHUNK_BYTES,
    maxBytes: MAX_VIDEO_BYTES
  };
}

export async function uploadR2VideoPart(env, clientId, request, params = {}) {
  if (!env.MEDIA) throw new Error("r2_unavailable");
  const key = String(params.key || "");
  const uploadId = String(params.uploadId || "");
  const partNumber = Number(params.partNumber || 0);

  if (!videoSourceKeyBelongsToClient(key, clientId)) throw new Error("invalid_video_key");
  if (!uploadId) throw new Error("upload_id_required");
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    throw new Error("invalid_part_number");
  }
  if (!request.body) throw new Error("empty_video_part");

  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > 12 * 1024 * 1024) throw new Error("video_part_too_large");

  const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
  const part = await upload.uploadPart(partNumber, request.body);
  return { partNumber: part.partNumber, etag: part.etag };
}

export async function abortR2VideoUpload(env, clientId, key, uploadId) {
  if (!env.MEDIA) throw new Error("r2_unavailable");
  if (!videoSourceKeyBelongsToClient(key, clientId)) throw new Error("invalid_video_key");
  if (!uploadId) throw new Error("upload_id_required");
  const upload = env.MEDIA.resumeMultipartUpload(String(key), String(uploadId));
  await upload.abort();
  return { aborted: true };
}

export async function completeR2VideoUpload(env, clientId, input = {}) {
  if (!env.MEDIA) throw new Error("r2_unavailable");

  const key = String(input.key || "");
  const uploadId = String(input.uploadId || "");
  if (!videoSourceKeyBelongsToClient(key, clientId)) throw new Error("invalid_video_key");
  if (!uploadId) throw new Error("upload_id_required");

  const rawParts = Array.isArray(input.parts) ? input.parts : [];
  if (!rawParts.length || rawParts.length > 10000) throw new Error("video_parts_required");
  const parts = rawParts.map(part => ({
    partNumber: Number(part?.partNumber || 0),
    etag: String(part?.etag || "")
  }));
  if (parts.some(part => !Number.isInteger(part.partNumber) || part.partNumber < 1 || !part.etag)) {
    throw new Error("invalid_video_parts");
  }
  parts.sort((a, b) => a.partNumber - b.partNumber);

  const size = Number(input.size || 0);
  if (!Number.isFinite(size) || size <= 0) throw new Error("video_size_required");
  if (size > MAX_VIDEO_BYTES) throw new Error("video_too_large");

  const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
  const object = await upload.complete(parts);

  const settings = normalizeSettings(input.settings, {
    fileName: input.fileName,
    contentType: input.contentType,
    size
  });
  settings.folderId = await validFolderId(env, clientId, settings.folderId);

  const jobId = "vid_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const result = {
    progress: 100,
    storage: "r2",
    objectEtag: object.httpEtag || "",
    message: "Vídeo salvo na biblioteca. Configure os cortes antes de iniciar."
  };

  try {
    await env.DB.prepare(
      `INSERT INTO video_jobs(id,client_id,source_object_key,status,settings_json,result_json,created_at,updated_at)
       VALUES(?1,?2,?3,'awaiting_configuration',?4,?5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    ).bind(jobId, String(clientId), key, JSON.stringify(settings), JSON.stringify(result)).run();
  } catch (error) {
    await env.MEDIA.delete(key).catch(() => {});
    throw error;
  }

  return { jobId, objectKey: key, etag: object.httpEtag || "" };
}


function unsafeRemoteVideoHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const a = Number(ipv4[1]), b = Number(ipv4[2]);
  return a === 10
    || a === 127
    || a === 0
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

async function fetchAuthorizedVideoSource(inputUrl) {
  let current;
  try {
    current = new URL(String(inputUrl || ""));
  } catch {
    throw new Error("video_url_invalid");
  }
  if (current.protocol !== "https:") throw new Error("video_url_https_required");

  for (let redirects = 0; redirects <= 5; redirects++) {
    if (unsafeRemoteVideoHost(current.hostname)) throw new Error("video_url_not_allowed");
    const response = await fetch(current.toString(), {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "video/mp4,video/webm,video/quicktime,video/x-matroska,application/octet-stream;q=0.8,*/*;q=0.2"
      }
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("video_source_redirect_invalid");
      current = new URL(location, current);
      if (current.protocol !== "https:") throw new Error("video_url_https_required");
      continue;
    }

    if (!response.ok) throw new Error("video_source_http_" + response.status);
    return { response, finalUrl: current };
  }
  throw new Error("video_source_too_many_redirects");
}

function fileNameFromRemote(response, finalUrl, fallbackTitle = "") {
  const disposition = String(response.headers.get("content-disposition") || "");
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return cleanFileName(decodeURIComponent(encoded)); } catch {}
  }
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  if (plain) return cleanFileName(plain);
  const pathnameName = String(finalUrl.pathname || "").split("/").filter(Boolean).pop() || "";
  if (pathnameName) {
    try { return cleanFileName(decodeURIComponent(pathnameName)); } catch { return cleanFileName(pathnameName); }
  }
  return cleanFileName(String(fallbackTitle || "video"));
}


function youtubeVideoIdFromUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:") return "";
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";
    if (host !== "youtube.com") return "";
    if (url.pathname === "/watch") return url.searchParams.get("v") || "";
    const parts = url.pathname.split("/").filter(Boolean);
    if (["shorts","embed","live"].includes(parts[0]) && parts[1]) return parts[1];
  } catch {}
  return "";
}


const PIPED_STREAM_APIS = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.tokhmi.xyz",
  "https://pipedapi.moomoo.me",
  "https://pipedapi.syncpundit.io",
  "https://api-piped.mha.fi",
  "https://piped-api.garudalinux.org",
  "https://pipedapi.rivo.lol",
  "https://pipedapi.leptons.xyz"
];


async function pipedMuxedStream(sourceUrl) {
  const videoId = youtubeVideoIdFromUrl(sourceUrl);
  if (!videoId) throw new Error("trailer_video_id_missing");

  const attemptInstance = async base => {
    const response = await fetch(base + "/streams/" + encodeURIComponent(videoId), {
      headers: { accept: "application/json", "user-agent": "NEXUS-AI/2.3" },
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) throw new Error("piped_streams_" + response.status);
    const payload = await response.json().catch(() => ({}));

    const streams = (Array.isArray(payload?.videoStreams) ? payload.videoStreams : [])
      .filter(item => item?.url && item?.videoOnly !== true)
      .map(item => {
        const quality = Number(String(item?.quality || "").match(/\d+/)?.[0] || 0);
        const bytes = Number(item?.contentLength || 0);
        const mime = String(item?.mimeType || "").toLowerCase();
        const format = String(item?.format || "").toUpperCase();
        return { ...item, quality, bytes, mime, format };
      })
      .filter(item => !item.bytes || item.bytes <= MAX_VIDEO_BYTES)
      .sort((a, b) => {
        const aMp4 = a.mime.includes("mp4") || a.format.includes("MP4") || a.format.includes("MPEG_4") ? 1 : 0;
        const bMp4 = b.mime.includes("mp4") || b.format.includes("MP4") || b.format.includes("MPEG_4") ? 1 : 0;
        const aQ = a.quality <= 480 ? a.quality : 0;
        const bQ = b.quality <= 480 ? b.quality : 0;
        return (bMp4 - aMp4) || (bQ - aQ) || (a.bytes - b.bytes);
      })
      .slice(0, 3);

    if (!streams.length) throw new Error("piped_no_muxed_stream");

    const fetchStream = async stream => {
      const mediaUrl = new URL(String(stream.url), base);
      if (mediaUrl.protocol !== "https:" || unsafeRemoteVideoHost(mediaUrl.hostname)) {
        throw new Error("piped_stream_not_allowed");
      }
      const media = await fetch(mediaUrl.toString(), {
        headers: { accept: "video/*,*/*;q=0.8", "user-agent": "Mozilla/5.0 NEXUS-AI/2.3" },
        signal: AbortSignal.timeout(15000)
      });
      if (!media.ok || !media.body) throw new Error("piped_media_" + media.status);

      const declaredLength = Number(media.headers.get("content-length") || stream.bytes || 0);
      if (!declaredLength || declaredLength > MAX_VIDEO_BYTES) {
        try { await media.body.cancel(); } catch {}
        throw new Error(declaredLength > MAX_VIDEO_BYTES ? "video_too_large" : "trailer_size_unknown");
      }

      const contentType = String(media.headers.get("content-type") || stream.mime || "video/mp4")
        .toLowerCase().split(";")[0].trim();
      const extension = contentType.includes("webm") ? "webm" : "mp4";
      return {
        response: media,
        videoId,
        host: new URL(base).hostname,
        extension,
        contentType: contentType.startsWith("video/") ? contentType : (extension === "webm" ? "video/webm" : "video/mp4"),
        size: declaredLength,
        resolver: "piped"
      };
    };

    return Promise.any(streams.map(fetchStream));
  };

  return Promise.any(PIPED_STREAM_APIS.map(attemptInstance));
}

async function invidiousMuxedStream(sourceUrl) {
  const videoId = youtubeVideoIdFromUrl(sourceUrl);
  if (!videoId) throw new Error("invalid_trailer_url");

  const instances = [
    "inv.nadeko.net",
    "invidious.nerdvpn.de",
    "yt.chocolatemoo53.com",
    "invidious.tiekoetter.com"
  ];

  const attemptInstance = async host => {
    const base = "https://" + host;
    const api = await fetch(base + "/api/v1/videos/" + encodeURIComponent(videoId) + "?local=1&region=BR", {
      headers: { accept: "application/json", "user-agent": "NEXUS-AI-Trailer-Resolver/2.3" },
      signal: AbortSignal.timeout(4000)
    });
    if (!api.ok) throw new Error("invidious_api_" + api.status);

    const payload = await api.json().catch(() => ({}));
    const streams = (Array.isArray(payload?.formatStreams) ? payload.formatStreams : [])
      .filter(item => item?.url)
      .map(item => {
        const quality = Number(String(item.qualityLabel || item.quality || "").match(/\d+/)?.[0] || 0);
        const bytes = Number(item.clength || item.contentLength || 0);
        const container = String(item.container || "").toLowerCase();
        return { ...item, quality, bytes, container };
      })
      .filter(item => !item.bytes || item.bytes <= MAX_VIDEO_BYTES)
      .sort((a, b) => {
        const aMp4 = a.container === "mp4" ? 1 : 0;
        const bMp4 = b.container === "mp4" ? 1 : 0;
        const aQ = a.quality <= 480 ? a.quality : 0;
        const bQ = b.quality <= 480 ? b.quality : 0;
        return (bMp4 - aMp4) || (bQ - aQ) || (a.bytes - b.bytes);
      })
      .slice(0, 3);

    if (!streams.length) throw new Error("invidious_no_stream");

    const fetchStream = async stream => {
      const mediaUrl = new URL(String(stream.url), base);
      const hostName = mediaUrl.hostname.toLowerCase();
      const allowedHost = hostName === host
        || hostName.endsWith(".googlevideo.com")
        || hostName === "googlevideo.com";
      if (mediaUrl.protocol !== "https:" || !allowedHost || unsafeRemoteVideoHost(hostName)) {
        throw new Error("invidious_stream_not_allowed");
      }

      const media = await fetch(mediaUrl.toString(), {
        headers: {
          accept: "video/*,*/*;q=0.8",
          referer: base + "/watch?v=" + encodeURIComponent(videoId),
          "user-agent": "Mozilla/5.0 NEXUS-AI/2.3"
        },
        signal: AbortSignal.timeout(15000)
      });
      if (!media.ok || !media.body) throw new Error("invidious_media_" + media.status);

      const declaredLength = Number(media.headers.get("content-length") || stream.bytes || 0);
      if (!declaredLength || declaredLength > MAX_VIDEO_BYTES) {
        try { await media.body.cancel(); } catch {}
        throw new Error(declaredLength > MAX_VIDEO_BYTES ? "video_too_large" : "trailer_size_unknown");
      }

      const contentType = String(media.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
      const extension = stream.container === "webm" || contentType.includes("webm") ? "webm" : "mp4";
      return {
        response: media,
        videoId,
        host,
        extension,
        contentType: contentType.startsWith("video/") ? contentType : (extension === "webm" ? "video/webm" : "video/mp4"),
        size: declaredLength,
        resolver: "invidious"
      };
    };

    return Promise.any(streams.map(fetchStream));
  };

  return Promise.any(instances.map(attemptInstance));
}

async function youtubeMuxedStream(sourceUrl) {
  try {
    return await Promise.any([
      pipedMuxedStream(sourceUrl),
      invidiousMuxedStream(sourceUrl)
    ]);
  } catch {
    throw new Error("youtube_stream_resolve_failed");
  }
}

export async function createR2PublicTrailerImportJob(env, clientId, input = {}) {
  const sourceUrl = String(input.url || input.trailerUrl || "").trim();
  if (!youtubeVideoIdFromUrl(sourceUrl)) throw new Error("invalid_trailer_url");

  const title = String(input.contentTitle || "video-youtube").trim().slice(0, 160) || "video-youtube";
  const settings = normalizeSettings(input, {
    fileName: title + ".mp4",
    contentType: "video/mp4",
    size: 0
  });
  settings.folderId = await validFolderId(env, clientId, settings.folderId);
  settings.sourceType = "youtube-public";
  settings.sourceUrl = sourceUrl.slice(0, 1200);
  settings.importAttempts = 0;

  const jobId = "vid_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const result = {
    progress: 5,
    storage: "r2",
    importAttempts: 0,
    message: "Importando vídeo do YouTube para a biblioteca.",
    error: ""
  };

  await env.DB.prepare(
    `INSERT INTO video_jobs(id,client_id,source_object_key,status,settings_json,result_json,created_at,updated_at)
     VALUES(?1,?2,'','importing',?3,?4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
  ).bind(jobId, String(clientId), JSON.stringify(settings), JSON.stringify(result)).run();

  return { jobId };
}

export async function processR2PublicTrailerImportJob(env, clientId, jobId) {
  if (!env.MEDIA) throw new Error("r2_unavailable");
  const row = await env.DB.prepare(
    "SELECT id,client_id,status,settings_json,result_json FROM video_jobs WHERE id=?1 AND client_id=?2 LIMIT 1"
  ).bind(String(jobId), String(clientId)).first();
  if (!row || String(row.status) !== "importing") return { skipped: true };

  const settings = (() => { try { return JSON.parse(String(row.settings_json || "{}")); } catch { return {}; } })();
  const result = (() => { try { return JSON.parse(String(row.result_json || "{}")); } catch { return {}; } })();
  const attempt = Math.max(Number(settings.importAttempts || result.importAttempts || 0), 0) + 1;
  settings.importAttempts = attempt;

  await env.DB.prepare(
    "UPDATE video_jobs SET settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
  ).bind(
    row.id,
    row.client_id,
    JSON.stringify(settings),
    JSON.stringify({ ...result, progress: 10, importAttempts: attempt, message: "Localizando o vídeo no YouTube · tentativa " + attempt + " de 3.", error: "" })
  ).run();

  let key = "";
  try {
    const resolved = await youtubeMuxedStream(settings.sourceUrl);
    await env.DB.prepare(
      "UPDATE video_jobs SET result_json=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
    ).bind(
      row.id,
      row.client_id,
      JSON.stringify({ ...result, progress: 35, importAttempts: attempt, message: "Vídeo localizado. Transferindo para o R2.", error: "" })
    ).run();
    key = videoKeyPrefix(clientId) + crypto.randomUUID() + "." + resolved.extension;

    const object = await env.MEDIA.put(key, resolved.response.body, {
      httpMetadata: { contentType: resolved.contentType, cacheControl: "private, no-store" },
      customMetadata: {
        clientId: String(clientId),
        originalName: cleanFileName((settings.contentTitle || "video-youtube") + "." + resolved.extension),
        sourceHost: "youtube.com",
        sourceVideoId: resolved.videoId,
        resolver: resolved.resolver || resolved.host,
        kind: "video-source"
      }
    });
    if (!object) throw new Error("trailer_store_failed");
    if (Number(object.size || resolved.size || 0) > MAX_VIDEO_BYTES) {
      await env.MEDIA.delete(key).catch(() => {});
      throw new Error("video_too_large");
    }

    settings.fileSize = Number(object.size || resolved.size || 0);
    settings.contentType = resolved.contentType;
    settings.filename = cleanFileName((settings.contentTitle || "video-youtube") + "." + resolved.extension);
    settings.displayName = settings.filename;

    await env.DB.prepare(
      "UPDATE video_jobs SET source_object_key=?3,status='queued',settings_json=?4,result_json=?5,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
    ).bind(
      row.id,
      row.client_id,
      key,
      JSON.stringify(settings),
      JSON.stringify({
        ...result,
        progress: 50,
        storage: "r2",
        objectEtag: object.httpEtag || "",
        resolver: resolved.resolver || resolved.host,
        importAttempts: attempt,
        message: "Vídeo recebido no R2. Iniciando análise e cortes.",
        error: ""
      })
    ).run();
    return { ok: true, jobId: row.id };
  } catch (cause) {
    if (key) await env.MEDIA.delete(key).catch(() => {});
    const code = String(cause instanceof Error ? cause.message : cause);
    const retry = attempt < 3;
    await env.DB.prepare(
      "UPDATE video_jobs SET status=?3,settings_json=?4,result_json=?5,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
    ).bind(
      row.id,
      row.client_id,
      retry ? "importing" : "failed",
      JSON.stringify(settings),
      JSON.stringify({
        ...result,
        progress: retry ? 5 : 0,
        importAttempts: attempt,
        message: retry
          ? "A origem não respondeu. O NEXUS tentará novamente automaticamente."
          : "Não foi possível importar este vídeo do YouTube após 3 tentativas.",
        error: code.slice(0, 500)
      })
    ).run();
    return { ok: false, retry, error: code };
  }
}

export async function processQueuedVideoImports(env, limit = 1) {
  if (!env?.DB || !env.MEDIA) return { processed: 0 };
  const rows = await env.DB.prepare(
    "SELECT id,client_id FROM video_jobs WHERE status='importing' ORDER BY updated_at ASC LIMIT ?1"
  ).bind(Math.max(1, Math.min(2, Number(limit || 1)))).all();
  let processed = 0;
  for (const row of rows?.results || []) {
    await processR2PublicTrailerImportJob(env, row.client_id, row.id).catch(() => {});
    processed += 1;
  }
  return { processed };
}

export async function importR2PublicTrailer(env, clientId, input = {}) {
  if (!env.MEDIA) throw new Error("r2_unavailable");

  const sourceUrl = String(input.url || input.trailerUrl || "").trim();
  if (!sourceUrl) throw new Error("trailer_url_required");

  const resolved = await youtubeMuxedStream(sourceUrl);
  const key = videoKeyPrefix(clientId) + crypto.randomUUID() + "." + resolved.extension;
  const title = String(input.contentTitle || "trailer").trim().slice(0, 160) || "trailer";

  let object;
  try {
    object = await env.MEDIA.put(key, resolved.response.body, {
      httpMetadata: {
        contentType: resolved.contentType,
        cacheControl: "private, no-store"
      },
      customMetadata: {
        clientId: String(clientId),
        originalName: cleanFileName(title + "." + resolved.extension),
        sourceHost: "youtube.com",
        sourceVideoId: resolved.videoId,
        resolver: resolved.host,
        kind: "video-source"
      }
    });
  } catch {
    throw new Error("trailer_store_failed");
  }

  if (!object) throw new Error("trailer_store_failed");
  if (Number(object.size || resolved.size || 0) > MAX_VIDEO_BYTES) {
    await env.MEDIA.delete(key).catch(() => {});
    throw new Error("video_too_large");
  }

  const settings = normalizeSettings(input, {
    fileName: title + "." + resolved.extension,
    contentType: resolved.contentType,
    size: Number(object.size || resolved.size || 0)
  });
  settings.folderId = await validFolderId(env, clientId, settings.folderId);
  settings.sourceType = "youtube-trailer";
  settings.sourceUrl = sourceUrl.slice(0, 1200);

  const jobId = "vid_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const result = {
    progress: 100,
    storage: "r2",
    objectEtag: object.httpEtag || "",
    resolver: "invidious",
    message: "Trailer recebido na biblioteca. Iniciando cortes."
  };

  try {
    await env.DB.prepare(
      `INSERT INTO video_jobs(id,client_id,source_object_key,status,settings_json,result_json,created_at,updated_at)
       VALUES(?1,?2,?3,'awaiting_configuration',?4,?5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    ).bind(jobId, String(clientId), key, JSON.stringify(settings), JSON.stringify(result)).run();
  } catch (error) {
    await env.MEDIA.delete(key).catch(() => {});
    throw error;
  }

  return { jobId, objectKey: key, etag: object.httpEtag || "", source: "youtube-trailer" };
}

export async function importR2VideoFromUrl(env, clientId, input = {}) {
  if (!env.MEDIA) throw new Error("r2_unavailable");

  const { response, finalUrl } = await fetchAuthorizedVideoSource(input.url);
  const contentType = String(response.headers.get("content-type") || "application/octet-stream")
    .toLowerCase().split(";")[0].trim();
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_VIDEO_BYTES) {
    try { await response.body?.cancel(); } catch {}
    throw new Error("video_too_large");
  }

  const fileName = fileNameFromRemote(response, finalUrl, input?.settings?.contentTitle || input?.contentTitle);
  const extension = extensionForVideo(fileName, contentType);
  if (!extension) {
    try { await response.body?.cancel(); } catch {}
    throw new Error("video_source_not_direct_media");
  }
  if (!response.body) throw new Error("video_source_empty");

  const key = videoKeyPrefix(clientId) + crypto.randomUUID() + "." + extension;
  let object;
  try {
    object = await env.MEDIA.put(key, response.body, {
      httpMetadata: {
        contentType: contentType || "application/octet-stream",
        cacheControl: "private, no-store"
      },
      customMetadata: {
        clientId: String(clientId),
        originalName: fileName.slice(0, 256),
        sourceHost: String(finalUrl.hostname || "").slice(0, 200),
        kind: "video-source"
      }
    });
  } catch (error) {
    throw new Error("video_source_store_failed");
  }
  if (!object) throw new Error("video_source_store_failed");
  if (Number(object.size || 0) > MAX_VIDEO_BYTES) {
    await env.MEDIA.delete(key).catch(() => {});
    throw new Error("video_too_large");
  }

  const settingsInput = {
    ...(input.settings && typeof input.settings === "object" ? input.settings : {}),
    ...input
  };
  delete settingsInput.url;
  delete settingsInput.settings;

  const settings = normalizeSettings(settingsInput, {
    fileName,
    contentType,
    size: Number(object.size || declaredSize || 0)
  });
  settings.folderId = await validFolderId(env, clientId, settings.folderId);
  settings.remoteSourceHost = String(finalUrl.hostname || "").slice(0, 200);

  const jobId = "vid_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const result = {
    progress: 100,
    storage: "r2",
    objectEtag: object.httpEtag || "",
    message: "Vídeo importado para a biblioteca. Configure os cortes antes de iniciar."
  };

  try {
    await env.DB.prepare(
      `INSERT INTO video_jobs(id,client_id,source_object_key,status,settings_json,result_json,created_at,updated_at)
       VALUES(?1,?2,?3,'awaiting_configuration',?4,?5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    ).bind(jobId, String(clientId), key, JSON.stringify(settings), JSON.stringify(result)).run();
  } catch (error) {
    await env.MEDIA.delete(key).catch(() => {});
    throw error;
  }

  return { jobId, objectKey: key, etag: object.httpEtag || "" };
}
