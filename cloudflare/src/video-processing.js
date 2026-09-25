import { openAIResponses } from "./openai.js";
import { openAIKeyForClient } from "./openai-routing.js";
import { publishInstagramVideo } from "./publisher.js";

const MAX_MEDIA_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_ANALYSIS_SECONDS = 10 * 60;
const AUDIO_WINDOW_SECONDS = 60;
const MAX_CLIP_SECONDS = 60;
const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function clamp(value, min, max) {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : min));
}

function seconds(value) {
  return Math.round(Math.max(0, Number(value || 0)) * 10) / 10 + "s";
}

function cleanText(value, max = 2200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + chunk)));
  }
  return btoa(binary);
}

function vttTimeToSeconds(value) {
  const parts = String(value || "").trim().replace(",", ".").split(":").map(Number);
  if (parts.some(part => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(parts[0] || 0);
}

function vttFromWhisper(result) {
  if (typeof result?.vtt === "string") return result.vtt;
  if (typeof result?.transcription_info?.vtt === "string") return result.transcription_info.vtt;
  if (Array.isArray(result?.segments)) {
    return result.segments.map(segment => String(segment?.vtt || "")).filter(Boolean).join("\n");
  }
  return "";
}

function textFromWhisper(result) {
  return cleanText(
    result?.text
    || result?.transcription_info?.text
    || (Array.isArray(result?.segments)
      ? result.segments.map(segment => segment?.text || "").join(" ")
      : ""),
    16000
  );
}

function parseVtt(vtt, offsetSeconds) {
  const lines = String(vtt || "").split(/\r?\n/);
  const segments = [];
  for (let index = 0; index < lines.length; index += 1) {
    const timing = lines[index].match(/([0-9:. ,]+)\s+-->\s+([0-9:. ,]+)/);
    if (!timing) continue;
    const textLines = [];
    for (let next = index + 1; next < lines.length && lines[next].trim(); next += 1) {
      if (!/^\d+$/.test(lines[next].trim())) textLines.push(lines[next].trim());
    }
    const text = cleanText(textLines.join(" "), 1200);
    if (!text) continue;
    segments.push({
      start: offsetSeconds + vttTimeToSeconds(timing[1]),
      end: offsetSeconds + vttTimeToSeconds(timing[2]),
      text
    });
  }
  return segments;
}

function responseText(result) {
  if (typeof result?.output_text === "string" && result.output_text.trim()) return result.output_text.trim();
  const chunks = [];
  for (const item of Array.isArray(result?.output) ? result.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function jsonObjectFromText(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch {}
  }
  return null;
}

function outputTransform(format) {
  if (format === "feed") return { width: 1080, height: 1350, fit: "cover" };
  if (format === "square") return { width: 1080, height: 1080, fit: "cover" };
  return { width: 720, height: 1280, fit: "cover" };
}

function transcriptSummary(segments) {
  return segments.map(segment => (
    "[" + segment.start.toFixed(1) + "s-" + segment.end.toFixed(1) + "s] " + segment.text
  )).join("\n").slice(0, 48000);
}

function fallbackCandidates(segments, requestedClips, clipDuration) {
  const keywords = /(segredo|importante|atenção|erro|melhor|pior|como|porque|por quê|nunca|sempre|resultado|dica|vale|precisa|descobri|incrível|problema|solução|você)/i;
  const candidates = segments.map(segment => ({
    ...segment,
    score: Math.min(100, 45 + Math.min(35, segment.text.length / 5) + (keywords.test(segment.text) ? 20 : 0))
  })).sort((a, b) => b.score - a.score);

  const chosen = [];
  for (const candidate of candidates) {
    let start = Math.max(0, candidate.start - 2);
    start = Math.min(start, Math.max(0, MAX_ANALYSIS_SECONDS - clipDuration));
    if (chosen.some(item => Math.abs(item.start - start) < Math.max(8, clipDuration / 2))) continue;
    const end = Math.min(MAX_ANALYSIS_SECONDS, start + clipDuration);
    chosen.push({
      start,
      end,
      title: cleanText(candidate.text, 70) || "Melhor corte",
      reason: "Trecho com fala relevante e bom potencial de retenção.",
      hook: cleanText(candidate.text, 120),
      caption: cleanText(candidate.text, 500),
      qualityScore: Math.round(candidate.score)
    });
    if (chosen.length >= requestedClips) break;
  }

  if (!chosen.length) {
    for (let index = 0; index < requestedClips; index += 1) {
      const start = index * clipDuration;
      if (start >= MAX_ANALYSIS_SECONDS) break;
      chosen.push({
        start,
        end: Math.min(MAX_ANALYSIS_SECONDS, start + clipDuration),
        title: "Opção " + (index + 1),
        reason: "Corte distribuído automaticamente pelo NEXUS.",
        hook: "",
        caption: "",
        qualityScore: 50
      });
    }
  }
  return chosen;
}

async function intelligentCandidates(env, clientId, settings, segments) {
  const requestedClips = Math.round(clamp(settings.requestedClips || settings.clips || 3, 1, 12));
  const clipDuration = Math.round(clamp(settings.clipDuration || settings.duration || 30, 10, MAX_CLIP_SECONDS));
  const fallback = fallbackCandidates(segments, requestedClips, clipDuration);
  if (!segments.length) return fallback;

  const prompt = [
    "Você é o editor de vídeo do NEXUS AI.",
    "Escolha " + requestedClips + " cortes fortes para Instagram.",
    "Objetivo: " + String(settings.goal || "viral") + ".",
    "Cada corte deve ter de 10 a " + clipDuration + " segundos, preservar começo compreensível e terminar a ideia sem cortar a fala no meio.",
    "Não invente falas. Use somente os tempos da transcrição.",
    "Priorize gancho, clareza, emoção, utilidade e conclusão natural.",
    "Responda APENAS JSON no formato:",
    '{"clips":[{"start":12.0,"end":42.0,"title":"...","reason":"...","hook":"...","caption":"...","qualityScore":88}]}',
    "TRANSCRIÇÃO:",
    transcriptSummary(segments)
  ].join("\n");

  try {
    const response = await openAIResponses(env, clientId, {
      model: "gpt-5.6-luna",
      input: prompt
    });
    const parsed = jsonObjectFromText(responseText(response));
    const rawClips = Array.isArray(parsed?.clips) ? parsed.clips : [];
    const validated = [];
    for (const raw of rawClips) {
      let start = clamp(raw?.start, 0, MAX_ANALYSIS_SECONDS - 10);
      let end = clamp(raw?.end, start + 10, MAX_ANALYSIS_SECONDS);
      if (end - start > clipDuration) end = start + clipDuration;
      if (end - start < 10) end = Math.min(MAX_ANALYSIS_SECONDS, start + 10);
      if (validated.some(item => Math.abs(item.start - start) < 5)) continue;
      validated.push({
        start,
        end,
        title: cleanText(raw?.title, 100) || "Melhor corte",
        reason: cleanText(raw?.reason, 260) || "Trecho selecionado pela IA.",
        hook: cleanText(raw?.hook, 180),
        caption: cleanText(raw?.caption, 1200),
        qualityScore: Math.round(clamp(raw?.qualityScore || 80, 1, 100))
      });
      if (validated.length >= requestedClips) break;
    }
    return validated.length ? [...validated, ...fallback]
      .filter((item, index, all) => all.findIndex(other => Math.abs(other.start - item.start) < 5) === index)
      .slice(0, requestedClips) : fallback;
  } catch {
    return fallback;
  }
}

async function jobRow(env, clientId, jobId) {
  return env.DB.prepare(
    "SELECT id,client_id,source_object_key,status,settings_json,result_json FROM video_jobs WHERE id=?1 AND client_id=?2 LIMIT 1"
  ).bind(String(jobId), String(clientId)).first();
}

async function setJob(env, row, status, settings, result) {
  await env.DB.prepare(
    "UPDATE video_jobs SET status=?3,settings_json=?4,result_json=?5,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
  ).bind(row.id, row.client_id, status, JSON.stringify(settings), JSON.stringify(result)).run();
}

async function transcribeVideo(env, clientId, sourceKey, requestedClips) {
  const apiKey = openAIKeyForClient(env, clientId);
  if (!apiKey) return { segments: [], language: "", windows: 0 };

  const segments = [];
  let language = "";
  let emptyStreak = 0;
  const maxWindows = Math.min(10, Math.max(3, Math.round(requestedClips) * 2));

  for (let index = 0; index < maxWindows; index += 1) {
    const offset = index * AUDIO_WINDOW_SECONDS;
    const source = await env.MEDIA.get(sourceKey);
    if (!source?.body) throw new Error("video_source_missing");

    try {
      const transformed = env.VIDEO_MEDIA.input(source.body).output({
        mode: "audio",
        time: seconds(offset),
        duration: seconds(AUDIO_WINDOW_SECONDS),
        format: "m4a"
      });
      const audioResponse = await transformed.response();
      if (!audioResponse.ok) {
        if (index === 0) throw new Error("video_audio_extract_failed");
        break;
      }

      const buffer = await audioResponse.arrayBuffer();
      if (!buffer.byteLength) break;

      const form = new FormData();
      form.append("file", new Blob([buffer], { type: "audio/mp4" }), "audio-" + index + ".m4a");
      form.append("model", "whisper-1");
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "segment");

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: "Bearer " + apiKey },
        body: form
      });
      const transcript = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (index === 0) throw new Error("openai_transcription_http_" + response.status);
        break;
      }

      const text = cleanText(transcript?.text || "", 16000);
      const rawSegments = Array.isArray(transcript?.segments) ? transcript.segments : [];
      if (rawSegments.length) {
        for (const segment of rawSegments) {
          const segmentText = cleanText(segment?.text || "", 1200);
          if (!segmentText) continue;
          segments.push({
            start: offset + Number(segment?.start || 0),
            end: offset + Number(segment?.end || 0),
            text: segmentText
          });
        }
      } else if (text) {
        segments.push({ start: offset, end: offset + AUDIO_WINDOW_SECONDS, text });
      }

      language = String(transcript?.language || language || "");
      if (!text) emptyStreak += 1;
      else emptyStreak = 0;
      if (index > 0 && emptyStreak >= 2) break;
    } catch (error) {
      if (index === 0) throw error;
      break;
    }
  }

  return {
    segments,
    language,
    windows: Math.ceil((segments.at(-1)?.end || 0) / AUDIO_WINDOW_SECONDS)
  };
}

