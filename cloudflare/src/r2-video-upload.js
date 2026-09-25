const MAX_VIDEO_BYTES = 750 * 1024 * 1024;
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