async function clearOldClips(env, clientId, jobId) {
  const existing = await env.DB.prepare(
    "SELECT output_object_key FROM video_clips WHERE client_id=?1 AND job_id=?2"
  ).bind(String(clientId), String(jobId)).all();
  const keys = (existing?.results || []).map(row => String(row.output_object_key || ""))
    .filter(key => key.startsWith("videos/" + clientId + "/"));
  await env.DB.prepare("DELETE FROM video_clips WHERE client_id=?1 AND job_id=?2")
    .bind(String(clientId), String(jobId)).run();
  if (keys.length) await env.MEDIA.delete([...new Set(keys)]).catch(() => {});
}

async function renderClip(env, row, settings, candidate, rank) {
  const source = await env.MEDIA.get(row.source_object_key);
  if (!source?.body) throw new Error("video_source_missing");
  const duration = clamp(candidate.end - candidate.start, 1, MAX_CLIP_SECONDS);
  const transform = outputTransform(String(settings.outputFormat || "reel"));
  const transformed = env.VIDEO_MEDIA.input(source.body)
    .transform(transform)
    .output({
      mode: "video",
      time: seconds(candidate.start),
      duration: seconds(duration),
      audio: true
    });

  const clipId = "clip_" + crypto.randomUUID().replace(/-/g, "").slice(0, 18);
  const outputKey = "videos/" + row.client_id + "/clips/" + row.id + "/" + clipId + ".mp4";
  const mediaStream = await transformed.media();
  const contentType = await transformed.contentType();

  await env.MEDIA.put(outputKey, mediaStream, {
    httpMetadata: {
      contentType: contentType || "video/mp4",
      cacheControl: "private, no-store"
    },
    customMetadata: {
      clientId: String(row.client_id),
      jobId: String(row.id),
      clipId,
      kind: "video-clip"
    }
  });

  const clipSettings = {
    start: Number(candidate.start.toFixed(1)),
    end: Number((candidate.start + duration).toFixed(1)),
    title: cleanText(candidate.title, 100) || "Opção " + rank,
    caption: cleanText(candidate.caption, 2200),
    endText: cleanText(settings.endText, 90),
    endContact: cleanText(settings.endContact, 90),
    selectedForSchedule: false,
    outputFormat: String(settings.outputFormat || "reel")
  };
  const clipResult = {
    previewUrl: "/media/" + outputKey,
    rank,
    reason: cleanText(candidate.reason, 320),
    hook: cleanText(candidate.hook, 180),
    transcript: cleanText(candidate.transcript || candidate.hook || "", 1200),
    qualityScore: Math.round(clamp(candidate.qualityScore || 75, 1, 100)),
    subtitlesApplied: false,
    processor: "cloudflare-media"
  };

  await env.DB.prepare(
    `INSERT INTO video_clips(
      id,job_id,client_id,source_object_key,output_object_key,status,approval_status,publish_status,
      settings_json,result_json,created_at,updated_at
    ) VALUES(?1,?2,?3,?4,?5,'ready','pending','draft',?6,?7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
  ).bind(
    clipId,
    row.id,
    row.client_id,
    row.source_object_key,
    outputKey,
    JSON.stringify(clipSettings),
    JSON.stringify(clipResult)
  ).run();

  return { id: clipId, outputKey };
}

export async function enqueueVideoProcessing(env, clientId, jobId, patch = {}) {
  if (!env.MEDIA) throw new Error("r2_unavailable");
  if (!env.VIDEO_MEDIA) throw new Error("cloudflare_media_unavailable");
  const row = await jobRow(env, clientId, jobId);
  if (!row) throw new Error("video_not_found");

  if (row.status === "queued") return { queued: true, id: row.id, status: "queued", reused: true };
  if (row.status === "processing") return { queued: true, id: row.id, status: "processing", reused: true };
  if (row.status === "ready") return { queued: false, id: row.id, status: "ready", reused: true };

  const settings = { ...parseJson(row.settings_json, {}), ...(patch && typeof patch === "object" ? patch : {}) };
  settings.clipDuration = Math.round(clamp(settings.duration || settings.clipDuration || 30, 10, MAX_CLIP_SECONDS));
  settings.duration = settings.clipDuration;
  settings.requestedClips = Math.round(clamp(settings.clips || settings.requestedClips || 3, 1, 12));
  settings.clips = settings.requestedClips;
  settings.outputFormat = ["reel", "feed", "square"].includes(String(settings.outputFormat))
    ? String(settings.outputFormat) : "reel";

  const head = await env.MEDIA.head(row.source_object_key);
  if (!head) throw new Error("video_source_missing");
  if (Number(head.size || 0) > MAX_MEDIA_SOURCE_BYTES) throw new Error("cloudflare_media_source_too_large");

  const result = {
    ...parseJson(row.result_json, {}),
    progress: 5,
    processor: "cloudflare",
    message: "Análise iniciada no Cloudflare. O NEXUS está escolhendo os melhores trechos.",
    error: ""
  };
  await setJob(env, row, "queued", settings, result);
  return { queued: true, id: row.id };
}

export async function processVideoJob(env, clientId, jobId) {
  const row = await jobRow(env, clientId, jobId);
  if (!row) throw new Error("video_not_found");
  if (row.status !== "queued") return { skipped: true, status: row.status };

  const settings = parseJson(row.settings_json, {});
  const baseResult = parseJson(row.result_json, {});
  const claimed = await env.DB.prepare(
    "UPDATE video_jobs SET status='processing',result_json=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2 AND status='queued'"
  ).bind(
    row.id,
    row.client_id,
    JSON.stringify({ ...baseResult, progress: 12, message: "Transcrevendo e analisando o vídeo.", error: "" })
  ).run();
  if (!Number(claimed?.meta?.changes || 0)) return { skipped: true, status: "already_claimed" };

  try {
    const requested = Math.round(clamp(settings.requestedClips || settings.clips || 3, 1, 12));
    const transcript = await transcribeVideo(env, row.client_id, row.source_object_key, requested);
    await setJob(env, row, "processing", settings, {
      ...baseResult,
      progress: 45,
      detectedLanguage: transcript.language,
      message: "Transcrição concluída. Selecionando os cortes com melhor potencial.",
      error: ""
    });

    const candidates = await intelligentCandidates(env, row.client_id, settings, transcript.segments);
    await clearOldClips(env, row.client_id, row.id);

    const rendered = [];
    for (let index = 0; index < candidates.length && rendered.length < requested; index += 1) {
      const candidate = {
        ...candidates[index],
        transcript: transcript.segments
          .filter(segment => segment.end >= candidates[index].start && segment.start <= candidates[index].end)
          .map(segment => segment.text).join(" ")
      };
      try {
        rendered.push(await renderClip(env, row, settings, candidate, rendered.length + 1));
      } catch {}
    }

    if (!rendered.length) throw new Error("video_clip_generation_failed");

    await setJob(env, row, "ready", settings, {
      ...baseResult,
      progress: 100,
      detectedLanguage: transcript.language,
      processor: "cloudflare-media",
      generatedClips: rendered.length,
      analyzedSeconds: Math.min(MAX_ANALYSIS_SECONDS, transcript.windows * AUDIO_WINDOW_SECONDS),
      message: rendered.length + " corte(s) prontos para revisão.",
      error: ""
    });
    return { ok: true, generated: rendered.length };
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : String(cause);
    const message = code === "cloudflare_media_source_too_large"
      ? "Este vídeo ultrapassa 100 MB, que é o limite do processador de mídia atual do Cloudflare."
      : code === "cloudflare_media_unavailable"
        ? "O processador de mídia do Cloudflare ainda não está habilitado neste Worker."
        : "Falha ao processar o vídeo no Cloudflare: " + code;
    await setJob(env, row, "failed", settings, {
      ...baseResult,
      progress: 0,
      processor: "cloudflare",
      message,
      error: code
    }).catch(() => {});
    throw cause;
  }
}

export async function processQueuedVideoJobs(env, limit = 1) {
  if (!env?.DB || !env.MEDIA || !env.VIDEO_MEDIA) return { processed: 0 };
  const result = await env.DB.prepare(
    "SELECT id,client_id FROM video_jobs WHERE status='queued' ORDER BY updated_at ASC LIMIT ?1"
  ).bind(Math.max(1, Math.min(3, Number(limit || 1)))).all();
  let processed = 0;
  for (const row of result?.results || []) {
    try {
      await processVideoJob(env, row.client_id, row.id);
      processed += 1;
    } catch {}
  }
  return { processed };
}

export async function regenerateVideoClip(env, clientId, jobId, clipId, patch = {}) {
  if (!env.MEDIA || !env.VIDEO_MEDIA) throw new Error("cloudflare_media_unavailable");
  const row = await env.DB.prepare(
    `SELECT c.id,c.job_id,c.client_id,c.output_object_key,c.settings_json,c.result_json,
            j.source_object_key,j.settings_json AS job_settings_json
     FROM video_clips c JOIN video_jobs j ON j.id=c.job_id
     WHERE c.id=?1 AND c.job_id=?2 AND c.client_id=?3 LIMIT 1`
  ).bind(String(clipId), String(jobId), String(clientId)).first();
  if (!row) throw new Error("clip_not_found");

  const settings = { ...parseJson(row.settings_json, {}), ...(patch && typeof patch === "object" ? patch : {}) };
  const jobSettings = parseJson(row.job_settings_json, {});
  const start = clamp(settings.start, 0, MAX_ANALYSIS_SECONDS - 1);
  const end = clamp(settings.end, start + 1, Math.min(MAX_ANALYSIS_SECONDS, start + MAX_CLIP_SECONDS));
  const source = await env.MEDIA.get(row.source_object_key);
  if (!source?.body) throw new Error("video_source_missing");

  const transformed = env.VIDEO_MEDIA.input(source.body)
    .transform(outputTransform(String(jobSettings.outputFormat || settings.outputFormat || "reel")))
    .output({ mode: "video", time: seconds(start), duration: seconds(end - start), audio: true });

  const outputKey = String(row.output_object_key || (
    "videos/" + clientId + "/clips/" + jobId + "/" + clipId + ".mp4"
  ));
  await env.MEDIA.put(outputKey, await transformed.media(), {
    httpMetadata: { contentType: await transformed.contentType(), cacheControl: "private, no-store" },
    customMetadata: { clientId: String(clientId), jobId: String(jobId), clipId: String(clipId), kind: "video-clip" }
  });

  settings.start = Number(start.toFixed(1));
  settings.end = Number(end.toFixed(1));
  const result = { ...parseJson(row.result_json, {}), previewUrl: "/media/" + outputKey, regeneratedAt: new Date().toISOString() };
  await env.DB.prepare(
    "UPDATE video_clips SET output_object_key=?4,status='ready',approval_status='pending',settings_json=?5,result_json=?6,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND job_id=?2 AND client_id=?3"
  ).bind(clipId, jobId, clientId, outputKey, JSON.stringify(settings), JSON.stringify(result)).run();

  return { id: clipId, jobId, clientId, outputObjectKey: outputKey, ...settings, ...result, status: "ready", approvalStatus: "pending" };
}

async function clipForPublish(env, clientId, jobId, clipId) {
  return env.DB.prepare(
    "SELECT id,job_id,client_id,output_object_key,approval_status,publish_status,settings_json,result_json FROM video_clips WHERE id=?1 AND job_id=?2 AND client_id=?3 LIMIT 1"
  ).bind(String(clipId), String(jobId), String(clientId)).first();
}

export async function publishVideoClipNow(env, clientId, jobId, clipId, caption = "", origin = "") {
  const clip = await clipForPublish(env, clientId, jobId, clipId);
  if (!clip) throw new Error("clip_not_found");
  if (String(clip.approval_status || "") !== "approved") throw new Error("clip_not_approved");
  if (String(clip.publish_status || "") === "published") throw new Error("clip_already_published");

  const base = String(origin || env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base)) throw new Error("public_origin_required");
  const source = await env.MEDIA.get(String(clip.output_object_key || ""));
  if (!source?.body) throw new Error("clip_media_missing");

  const publicKey = "posts/" + clientId + "/videos/" + crypto.randomUUID() + ".mp4";
  await env.MEDIA.put(publicKey, source.body, {
    httpMetadata: { contentType: source.httpMetadata?.contentType || "video/mp4", cacheControl: "public, max-age=86400" },
    customMetadata: { clientId: String(clientId), clipId: String(clipId), kind: "instagram-reel" }
  });

  const settings = parseJson(clip.settings_json, {});
  const result = parseJson(clip.result_json, {});
  const finalCaption = cleanText(caption || settings.caption || settings.title || "", 2200);
  await env.DB.prepare(
    "UPDATE video_clips SET publish_status='publishing',result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND job_id=?2 AND client_id=?3"
  ).bind(clipId, jobId, clientId, JSON.stringify({ ...result, publicObjectKey: publicKey, publicUrl: base + "/media/" + publicKey, publishError: "" })).run();

  try {
    const published = await publishInstagramVideo(env, clientId, base + "/media/" + publicKey, finalCaption);
    const nextResult = {
      ...result,
      publicObjectKey: publicKey,
      publicUrl: base + "/media/" + publicKey,
      mediaId: published.mediaId || "",
      containerId: published.containerId || "",
      permalink: published.permalink || "",
      publishedAt: new Date().toISOString(),
      publishError: ""
    };
    await env.DB.prepare(
      "UPDATE video_clips SET publish_status='published',result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND job_id=?2 AND client_id=?3"
    ).bind(clipId, jobId, clientId, JSON.stringify(nextResult)).run();
    return { ok: true, ...published };
  } catch (cause) {
    await env.DB.prepare(
      "UPDATE video_clips SET publish_status='failed',result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND job_id=?2 AND client_id=?3"
    ).bind(clipId, jobId, clientId, JSON.stringify({ ...result, publicObjectKey: publicKey, publicUrl: base + "/media/" + publicKey, publishError: cause instanceof Error ? cause.message : String(cause) })).run();
    throw cause;
  }
}

export async function publishScheduledVideoClips(env, clientId, now = new Date()) {
  const due = await env.DB.prepare(
    `SELECT id,job_id,settings_json FROM video_clips
     WHERE client_id=?1 AND approval_status='approved' AND publish_status IN ('scheduled','failed')
       AND scheduled_for IS NOT NULL AND scheduled_for<=?2
     ORDER BY scheduled_for ASC LIMIT 4`
  ).bind(String(clientId), now.toISOString()).all();
  let published = 0;
  let failed = 0;
  for (const row of due?.results || []) {
    const settings = parseJson(row.settings_json, {});
    try {
      await publishVideoClipNow(env, clientId, row.job_id, row.id, settings.caption || settings.title || "", env.PUBLIC_BASE_URL || "");
      published += 1;
    } catch {
      failed += 1;
    }
  }
  return { candidates: (due?.results || []).length, published, failed };
}
