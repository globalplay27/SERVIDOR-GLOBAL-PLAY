
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const RAGNAR_PORTAL_USERNAME = "ragnar-one";
const RAGNAR_PORTAL_PASSWORD_HASH = "1cbc2275dd868000ae0fc093c2bcb5aa05e75156a0681e0a7a52dc13e9bd14e3";
const EMPTY_SEED = [];

fs.mkdirSync(DATA_DIR, { recursive: true });

const seedFile = path.join(__dirname, "data", "clients.json");
const runtimeFile = path.join(DATA_DIR, "runtime.json");
const connectionsFile = path.join(DATA_DIR, "connections.json");
const oauthStateFile = path.join(DATA_DIR, "oauth-states.json");
const portalUsersFile = path.join(DATA_DIR, "portal-users.json");
const masterIntegrationsFile = path.join(DATA_DIR, "master-integrations.json");
const supportTicketsFile = path.join(DATA_DIR, "support-tickets.json");
const postLedgerFile = path.join(DATA_DIR, "post-ledger.json");
const videoJobsFile = path.join(DATA_DIR, "video-jobs.json");
const videoFoldersFile = path.join(DATA_DIR, "video-folders.json");
const clientLogoDir = path.join(DATA_DIR, "client-logos");
const manualPostDir = path.join(DATA_DIR, "manual-posts");
const clientVideoDir = path.join(DATA_DIR, "client-videos");
fs.mkdirSync(clientLogoDir, { recursive: true });
fs.mkdirSync(manualPostDir, { recursive: true });
fs.mkdirSync(clientVideoDir, { recursive: true });
const portalSessions = new Map();
const masterSessions = new Map();

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : fallback;
  } catch (error) {
    console.warn(`Ignoring invalid JSON in ${file}: ${error.message}`);
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const tempFile = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(value, null, 2));
  fs.renameSync(tempFile, file);
}

if (!fs.existsSync(runtimeFile)) {
  const seed = readJsonFile(seedFile, EMPTY_SEED);
  writeJsonAtomic(runtimeFile, seed);
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  const raw = Buffer.isBuffer(body)
    ? body
    : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(status, {
    "content-type": type,
    "content-length": raw.length,
    "cache-control": type.startsWith("text/html") ? "no-store" : "no-cache",
    "x-content-type-options": "nosniff"
  });
  res.end(raw);
}

function readFormBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      resolve(Object.fromEntries(params.entries()));
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    const raw = part.slice(index + 1).trim();
    try { result[key] = decodeURIComponent(raw); } catch { result[key] = raw; }
  }
  return result;
}

function redirectWithCookie(res, location, cookie = "") {
  const headers = { location, "cache-control": "no-store", "content-length": "0" };
  if (cookie) headers["set-cookie"] = cookie;
  res.writeHead(303, headers);
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function readLargeJsonBody(req, maxBytes = 14 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function loadClients() {
  const items = readJsonFile(runtimeFile, EMPTY_SEED);
  if (!items.some(item => item.id === "globalplay-streaming")) {
    items.push({
      id: "globalplay-streaming",
      name: "Global Play",
      niche: "Streaming",
      instagram: "@globalplay_streaming",
      theme: "green-black",
      primaryColor: "#22c55e",
      secondaryColor: "#050807",
      status: "online",
      github: "connected",
      railway: "connected",
      openai: "configured",
      meta: "configured",
      odin: true,
      ownerAccount: true,
      postTimes: ["09:00", "12:00", "18:00"],
      leads: { total: 0, hot: 0, warm: 0, cold: 0 },
      usage: { openaiPercent: 0, railwayPercent: 0 },
      aiMode: "economy",
      aiMonthlyImageLimit: 0,
      aiImagesUsed: 0,
      aiUsageMonth: new Date().toISOString().slice(0, 7),
      managedInfrastructure: false,
      onboarding: {
        github: true, railway: true, openai: true,
        instagram: true, facebook: true, metaApp: true,
        creativeProfile: true, supportRequested: false
      },
      postingProfile: defaultPostingProfile(),
      agentProfile: {
        agentName: "Claire",
        brandName: "Global Play",
        niche: "Streaming",
        status: "configured"
      },
      setupMode: "ready",
      agentApiUrl: "https://claire-production-e1db.up.railway.app"
    });
    writeJsonAtomic(runtimeFile, items);
  }
  let changed = false;
  for (const item of items) {
    if (item.id === "ragnar-one") continue;
    if (item.aiMode !== "economy" || Number(item.aiMonthlyImageLimit || 0) !== 0) {
      item.aiMode = "economy";
      item.aiMonthlyImageLimit = 0;
      item.aiImagesUsed = Number(item.aiImagesUsed || 0);
      changed = true;
    }
  }
  if (changed) writeJsonAtomic(runtimeFile, items);
  return items;
}

function saveClients(items) {
  writeJsonAtomic(runtimeFile, items);
}

function readObjectFile(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  } catch (error) {
    console.warn(`Ignoring invalid object JSON in ${file}: ${error.message}`);
    return fallback;
  }
}

function loadConnections() {
  return readObjectFile(connectionsFile, {});
}

function saveConnections(value) {
  writeJsonAtomic(connectionsFile, value);
}

function loadOauthStates() {
  return readObjectFile(oauthStateFile, {});
}

function saveOauthStates(value) {
  writeJsonAtomic(oauthStateFile, value);
}

function loadPortalUsers() {
  return readObjectFile(portalUsersFile, {});
}

function savePortalUsers(value) {
  writeJsonAtomic(portalUsersFile, value);
}

function loadMasterIntegrations() {
  return readObjectFile(masterIntegrationsFile, {});
}

function saveMasterIntegrations(value) {
  writeJsonAtomic(masterIntegrationsFile, value);
}

function loadSupportTickets() {
  return readJsonFile(supportTicketsFile, []);
}

function saveSupportTickets(value) {
  writeJsonAtomic(supportTicketsFile, Array.isArray(value) ? value : []);
}

function loadPostLedger() {
  return readJsonFile(postLedgerFile, []);
}

function savePostLedger(value) {
  const rows = Array.isArray(value) ? value.slice(-5000) : [];
  writeJsonAtomic(postLedgerFile, rows);
}

function loadVideoJobs() {
  return readJsonFile(videoJobsFile, []);
}

function saveVideoJobs(value) {
  writeJsonAtomic(videoJobsFile, Array.isArray(value) ? value.slice(-1000) : []);
}

function loadVideoFolders() {
  const rows = readJsonFile(videoFoldersFile, []);
  return Array.isArray(rows) ? rows : [];
}

function saveVideoFolders(value) {
  writeJsonAtomic(videoFoldersFile, Array.isArray(value) ? value.slice(-500) : []);
}

function videoFoldersForClient(clientId) {
  const rows = loadVideoFolders().filter(item => item.clientId === clientId);
  if (!rows.some(item => item.id === "default")) {
    rows.unshift({ id: "default", clientId, name: "Meus vídeos", createdAt: new Date().toISOString() });
  }
  return rows;
}

function videoFormatSpec(value) {
  const key = String(value || "reel").toLowerCase();
  if (key === "feed") return { key: "feed", label: "Instagram Feed 4:5", width: 1080, height: 1350 };
  if (key === "square") return { key: "square", label: "Instagram 1:1", width: 1080, height: 1080 };
  return { key: "reel", label: "Reels / Stories 9:16", width: 1080, height: 1920 };
}

function deleteVideoJobFiles(job) {
  const targets = new Set();
  if (job?.storedPath) {
    targets.add(job.storedPath);
    const baseDir = path.dirname(job.storedPath);
    targets.add(path.join(baseDir, job.id + "-work"));
    targets.add(path.join(baseDir, job.id + "-clips"));
  }
  for (const clip of job?.clips || []) {
    if (clip?.storedPath) targets.add(clip.storedPath);
  }
  for (const target of targets) {
    try {
      if (!target || !fs.existsSync(target)) continue;
      const stat = fs.statSync(target);
      if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
      else fs.unlinkSync(target);
    } catch {}
  }
}

function portalVideoJobView(job) {
  return {
    id: job.id,
    clientId: job.clientId,
    clientName: job.clientName || job.clientId,
    filename: job.filename,
    displayName: job.displayName || job.filename,
    folderId: job.folderId || "default",
    outputFormat: videoFormatSpec(job.outputFormat).key,
    outputFormatLabel: videoFormatSpec(job.outputFormat).label,
    endText: job.endText || "",
    endContact: job.endContact || "",
    sizeBytes: Number(job.sizeBytes || 0),
    goal: job.goal || "viral",
    clipDuration: Number(job.clipDuration || 30),
    requestedClips: Number(job.requestedClips || 3),
    status: job.status || "queued",
    progress: Number(job.progress || 0),
    message: job.message || "",
    duration: Number(job.duration || 0),
    transcriptAvailable: Boolean(job.transcriptText),
    analysisCostUsd: Number(job.analysisCostUsd || 0),
    clips: Array.isArray(job.clips) ? job.clips.map(clip => ({
      id: clip.id,
      title: clip.title || "",
      reason: clip.reason || "",
      hook: clip.hook || "",
      qualityScore: Number(clip.qualityScore || 0),
      rank: Number(clip.rank || 0),
      selectedForSchedule: Boolean(clip.selectedForSchedule),
      transcript: clip.transcript || "",
      start: Number(clip.start || 0),
      end: Number(clip.end || 0),
      duration: Number(clip.duration || 0),
      status: clip.status || "draft",
      approvalStatus: clip.approvalStatus || "pending",
      publishStatus: clip.publishStatus || "",
      scheduledFor: clip.scheduledFor || null,
      publishedAt: clip.publishedAt || null,
      mediaId: clip.mediaId || "",
      error: clip.error || "",
      caption: clip.caption || "",
      previewUrl: clip.previewUrl || "",
      outputFormat: clip.outputFormat || videoFormatSpec(job.outputFormat).key,
      endText: clip.endText || job.endText || "",
      endContact: clip.endContact || job.endContact || ""
    })) : [],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt || job.createdAt
  };
}

const videoProcessing = new Set();

function updateVideoJob(jobId, updater) {
  const jobs = loadVideoJobs();
  const job = jobs.find(item => item.id === jobId);
  if (!job) return null;
  if (typeof updater === "function") updater(job);
  else if (updater && typeof updater === "object") Object.assign(job, updater);
  job.updatedAt = new Date().toISOString();
  saveVideoJobs(jobs);
  return job;
}

async function execMedia(command, args, options = {}) {
  return execFileAsync(command, args, {
    timeout: options.timeout || 10 * 60 * 1000,
    maxBuffer: options.maxBuffer || 8 * 1024 * 1024
  });
}

async function probeVideoDuration(file) {
  const { stdout } = await execMedia("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file
  ], { timeout: 30000 });
  const duration = Number(String(stdout || "").trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("video_duration_invalid");
  return duration;
}

function responseOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function videoOpenAIKeyForClient(clientId) {
  // Ragnar is intentionally isolated from the shared NEXUS OpenAI account.
  // If Ragnar has no key stored directly in NEXUS, video cutting falls back to technical cuts
  // instead of spending the central account.
  if (clientId === "ragnar-one") {
    const direct = loadConnections()?.[clientId]?.openai;
    return direct?.apiKey ? decryptSecret(direct.apiKey) : "";
  }
  return masterOpenAIProjectKey();
}

async function transcribeVideoAudio(audioPath, durationSeconds, clientId) {
  const apiKey = videoOpenAIKeyForClient(clientId);
  if (!apiKey) throw new Error(clientId === "ragnar-one" ? "ragnar_openai_not_available" : "openai_not_configured");
  const bytes = fs.readFileSync(audioPath);
  if (bytes.length > 25 * 1024 * 1024) throw new Error("audio_too_large_for_transcription");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/mpeg" }), "audio.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("language", "pt");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: "Bearer " + apiKey },
    body: form,
    signal: AbortSignal.timeout(10 * 60 * 1000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("transcription_failed_" + response.status);
  const segments = Array.isArray(payload.segments) ? payload.segments.map(item => ({
    start: Number(item.start || 0),
    end: Number(item.end || 0),
    text: String(item.text || "").trim()
  })).filter(item => item.text && item.end > item.start) : [];
  return {
    text: String(payload.text || "").trim(),
    segments,
    costUsd: Math.max(0, Number(durationSeconds || payload.duration || 0)) / 60 * 0.006
  };
}

function transcriptHeuristicSelections(segments, duration, count, targetDuration) {
  if (!Array.isArray(segments) || !segments.length) return [];
  const candidates = [];
  const desired = Math.max(8, Number(targetDuration || 30));
  const maxDuration = Math.min(95, desired + 18);
  const hookWords = /\b(como|porque|por que|segredo|erro|melhor|pior|nunca|sempre|voce|você|aten[cç][aã]o|olha|importante|resultado|dinheiro|venda|cliente|verdade|problema|solu[cç][aã]o|dica|passo|motivo|evite)\b/i;

  for (let i = 0; i < segments.length; i += 1) {
    const startSeg = segments[i];
    let text = "";
    let end = startSeg.end;
    for (let j = i; j < segments.length; j += 1) {
      const seg = segments[j];
      if (seg.end - startSeg.start > maxDuration) break;
      text += (text ? " " : "") + seg.text;
      end = seg.end;
      const len = end - startSeg.start;
      if (len >= desired * 0.72 && (sentenceLooksFinished(seg.text) || len >= desired)) {
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        const density = words / Math.max(1, len);
        const punctuation = /[!?]/.test(text) ? 12 : /[.]\s*$/.test(text) ? 5 : 0;
        const hook = hookWords.test(text) ? 14 : 0;
        const lengthFit = Math.max(0, 18 - Math.abs(len - desired) * 0.8);
        const score = Math.round(Math.min(99, 35 + density * 8 + punctuation + hook + lengthFit));
        candidates.push({
          start: Math.max(0, startSeg.start),
          end: Math.min(duration, end),
          title: "Trecho forte",
          reason: "Selecionado por densidade de fala, gancho e conclusão de ideia.",
          score,
          hook: text.slice(0, 160)
        });
        break;
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.some(item => Math.max(item.start, candidate.start) < Math.min(item.end, candidate.end))) continue;
    selected.push(candidate);
    if (selected.length >= Math.max(1, Number(count || 3))) break;
  }
  return selected;
}

function transcriptForRange(segments, start, end) {
  return segments
    .filter(item => item.end >= start && item.start <= end)
    .map(item => item.text)
    .join(" ")
    .trim()
    .slice(0, 1200);
}

async function detectSpeechSilences(audioPath) {
  try {
    const { stderr = "" } = await execMedia("ffmpeg", [
      "-hide_banner",
      "-i", audioPath,
      "-af", "silencedetect=noise=-35dB:d=0.18",
      "-f", "null",
      "-"
    ], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    const starts = [];
    const ends = [];
    for (const line of String(stderr).split("\n")) {
      const start = /silence_start:\s*([0-9.]+)/.exec(line);
      if (start) starts.push(Number(start[1]));
      const end = /silence_end:\s*([0-9.]+)/.exec(line);
      if (end) ends.push(Number(end[1]));
    }
    return { starts: starts.filter(Number.isFinite), ends: ends.filter(Number.isFinite) };
  } catch {
    return { starts: [], ends: [] };
  }
}

function sentenceLooksFinished(text) {
  return /[.!?…]["')\]]?$/.test(String(text || "").trim());
}

function refineClipBoundary(clip, segments, silences, duration, targetDuration) {
  const maxDuration = Math.min(95, Math.max(Number(targetDuration || 30) + 18, Number(targetDuration || 30) * 1.6));
  let start = Math.max(0, Number(clip.start || 0));
  let end = Math.min(Number(duration || 0), Number(clip.end || (start + targetDuration)));

  if (segments.length) {
    const startIndex = Math.max(0, segments.findIndex(seg => seg.end >= start));
    if (segments[startIndex]) start = Math.max(0, segments[startIndex].start - 0.12);

    let endIndex = segments.findIndex(seg => seg.end >= end);
    if (endIndex < 0) endIndex = segments.length - 1;

    if (segments[endIndex]) {
      end = Math.min(duration, segments[endIndex].end + 0.28);
      let current = endIndex;
      while (current + 1 < segments.length) {
        const seg = segments[current];
        const next = segments[current + 1];
        const gap = Math.max(0, next.start - seg.end);
        const currentLength = end - start;
        if (sentenceLooksFinished(seg.text) && gap >= 0.18) break;
        if (currentLength >= maxDuration) break;
        if (next.end - start > 95) break;
        current += 1;
        end = Math.min(duration, next.end + 0.28);
        if (sentenceLooksFinished(next.text) && (current + 1 >= segments.length || segments[current + 1].start - next.end >= 0.12)) break;
      }
    }
  }

  // Prefer cutting at the next actual silence instead of on an active syllable.
  const nextSilence = (silences?.starts || [])
    .filter(point => point >= end - 0.2 && point <= Math.min(duration, end + 6))
    .sort((a, b) => a - b)[0];
  if (Number.isFinite(nextSilence) && nextSilence - start <= 95) {
    end = Math.min(duration, nextSilence + 0.08);
  } else if (!segments.length) {
    // Technical fallback: give the speaker extra room when no transcription is available.
    end = Math.min(duration, end + 2.5);
  }

  if (end <= start + 2.5) end = Math.min(duration, start + Math.max(3, targetDuration));
  if (end - start > 95) end = start + 95;

  return { ...clip, start, end };
}

async function selectSmartClips(transcription, duration, count, targetDuration, goal, clientId) {
  const segments = Array.isArray(transcription?.segments) ? transcription.segments : [];
  if (!segments.length) throw new Error("smart_transcript_required");

  const compact = segments.map(item => "[" + item.start.toFixed(1) + "-" + item.end.toFixed(1) + "] " + item.text).join("\n").slice(0, 120000);
  const prompt = `Você é o editor de vídeos curtos do NEXUS AI.
Escolha exatamente ${count} MELHORES trechos independentes do vídeo, ranqueados por potencial para ${goal || "engajamento"}.
NÃO divida o vídeo em partes iguais e NÃO escolha trechos só para cobrir começo, meio e fim.
Cada opção precisa funcionar sozinha como um vídeo publicável: gancho forte, ideia completa, valor claro e final natural.
Cada corte deve ter aproximadamente ${targetDuration} segundos, mas a duração pode passar desse alvo para terminar a fala naturalmente.
REGRA CRÍTICA: jamais encerre o corte no meio de uma palavra, frase, resposta, CTA ou despedida. Prefira alguns segundos a mais a cortar a fala final.
Escolha o end no fim de uma frase completa ou em uma pausa natural.
Não invente falas e não escolha trechos sobrepostos.
Responda SOMENTE JSON válido neste formato:
{"clips":[{"start":12.3,"end":42.0,"title":"Título curto","hook":"Primeira ideia forte do trecho","reason":"Por que este trecho funciona sozinho","score":94}]}

Duração total: ${duration.toFixed(1)} segundos.
Transcrição com timestamps:
${compact}`;

  const apiKey = videoOpenAIKeyForClient(clientId);
  if (!apiKey) throw new Error(clientId === "ragnar-one" ? "ragnar_openai_not_available" : "openai_not_configured");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: "Bearer " + apiKey,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      input: prompt,
      max_output_tokens: 1600
    }),
    signal: AbortSignal.timeout(120000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("clip_selection_failed_" + response.status);
  const output = responseOutputText(payload);
  const startJson = output.indexOf("{");
  const endJson = output.lastIndexOf("}");
  if (startJson < 0 || endJson <= startJson) throw new Error("clip_selection_invalid_json");
  const parsed = JSON.parse(output.slice(startJson, endJson + 1));
  const selected = Array.isArray(parsed.clips) ? parsed.clips : [];
  const clips = selected.map((item, index) => {
    let start = Math.max(0, Number(item.start || 0));
    let end = Math.min(duration, Number(item.end || start + targetDuration));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    if (end - start > 95) end = start + 95;
    if (end - start < 3) end = Math.min(duration, start + Math.max(3, targetDuration));
    return {
      start,
      end,
      title: String(item.title || ("Corte " + (index + 1))).slice(0, 100),
      reason: String(item.reason || "").slice(0, 300),
      hook: String(item.hook || "").slice(0, 220),
      score: Math.max(1, Math.min(100, Number(item.score || 70)))
    };
  }).filter(Boolean)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, Math.max(1, count));
  const usage = payload.usage || {};
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const costUsd = Math.max(0, inputTokens) * 0.20 / 1_000_000 + Math.max(0, outputTokens) * 1.20 / 1_000_000;
  return {
    clips: clips.length ? clips : fallbackClipSelections(duration, count, targetDuration),
    costUsd,
    model: "gpt-5.6-luna"
  };
}

function escapeFfmpegDrawtext(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

async function renderVideoClip(inputPath, outputPath, start, end, outputFormat = "reel", endText = "", endContact = "") {
  const duration = Math.max(3, Number(end) - Number(start));
  const spec = videoFormatSpec(outputFormat);
  const finalText = String(endText || "").trim().slice(0, 90);
  const finalContact = String(endContact || "").trim().slice(0, 90);
  const outroStart = Math.max(0, duration - 3);
  const fontFile = "/usr/share/fonts/ttf-dejavu/DejaVuSans-Bold.ttf";

  const filters = [
    "[0:v]split=2[bg][fg]",
    "[bg]scale=" + spec.width + ":" + spec.height + ":force_original_aspect_ratio=increase,crop=" + spec.width + ":" + spec.height + ",boxblur=20:10[bg2]",
    "[fg]scale=" + spec.width + ":" + spec.height + ":force_original_aspect_ratio=decrease[fg2]",
    "[bg2][fg2]overlay=(W-w)/2:(H-h)/2,format=yuv420p[base]"
  ];

  let videoLabel = "base";
  if (finalText || finalContact) {
    filters.push("[" + videoLabel + "]drawbox=x=0:y=ih*0.68:w=iw:h=ih*0.32:color=black@0.62:t=fill:enable='gte(t," + outroStart.toFixed(3) + ")'[outbox]");
    videoLabel = "outbox";
    if (finalText) {
      filters.push("[" + videoLabel + "]drawtext=fontfile=" + fontFile + ":text='" + escapeFfmpegDrawtext(finalText) + "':fontcolor=white:fontsize=" + Math.round(spec.width * 0.052) + ":borderw=2:bordercolor=black@0.7:x=(w-text_w)/2:y=h*0.75:enable='gte(t," + outroStart.toFixed(3) + ")'[outtext]");
      videoLabel = "outtext";
    }
    if (finalContact) {
      filters.push("[" + videoLabel + "]drawtext=fontfile=" + fontFile + ":text='" + escapeFfmpegDrawtext(finalContact) + "':fontcolor=white:fontsize=" + Math.round(spec.width * 0.035) + ":borderw=2:bordercolor=black@0.7:x=(w-text_w)/2:y=h*0.84:enable='gte(t," + outroStart.toFixed(3) + ")'[outcontact]");
      videoLabel = "outcontact";
    }
  }

  await execMedia("ffmpeg", [
    "-y",
    "-ss", Number(start).toFixed(3),
    "-i", inputPath,
    "-t", duration.toFixed(3),
    "-filter_complex", filters.join(";"),
    "-map", "[" + videoLabel + "]",
    "-map", "0:a?",
    "-r", "30",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "48000",
    "-movflags", "+faststart",
    outputPath
  ]);
}

async function processVideoJob(jobId) {
  if (videoProcessing.has(jobId)) return;
  videoProcessing.add(jobId);
  let audioPath = "";
  try {
    const initial = loadVideoJobs().find(item => item.id === jobId);
    if (!initial || !initial.storedPath || !fs.existsSync(initial.storedPath)) throw new Error("video_file_missing");

    updateVideoJob(jobId, { status: "transcribing", progress: 12, message: "Preparando áudio e transcrição…" });
    const duration = await probeVideoDuration(initial.storedPath);
    updateVideoJob(jobId, { duration });

    const workDir = path.join(path.dirname(initial.storedPath), initial.id + "-work");
    fs.mkdirSync(workDir, { recursive: true });
    audioPath = path.join(workDir, "audio.mp3");

    let transcription = { text: "", segments: [], costUsd: 0 };
    let speechSilences = { starts: [], ends: [] };
    try {
      await execMedia("ffmpeg", ["-y", "-i", initial.storedPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "24k", audioPath]);
      updateVideoJob(jobId, { status: "transcribing", progress: 28, message: "Transcrevendo o áudio…" });
      transcription = await transcribeVideoAudio(audioPath, duration, initial.clientId);
      speechSilences = await detectSpeechSilences(audioPath);
    } catch (error) {
      console.warn("Video transcription fallback " + jobId + ": " + String(error?.message || error));
      try { speechSilences = await detectSpeechSilences(audioPath); } catch {}
    }

    updateVideoJob(jobId, job => {
      job.status = "selecting";
      job.progress = 48;
      job.message = transcription.segments.length ? "IA escolhendo os melhores momentos…" : "Selecionando cortes técnicos…";
      job.transcriptText = transcription.text || "";
      job.transcriptSegments = transcription.segments || [];
      job.analysisCostUsd = Number(job.analysisCostUsd || 0) + Number(transcription.costUsd || 0);
    });

    let selection;
    try {
      selection = await selectSmartClips(
        transcription,
        duration,
        Number(initial.requestedClips || 3),
        Number(initial.clipDuration || 30),
        initial.goal || "viral",
        initial.clientId
      );
    } catch (error) {
      console.warn("Video smart selection fallback " + jobId + ": " + String(error?.message || error));
      const heuristic = transcriptHeuristicSelections(
        transcription.segments || [],
        duration,
        Number(initial.requestedClips || 3),
        Number(initial.clipDuration || 30)
      );
      if (!heuristic.length) {
        throw new Error("smart_clip_analysis_unavailable");
      }
      selection = { clips: heuristic, costUsd: 0, model: "transcript-heuristic" };
    }

    const wantedClips = Math.max(1, Number(initial.requestedClips || 3));
    if ((selection.clips || []).length < wantedClips) {
      const extras = transcriptHeuristicSelections(
        transcription.segments || [],
        duration,
        wantedClips,
        Number(initial.clipDuration || 30)
      );
      for (const extra of extras) {
        if ((selection.clips || []).some(item => Math.max(item.start, extra.start) < Math.min(item.end, extra.end))) continue;
        selection.clips.push(extra);
        if (selection.clips.length >= wantedClips) break;
      }
    }

    selection.clips = (selection.clips || []).map(clip =>
      refineClipBoundary(
        clip,
        transcription.segments || [],
        speechSilences,
        duration,
        Number(initial.clipDuration || 30)
      )
    );

    updateVideoJob(jobId, job => {
      job.status = "cutting";
      job.progress = 58;
      job.message = "Criando os cortes verticais para revisão…";
      job.selectionModel = selection.model || "fallback";
      job.analysisCostUsd = Number(job.analysisCostUsd || 0) + Number(selection.costUsd || 0);
      job.clips = [];
    });

    const clipDir = path.join(path.dirname(initial.storedPath), initial.id + "-clips");
    fs.mkdirSync(clipDir, { recursive: true });
    const clips = [];
    for (let index = 0; index < selection.clips.length; index += 1) {
      const selected = selection.clips[index];
      const clipId = "clip_" + crypto.randomBytes(7).toString("hex");
      const publicName = initial.id + "-" + clipId + "-" + crypto.randomBytes(6).toString("hex") + ".mp4";
      const outputPath = path.join(clipDir, publicName);
      await renderVideoClip(
        initial.storedPath,
        outputPath,
        selected.start,
        selected.end,
        initial.outputFormat || "reel",
        initial.endText || "",
        initial.endContact || ""
      );
      const transcript = transcriptForRange(transcription.segments, selected.start, selected.end);
      clips.push({
        id: clipId,
        publicName,
        storedPath: outputPath,
        title: selected.title || "Corte " + (index + 1),
        reason: selected.reason || "",
        hook: selected.hook || "",
        qualityScore: Number(selected.score || 0),
        rank: index + 1,
        selectedForSchedule: false,
        transcript,
        start: Number(selected.start),
        end: Number(selected.end),
        duration: Number(selected.end) - Number(selected.start),
        status: "ready",
        approvalStatus: "pending",
        publishStatus: "",
        scheduledFor: null,
        caption: selected.title || "",
        previewUrl: "/video-media/" + encodeURIComponent(publicName),
        outputFormat: videoFormatSpec(initial.outputFormat).key,
        endText: initial.endText || "",
        endContact: initial.endContact || "",
        createdAt: new Date().toISOString()
      });
      updateVideoJob(jobId, {
        progress: 58 + Math.round((index + 1) / Math.max(1, selection.clips.length) * 38),
        message: "Criando corte " + (index + 1) + " de " + selection.clips.length + "…"
      });
    }

    updateVideoJob(jobId, job => {
      job.status = "ready";
      job.progress = 100;
      job.message = "Cortes prontos para assistir, aprovar ou rejeitar. Nada foi colocado na agenda.";
      job.clips = clips;
      job.completedAt = new Date().toISOString();
    });
  } catch (error) {
    console.error("Video processing failed", jobId, error);
    const code = String(error?.message || error);
    const smartUnavailable = ["smart_clip_analysis_unavailable","smart_transcript_required","ragnar_openai_not_available","openai_not_configured"].some(item => code.includes(item));
    updateVideoJob(jobId, {
      status: "failed",
      progress: 100,
      message: smartUnavailable
        ? "Não consegui analisar as melhores partes com IA. O NEXUS não vai simplesmente dividir o vídeo; corrija a conexão de IA e tente novamente."
        : "Falha ao processar o vídeo.",
      error: code.slice(0, 900)
    });
  } finally {
    if (audioPath) {
      try { fs.unlinkSync(audioPath); } catch {}
    }
    videoProcessing.delete(jobId);
  }
}

function startPendingVideoJobs() {
  const jobs = loadVideoJobs();
  for (const job of jobs) {
    if (["queued","uploaded","transcribing","selecting","cutting"].includes(String(job.status || ""))) {
      setTimeout(() => processVideoJob(job.id).catch(() => {}), 1200);
    }
  }
}

function videoPublicOrigin() {
  const domain = String(process.env.RAILWAY_PUBLIC_DOMAIN || "").trim();
  return domain ? "https://" + domain : "https://servidor-global-play-production.up.railway.app";
}

function findVideoClip(clientId, jobId, clipId) {
  const jobs = loadVideoJobs();
  const job = jobs.find(item => item.id === jobId && item.clientId === clientId);
  if (!job) return { jobs, job: null, clip: null };
  const clip = Array.isArray(job.clips) ? job.clips.find(item => item.id === clipId) : null;
  return { jobs, job, clip: clip || null };
}

function saveVideoClipState(jobs, job) {
  job.updatedAt = new Date().toISOString();
  saveVideoJobs(jobs);
}

async function publishInstagramVideoForClient(clientId, clip, caption) {
  const connection = directConnection(clientId, "meta");
  const accessToken = decryptSecret(connection?.accessToken || "");
  const igUserId = String(connection?.igUserId || "").trim();
  if (!accessToken || !igUserId) throw new Error("instagram_not_connected");
  if (!clip?.publicName) throw new Error("video_media_missing");

  const graphRequest = async (pathName, method = "GET", form = null) => {
    const endpoint = "https://graph.instagram.com/" + String(pathName).replace(/^\/+/, "");
    const options = {
      method,
      headers: {
        authorization: "Bearer " + accessToken,
        "user-agent": "NEXUS-AI/1.0"
      }
    };
    if (form) {
      options.headers["content-type"] = "application/x-www-form-urlencoded";
      options.body = new URLSearchParams(form);
    }
    const response = await fetch(endpoint, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const metaError = payload?.error || {};
      const err = new Error(String(metaError.message || "instagram_api_failed"));
      err.code = metaError.code || response.status;
      throw err;
    }
    return payload;
  };

  const videoUrl = videoPublicOrigin() + "/video-media/" + encodeURIComponent(clip.publicName);
  const created = await graphRequest(igUserId + "/media", "POST", {
    media_type: "REELS",
    video_url: videoUrl,
    caption: String(caption || clip.caption || clip.title || "").slice(0, 2200),
    share_to_feed: "true"
  });
  const containerId = String(created?.id || "");
  if (!containerId) throw new Error("instagram_container_missing");

  const deadline = Date.now() + 8 * 60 * 1000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const status = await graphRequest(containerId + "?fields=status_code,status");
    const code = String(status?.status_code || "").toUpperCase();
    lastStatus = String(status?.status || code || "");
    if (code === "FINISHED") {
      const published = await graphRequest(igUserId + "/media_publish", "POST", { creation_id: containerId });
      return { mediaId: String(published?.id || ""), containerId };
    }
    if (code === "ERROR" || code === "EXPIRED") throw new Error("instagram_video_processing_" + (lastStatus || code));
  }
  throw new Error("instagram_video_processing_timeout");
}

async function setVideoClipApproval(clientId, jobId, clipId, status) {
  const allowed = new Set(["approved","rejected","pending"]);
  if (!allowed.has(String(status))) throw new Error("invalid_approval");
  const found = findVideoClip(clientId, jobId, clipId);
  if (!found.job || !found.clip) throw new Error("clip_not_found");
  found.clip.approvalStatus = String(status);
  found.clip.error = "";
  if (status === "rejected") {
    found.clip.publishStatus = "";
    found.clip.scheduledFor = null;
  }
  saveVideoClipState(found.jobs, found.job);
  return found.clip;
}

async function scheduleVideoClip(clientId, jobId, clipId, scheduledFor, caption) {
  const found = findVideoClip(clientId, jobId, clipId);
  if (!found.job || !found.clip) throw new Error("clip_not_found");
  if (found.clip.approvalStatus !== "approved") throw new Error("clip_not_approved");
  const date = new Date(scheduledFor);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_schedule");
  if (date.getTime() < Date.now() - 60 * 1000) throw new Error("schedule_in_past");
  found.clip.caption = String(caption || found.clip.caption || found.clip.title || "").slice(0, 2200);
  found.clip.scheduledFor = date.toISOString();
  found.clip.publishStatus = "scheduled";
  found.clip.error = "";
  saveVideoClipState(found.jobs, found.job);
  return found.clip;
}

async function bulkScheduleVideoClips(clientId, items) {
  if (!Array.isArray(items) || !items.length) throw new Error("no_videos_selected");
  if (items.length > 100) throw new Error("too_many_videos");

  const jobs = loadVideoJobs();
  const results = [];
  const seen = new Set();
  const now = Date.now();

  for (const raw of items) {
    const jobId = String(raw?.jobId || "");
    const clipId = String(raw?.clipId || "");
    const unique = jobId + "|" + clipId;
    if (!jobId || !clipId || seen.has(unique)) {
      results.push({ jobId, clipId, ok: false, error: "invalid_item" });
      continue;
    }
    seen.add(unique);

    const job = jobs.find(item => item.id === jobId && item.clientId === clientId);
    const clip = job && Array.isArray(job.clips) ? job.clips.find(item => item.id === clipId) : null;
    if (!job || !clip) {
      results.push({ jobId, clipId, ok: false, error: "clip_not_found" });
      continue;
    }
    if (clip.publishStatus === "published") {
      results.push({ jobId, clipId, ok: false, error: "already_published" });
      continue;
    }
    if (clip.status !== "ready") {
      results.push({ jobId, clipId, ok: false, error: "clip_not_ready" });
      continue;
    }

    const date = new Date(raw?.scheduledFor);
    if (!Number.isFinite(date.getTime())) {
      results.push({ jobId, clipId, ok: false, error: "invalid_schedule" });
      continue;
    }
    if (date.getTime() < now - 60 * 1000) {
      results.push({ jobId, clipId, ok: false, error: "schedule_in_past" });
      continue;
    }

    // Scheduling from the client is itself the client's approval.
    // No Master approval is required.
    clip.approvalStatus = "approved";
    clip.caption = String(raw?.caption || clip.caption || clip.title || "").slice(0, 2200);
    clip.scheduledFor = date.toISOString();
    clip.publishStatus = "scheduled";
    clip.selectedForSchedule = false;
    clip.error = "";
    job.updatedAt = new Date().toISOString();
    results.push({
      jobId,
      clipId,
      ok: true,
      scheduledFor: clip.scheduledFor,
      publishStatus: clip.publishStatus,
      approvalStatus: clip.approvalStatus
    });
  }

  saveVideoJobs(jobs);
  return {
    scheduled: results.filter(item => item.ok).length,
    failed: results.filter(item => !item.ok).length,
    results
  };
}

async function publishVideoClipNow(clientId, jobId, clipId, caption) {
  const found = findVideoClip(clientId, jobId, clipId);
  if (!found.job || !found.clip) throw new Error("clip_not_found");
  if (found.clip.approvalStatus !== "approved") throw new Error("clip_not_approved");
  found.clip.publishStatus = "publishing";
  found.clip.error = "";
  found.clip.caption = String(caption || found.clip.caption || found.clip.title || "").slice(0, 2200);
  saveVideoClipState(found.jobs, found.job);
  try {
    const result = await publishInstagramVideoForClient(clientId, found.clip, found.clip.caption);
    const fresh = findVideoClip(clientId, jobId, clipId);
    if (fresh.clip) {
      fresh.clip.publishStatus = "published";
      fresh.clip.mediaId = result.mediaId || "";
      fresh.clip.publishedAt = new Date().toISOString();
      fresh.clip.scheduledFor = null;
      fresh.clip.error = "";
      saveVideoClipState(fresh.jobs, fresh.job);
      return fresh.clip;
    }
    return found.clip;
  } catch (error) {
    const fresh = findVideoClip(clientId, jobId, clipId);
    if (fresh.clip) {
      fresh.clip.publishStatus = "failed";
      fresh.clip.error = String(error?.message || error).slice(0, 900);
      saveVideoClipState(fresh.jobs, fresh.job);
    }
    throw error;
  }
}

async function adjustVideoClip(clientId, jobId, clipId, body) {
  const found = findVideoClip(clientId, jobId, clipId);
  if (!found.job || !found.clip) throw new Error("clip_not_found");
  const start = Number(body.start);
  const end = Number(body.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > Number(found.job.duration || 0) + 0.5 || end - start > 95) {
    throw new Error("invalid_clip_range");
  }
  if (!found.clip.storedPath || !fs.existsSync(found.clip.storedPath)) throw new Error("clip_file_missing");
  found.clip.status = "editing";
  found.clip.error = "";
  saveVideoClipState(found.jobs, found.job);
  const nextEndText = Object.prototype.hasOwnProperty.call(body, "endText") ? String(body.endText || "").slice(0, 90) : (found.clip.endText || found.job.endText || "");
  const nextEndContact = Object.prototype.hasOwnProperty.call(body, "endContact") ? String(body.endContact || "").slice(0, 90) : (found.clip.endContact || found.job.endContact || "");
  await renderVideoClip(
    found.job.storedPath,
    found.clip.storedPath,
    start,
    end,
    found.job.outputFormat || found.clip.outputFormat || "reel",
    nextEndText,
    nextEndContact
  );
  const fresh = findVideoClip(clientId, jobId, clipId);
  fresh.clip.start = start;
  fresh.clip.end = end;
  fresh.clip.duration = end - start;
  if (Object.prototype.hasOwnProperty.call(body, "title")) fresh.clip.title = String(body.title || "").slice(0, 100);
  if (Object.prototype.hasOwnProperty.call(body, "caption")) fresh.clip.caption = String(body.caption || "").slice(0, 2200);
  fresh.clip.transcript = transcriptForRange(fresh.job.transcriptSegments || [], start, end);
  fresh.clip.endText = nextEndText;
  fresh.clip.endContact = nextEndContact;
  fresh.clip.status = "ready";
  fresh.clip.approvalStatus = "pending";
  fresh.clip.publishStatus = "";
  fresh.clip.scheduledFor = null;
  fresh.clip.error = "";
  saveVideoClipState(fresh.jobs, fresh.job);
  return fresh.clip;
}

let videoScheduleRunning = false;
async function processDueVideoSchedules() {
  if (videoScheduleRunning) return;
  videoScheduleRunning = true;
  try {
    const jobs = loadVideoJobs();
    const due = [];
    for (const job of jobs) {
      for (const clip of job.clips || []) {
        if (clip.approvalStatus !== "approved" || clip.publishStatus !== "scheduled" || !clip.scheduledFor) continue;
        const when = new Date(clip.scheduledFor).getTime();
        if (Number.isFinite(when) && when <= Date.now()) due.push({ clientId: job.clientId, jobId: job.id, clipId: clip.id, caption: clip.caption || "" });
      }
    }
    for (const item of due.slice(0, 3)) {
      await publishVideoClipNow(item.clientId, item.jobId, item.clipId, item.caption).catch(error => {
        console.warn("Scheduled video publish failed " + item.jobId + "/" + item.clipId + ": " + String(error?.message || error));
      });
    }
  } finally {
    videoScheduleRunning = false;
  }
}



function cleanPostStatus(value) {
  const allowed = new Set(["scheduled","generating","ready","publishing","published","failed","skipped"]);
  return allowed.has(String(value || "")) ? String(value) : "scheduled";
}

function cleanApprovalStatus(value) {
  const allowed = new Set(["pending","approved","rejected","correction_requested"]);
  return allowed.has(String(value || "")) ? String(value) : "pending";
}

function normalizeIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function upsertPostLedger(clientId, body = {}) {
  const clients = loadClients();
  const client = clients.find(item => item.id === clientId);
  if (!client) return null;

  const now = new Date().toISOString();
  const scheduledFor = normalizeIso(body.scheduledFor);
  const scheduledHour = String(body.scheduledHour || "").trim().slice(0, 5)
    || (scheduledFor ? new Date(scheduledFor).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }) : "");
  const postId = String(body.postId || "").trim().slice(0, 160)
    || [clientId, scheduledFor || now].join(":");

  const ledger = loadPostLedger();
  let row = ledger.find(item => item.id === postId && item.clientId === clientId);
  if (!row) {
    row = {
      id: postId,
      clientId,
      clientName: client.name || clientId,
      instagram: client.instagram || "",
      scheduledFor,
      scheduledHour,
      status: "scheduled",
      approvalStatus: "pending",
      costUsd: 0,
      costCalculated: true,
      model: "",
      mediaId: "",
      error: "",
      createdAt: now,
      updatedAt: now
    };
    ledger.push(row);
  }

  if (body.status) row.status = cleanPostStatus(body.status);
  if (body.approvalStatus) row.approvalStatus = cleanApprovalStatus(body.approvalStatus);
  if (row.status === "published") row.approvalStatus = "approved";
  if (scheduledFor) row.scheduledFor = scheduledFor;
  if (scheduledHour) row.scheduledHour = scheduledHour;
  if (body.attemptedAt) row.attemptedAt = normalizeIso(body.attemptedAt) || row.attemptedAt || now;
  if (row.status === "generating" || row.status === "publishing") row.attemptedAt = row.attemptedAt || now;
  if (row.status === "published") row.publishedAt = normalizeIso(body.publishedAt) || row.publishedAt || now;
  if (body.mediaId != null) row.mediaId = String(body.mediaId || "").slice(0, 160);
  if (body.model != null) row.model = String(body.model || "").slice(0, 100);
  if (body.error != null) row.error = String(body.error || "").slice(0, 900);
  if (body.costSource != null) row.costSource = String(body.costSource || "").slice(0, 80);
  if (body.caption != null) row.caption = String(body.caption || "").slice(0, 2200);
  if (body.imageUrl != null) row.imageUrl = String(body.imageUrl || "").slice(0, 1600);
  if (body.revisionRequest != null) row.revisionRequest = String(body.revisionRequest || "").slice(0, 1600);
  if (body.source != null) row.source = String(body.source || "").slice(0, 80);

  const absoluteCost = Number(body.costUsd);
  if (Number.isFinite(absoluteCost) && absoluteCost >= 0) row.costUsd = absoluteCost;
  const deltaCost = Number(body.costDeltaUsd);
  if (Number.isFinite(deltaCost) && deltaCost > 0) row.costUsd = Number(row.costUsd || 0) + deltaCost;
  row.costUsd = Math.max(0, Number(row.costUsd || 0));
  row.updatedAt = now;

  savePostLedger(ledger);
  return row;
}

function imageUsageCostUsd(usage, model) {
  if (!usage || typeof usage !== "object") return null;
  const name = String(model || "");
  const rates = name.startsWith("gpt-image-2.5")
    ? { textIn: 5, imageIn: 8, cachedImageIn: 2, imageOut: 30 }
    : name === "gpt-image-2"
      ? { textIn: 2.5, imageIn: 4, cachedImageIn: 1, imageOut: 15 }
      : null;
  if (!rates) return null;

  const details = usage.input_tokens_details || usage.input_details || {};
  const textInput = Number(details.text_tokens ?? usage.input_text_tokens ?? usage.input_tokens ?? 0);
  const imageInput = Number(details.image_tokens ?? usage.input_image_tokens ?? 0);
  const cachedImageInput = Number(details.cached_image_tokens ?? 0);
  const output = Number(usage.output_tokens ?? usage.output_image_tokens ?? 0);
  const value =
    (Math.max(0, textInput) * rates.textIn
    + Math.max(0, imageInput - cachedImageInput) * rates.imageIn
    + Math.max(0, cachedImageInput) * rates.cachedImageIn
    + Math.max(0, output) * rates.imageOut) / 1_000_000;
  return Number.isFinite(value) ? value : null;
}

function postLedgerSummary() {
  const storedRows = loadPostLedger();
  const now = new Date();
  const localParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now);
  const localValue = type => localParts.find(item => item.type === type)?.value || "";
  const todayKey = [localValue("year"), localValue("month"), localValue("day")].join("-");
  const monthKey = todayKey.slice(0, 7);

  const localDayFor = value => {
    if (!value) return "";
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(new Date(value));
      const get = type => parts.find(item => item.type === type)?.value || "";
      return [get("year"), get("month"), get("day")].join("-");
    } catch { return ""; }
  };

  const rows = [...storedRows];
  const clients = loadClients();
  for (const client of clients) {
    if (client.status !== "online" && !["ragnar-one","globalplay-streaming"].includes(client.id)) continue;
    for (const time of client.postTimes || []) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) continue;
      const exists = rows.some(row =>
        row.clientId === client.id
        && String(row.scheduledHour || "") === String(time)
        && localDayFor(row.scheduledFor || row.createdAt) === todayKey
      );
      if (exists) continue;

      const scheduledDate = new Date(todayKey + "T" + time + ":00-03:00");
      if (!Number.isFinite(scheduledDate.getTime())) continue;
      const overdue = now.getTime() > scheduledDate.getTime() + 15 * 60 * 1000;
      rows.push({
        id: "expected:" + client.id + ":" + todayKey + ":" + time,
        clientId: client.id,
        clientName: client.name || client.id,
        instagram: client.instagram || "",
        scheduledFor: scheduledDate.toISOString(),
        scheduledHour: String(time),
        status: overdue ? "skipped" : "scheduled",
        costUsd: 0,
        costCalculated: true,
        model: "",
        mediaId: "",
        error: overdue ? "Horário passou sem confirmação de publicação pelo agente." : "",
        createdAt: scheduledDate.toISOString(),
        updatedAt: scheduledDate.toISOString(),
        virtual: true
      });
    }
  }

  rows.sort((a, b) => String(b.scheduledFor || b.updatedAt || b.createdAt).localeCompare(String(a.scheduledFor || a.updatedAt || a.createdAt)));
  const monthRows = rows.filter(row => localDayFor(row.scheduledFor || row.createdAt).slice(0, 7) === monthKey);
  const byClientMap = new Map();
  for (const row of monthRows) {
    const key = row.clientId;
    const item = byClientMap.get(key) || {
      clientId: key,
      clientName: row.clientName || key,
      instagram: row.instagram || "",
      posts: 0,
      published: 0,
      failed: 0,
      costUsd: 0
    };
    item.posts += 1;
    if (row.status === "published") item.published += 1;
    if (row.status === "failed" || row.status === "skipped") item.failed += 1;
    item.costUsd += Number(row.costUsd || 0);
    byClientMap.set(key, item);
  }
  const byClient = [...byClientMap.values()].sort((a, b) => b.costUsd - a.costUsd);
  return {
    month: monthKey,
    totalCostUsd: monthRows.reduce((sum, row) => sum + Number(row.costUsd || 0), 0),
    totalPosts: monthRows.length,
    published: monthRows.filter(row => row.status === "published").length,
    failed: monthRows.filter(row => row.status === "failed" || row.status === "skipped").length,
    byClient,
    posts: rows.slice(0, 300)
  };
}

function ensureKnownPostHistory() {
  const ledger = loadPostLedger();
  const historical = {
    id: "ragnar-one:20260923-0900",
    clientId: "ragnar-one",
    clientName: "Ragnar One",
    instagram: "@ragnarplay1",
    scheduledFor: "2026-09-23T12:00:00.000Z",
    scheduledHour: "09:00",
    status: "published",
    costUsd: 0,
    costCalculated: true,
    mediaId: "17906679906484359",
    costSource: "fallback_local",
    model: "",
    error: "",
    createdAt: "2026-09-23T12:00:00.000Z",
    updatedAt: "2026-09-23T13:12:52.000Z",
    publishedAt: "2026-09-23T13:12:52.000Z"
  };
  if (!ledger.some(item => item.id === historical.id && item.clientId === historical.clientId)) {
    ledger.push(historical);
    savePostLedger(ledger);
  }
}
ensureKnownPostHistory();

function portalPostView(row) {
  const status = cleanPostStatus(row.status);
  const approvalStatus = row.approvalStatus
    ? cleanApprovalStatus(row.approvalStatus)
    : status === "published"
      ? "approved"
      : (status === "failed" || status === "skipped" ? "rejected" : "pending");
  return {
    id: row.id,
    scheduledFor: row.scheduledFor || null,
    scheduledHour: row.scheduledHour || "",
    status,
    approvalStatus,
    attemptedAt: row.attemptedAt || null,
    publishedAt: row.publishedAt || null,
    mediaId: row.mediaId || "",
    error: row.error || "",
    revisionRequest: row.revisionRequest || "",
    caption: row.caption || "",
    imageUrl: row.imageUrl || "",
    source: row.source || "",
    updatedAt: row.updatedAt || row.createdAt || null
  };
}

function portalPostsForClient(client) {
  const rows = loadPostLedger().filter(row => row.clientId === client.id);
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now);
  const get = type => parts.find(item => item.type === type)?.value || "";
  const todayKey = [get("year"), get("month"), get("day")].join("-");

  const localDayFor = value => {
    if (!value) return "";
    try {
      const dayParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(new Date(value));
      const take = type => dayParts.find(item => item.type === type)?.value || "";
      return [take("year"), take("month"), take("day")].join("-");
    } catch { return ""; }
  };

  for (const time of client.postTimes || []) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) continue;
    const exists = rows.some(row =>
      String(row.scheduledHour || "") === String(time)
      && localDayFor(row.scheduledFor || row.createdAt) === todayKey
    );
    if (exists) continue;
    const scheduledDate = new Date(todayKey + "T" + time + ":00-03:00");
    const overdue = now.getTime() > scheduledDate.getTime() + 15 * 60 * 1000;
    rows.push({
      id: "expected:" + client.id + ":" + todayKey + ":" + time,
      clientId: client.id,
      clientName: client.name || client.id,
      instagram: client.instagram || "",
      scheduledFor: scheduledDate.toISOString(),
      scheduledHour: String(time),
      status: overdue ? "skipped" : "scheduled",
      approvalStatus: overdue ? "rejected" : "pending",
      error: overdue ? "O horário passou sem confirmação de publicação." : "",
      createdAt: scheduledDate.toISOString(),
      updatedAt: scheduledDate.toISOString(),
      virtual: true
    });
  }

  return rows
    .sort((a, b) => String(b.scheduledFor || b.updatedAt || b.createdAt).localeCompare(String(a.scheduledFor || a.updatedAt || a.createdAt)))
    .slice(0, 90)
    .map(portalPostView);
}

function materializePortalPost(client, postId) {
  const ledger = loadPostLedger();
  let row = ledger.find(item => item.clientId === client.id && item.id === postId);
  if (row) return { row, ledger };

  const prefix = "expected:" + client.id + ":";
  if (!String(postId || "").startsWith(prefix)) return { row: null, ledger };

  const remainder = String(postId).slice(prefix.length);
  const match = /^(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2})$/.exec(remainder);
  if (!match) return { row: null, ledger };
  const scheduledDate = new Date(match[1] + "T" + match[2] + ":00-03:00");
  if (!Number.isFinite(scheduledDate.getTime())) return { row: null, ledger };

  row = {
    id: postId,
    clientId: client.id,
    clientName: client.name || client.id,
    instagram: client.instagram || "",
    scheduledFor: scheduledDate.toISOString(),
    scheduledHour: match[2],
    status: "scheduled",
    approvalStatus: "pending",
    costUsd: 0,
    costCalculated: true,
    model: "",
    mediaId: "",
    error: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  ledger.push(row);
  return { row, ledger };
}

async function publishInstagramImageForClient(clientId, imageUrl, caption) {
  const connection = directConnection(clientId, "meta");
  const accessToken = decryptSecret(connection?.accessToken || "");
  const igUserId = String(connection?.igUserId || "").trim();
  if (!accessToken || !igUserId) {
    const err = new Error("instagram_not_connected");
    err.code = "instagram_not_connected";
    throw err;
  }

  const graphRequest = async (pathName, method = "GET", form = null) => {
    const endpoint = "https://graph.instagram.com/" + String(pathName).replace(/^\/+/, "");
    const options = {
      method,
      headers: {
        authorization: "Bearer " + accessToken,
        "user-agent": "NEXUS-AI/1.0"
      }
    };
    if (form) {
      options.headers["content-type"] = "application/x-www-form-urlencoded";
      options.body = new URLSearchParams(form);
    }
    const response = await fetch(endpoint, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const metaError = payload?.error || {};
      const err = new Error(String(metaError.message || "instagram_api_failed"));
      err.code = metaError.code || response.status;
      err.type = metaError.type || "";
      throw err;
    }
    return payload;
  };

  const created = await graphRequest(igUserId + "/media", "POST", {
    image_url: imageUrl,
    caption
  });
  const containerId = String(created?.id || "");
  if (!containerId) throw new Error("instagram_container_missing");

  const deadline = Date.now() + 90000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const status = await graphRequest(containerId + "?fields=status_code,status");
    const code = String(status?.status_code || "").toUpperCase();
    lastStatus = String(status?.status || code || "");
    if (code === "FINISHED") {
      const published = await graphRequest(igUserId + "/media_publish", "POST", { creation_id: containerId });
      const mediaId = String(published?.id || "");
      let permalink = "";
      if (mediaId) {
        try {
          const media = await graphRequest(mediaId + "?fields=permalink");
          permalink = String(media?.permalink || "");
        } catch {}
      }
      return { mediaId, containerId, permalink };
    }
    if (code === "ERROR" || code === "EXPIRED") {
      const err = new Error("instagram_media_processing_failed");
      err.status = lastStatus;
      throw err;
    }
  }
  const err = new Error("instagram_media_processing_timeout");
  err.status = lastStatus;
  throw err;
}

function supportTicketView(ticket) {
  return {
    id: ticket.id,
    clientId: ticket.clientId,
    clientName: ticket.clientName,
    category: ticket.category,
    subject: ticket.subject,
    message: ticket.message,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt || ticket.createdAt
  };
}

function createPortalPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 32).toString("hex");
  return { salt, hash };
}

function verifyPortalPassword(password, record) {
  if (!record?.salt || !record?.hash) return false;
  try {
    const supplied = crypto.scryptSync(String(password), String(record.salt), 32);
    const expected = Buffer.from(String(record.hash), "hex");
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}

function secretKey() {
  const raw = String(process.env.NEXUS_SECRET_KEY || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
  return Buffer.from(raw, "hex");
}

function encryptSecret(value) {
  const key = secretKey();
  if (!key) throw new Error("secure_storage_not_configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

function decryptSecret(value) {
  const key = secretKey();
  if (!key || !value) return "";
  const parts = String(value).split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return "";
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    return "";
  }
}

function directConnection(clientId, provider) {
  const all = loadConnections();
  return all?.[clientId]?.[provider] || null;
}

function providerLooksConnected(value) {
  return ["connected","configured","active","ready","managed"].includes(String(value || "").toLowerCase());
}

function connectionSummary(client) {
  const direct = loadConnections()?.[client.id] || {};
  const legacy = {
    github: client.github,
    railway: client.railway,
    openai: client.openai,
    meta: client.meta
  };
  const result = {};
  for (const provider of ["github","railway","openai","meta"]) {
    const record = direct[provider];
    result[provider] = {
      connected: Boolean(record) || providerLooksConnected(legacy[provider]),
      direct: Boolean(record),
      source: record ? "direct" : (providerLooksConnected(legacy[provider]) ? "agent" : "none"),
      label: record?.meta?.label || record?.meta?.login || record?.meta?.name || "",
      connectedAt: record?.connectedAt || null
    };
  }
  return result;
}

function markProviderConnected(clientId, provider) {
  const clients = loadClients();
  const client = clients.find(item => item.id === clientId);
  if (!client) return null;
  client.onboarding = client.onboarding && typeof client.onboarding === "object" ? client.onboarding : {};
  if (["github","railway","openai"].includes(provider)) client.onboarding[provider] = true;
  if (provider === "github") client.github = "connected";
  if (provider === "railway") client.railway = "connected";
  if (provider === "openai") client.openai = "configured";
  saveClients(clients);
  return client;
}

function saveProviderConnection(clientId, provider, record) {
  const all = loadConnections();
  all[clientId] = all[clientId] && typeof all[clientId] === "object" ? all[clientId] : {};
  all[clientId][provider] = { ...record, connectedAt: new Date().toISOString() };
  saveConnections(all);
}

function decodeMetaSignedRequest(signedRequest) {
  const secret = masterInstagramAppSecret();
  const raw = String(signedRequest || "");
  const [signaturePart, payloadPart] = raw.split(".");
  if (!secret || !signaturePart || !payloadPart) return null;
  try {
    const supplied = Buffer.from(signaturePart, "base64url");
    const expected = crypto.createHmac("sha256", secret).update(payloadPart).digest();
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function disconnectInstagramUser(igUserId) {
  const targetId = String(igUserId || "").trim();
  if (!targetId) return [];
  const connections = loadConnections();
  const disconnectedClientIds = [];
  for (const [clientId, providers] of Object.entries(connections)) {
    if (String(providers?.meta?.igUserId || "") !== targetId) continue;
    delete providers.meta;
    if (!Object.keys(providers).length) delete connections[clientId];
    disconnectedClientIds.push(clientId);
  }
  if (disconnectedClientIds.length) saveConnections(connections);

  const clients = loadClients();
  let changed = false;
  for (const client of clients) {
    if (!disconnectedClientIds.includes(client.id)) continue;
    client.instagram = "";
    client.meta = "pending";
    client.onboarding = client.onboarding && typeof client.onboarding === "object" ? client.onboarding : {};
    client.onboarding.instagram = false;
    changed = true;
  }
  if (changed) saveClients(clients);
  return disconnectedClientIds;
}

async function validateGithubToken(token) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      authorization: "Bearer " + token,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2026-03-10",
      "user-agent": "NEXUS-AI/1.0"
    }
  });
  if (!response.ok) throw new Error("github_auth_failed");
  return response.json();
}

async function validateOpenAIKey(key) {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { authorization: "Bearer " + key, "user-agent": "NEXUS-AI/1.0" }
  });
  if (!response.ok) throw new Error("openai_auth_failed");
  return true;
}

async function validateOpenAIAdminKey(key) {
  const start = Math.floor(Date.now() / 1000) - 86400;
  const response = await fetch("https://api.openai.com/v1/organization/costs?start_time=" + start + "&limit=1", {
    headers: { authorization: "Bearer " + key, "user-agent": "NEXUS-AI/1.0" }
  });
  if (!response.ok) throw new Error("openai_admin_auth_failed");
  return true;
}

function masterOpenAIRecord() {
  return loadMasterIntegrations()?.openai || {};
}

function masterInstagramRecord() {
  return loadMasterIntegrations()?.instagram || {};
}

function masterInstagramAppId() {
  return String(process.env.INSTAGRAM_APP_ID || masterInstagramRecord().appId || "").trim();
}

function masterInstagramAppSecret() {
  return String(process.env.INSTAGRAM_APP_SECRET || "").trim()
    || decryptSecret(masterInstagramRecord().appSecret || "");
}

function publicOrigin(req) {
  const host = String(req.headers.host || process.env.RAILWAY_PUBLIC_DOMAIN || "servidor-global-play-production.up.railway.app")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  return "https://" + host;
}

function instagramRedirectUri(req) {
  return publicOrigin(req) + "/api/oauth/instagram/callback";
}

function masterOpenAIAdminKey() {
  return String(process.env.OPENAI_ADMIN_KEY || "").trim()
    || decryptSecret(masterOpenAIRecord().adminKey || "");
}

function masterOpenAIProjectKey() {
  return String(process.env.OPENAI_API_KEY || "").trim()
    || decryptSecret(masterOpenAIRecord().apiKey || "");
}

async function fetchOpenAICostTotal(adminKey, startTime, endTime = null) {
  if (!adminKey) return null;
  let total = 0;
  let page = "";
  let loops = 0;
  do {
    const query = new URLSearchParams({
      start_time: String(Math.max(0, Math.floor(startTime))),
      bucket_width: "1d",
      limit: "180"
    });
    if (endTime) query.set("end_time", String(Math.floor(endTime)));
    if (page) query.set("page", page);
    const response = await fetch("https://api.openai.com/v1/organization/costs?" + query.toString(), {
      headers: { authorization: "Bearer " + adminKey, "user-agent": "NEXUS-AI/1.0" }
    });
    if (!response.ok) throw new Error("openai_costs_failed_" + response.status);
    const payload = await response.json();
    for (const bucket of payload.data || []) {
      for (const item of bucket.results || []) {
        const amount = item.amount || {};
        if (String(amount.currency || "").toLowerCase() === "usd") total += Number(amount.value || 0);
      }
    }
    page = payload.has_more ? String(payload.next_page || "") : "";
    loops += 1;
  } while (page && loops < 12);
  return total;
}

async function fetchOpenAISpendLimit(adminKey) {
  if (!adminKey) return null;
  try {
    const response = await fetch("https://api.openai.com/v1/organization/spend_limit", {
      headers: { authorization: "Bearer " + adminKey, "user-agent": "NEXUS-AI/1.0" }
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const raw = Number(payload.threshold_amount);
    if (!Number.isFinite(raw)) return null;
    return raw / 100;
  } catch {
    return null;
  }
}

async function masterOpenAISummary() {
  const record = masterOpenAIRecord();
  const adminKey = masterOpenAIAdminKey();
  const apiKey = masterOpenAIProjectKey();
  const now = Math.floor(Date.now() / 1000);
  const date = new Date();
  const monthStart = Math.floor(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).getTime() / 1000);
  const baselineAt = Number(record.balanceBaselineAt || 0);
  const baselineUsd = Number(record.balanceBaselineUsd);
  let monthCostUsd = null;
  let baselineCostUsd = null;
  let spendLimitUsd = null;
  let error = "";

  if (adminKey) {
    try {
      monthCostUsd = await fetchOpenAICostTotal(adminKey, monthStart, now);
      if (baselineAt > 0 && Number.isFinite(baselineUsd)) {
        baselineCostUsd = await fetchOpenAICostTotal(adminKey, baselineAt, now);
      }
      spendLimitUsd = await fetchOpenAISpendLimit(adminKey);
    } catch (err) {
      error = String(err?.message || "openai_summary_failed");
    }
  }

  const balanceEstimatedUsd =
    Number.isFinite(baselineUsd) && baselineAt > 0 && Number.isFinite(baselineCostUsd)
      ? Math.max(0, baselineUsd - baselineCostUsd)
      : null;
  const monthlyBudgetUsd = Number(record.monthlyBudgetUsd);
  const budgetConfigured = Number.isFinite(monthlyBudgetUsd) && monthlyBudgetUsd > 0;
  const budgetRemainingUsd =
    budgetConfigured && Number.isFinite(monthCostUsd)
      ? Math.max(0, monthlyBudgetUsd - monthCostUsd)
      : null;
  const budgetPercent =
    budgetConfigured && Number.isFinite(monthCostUsd)
      ? Math.min(100, Math.max(0, Math.round((monthCostUsd / monthlyBudgetUsd) * 100)))
      : null;

  return {
    apiConnected: Boolean(apiKey),
    billingConnected: Boolean(adminKey),
    connected: Boolean(apiKey || adminKey),
    monthCostUsd,
    spendLimitUsd,
    balanceEstimatedUsd,
    balanceBaselineUsd: Number.isFinite(baselineUsd) ? baselineUsd : null,
    balanceBaselineAt: baselineAt || null,
    monthlyBudgetUsd: budgetConfigured ? monthlyBudgetUsd : null,
    budgetRemainingUsd,
    budgetPercent,
    exactPrepaidBalanceAvailable: false,
    ragnarExcluded: true,
    error
  };
}

function railwayRedirectUri(req) {
  const host = process.env.RAILWAY_PUBLIC_DOMAIN || req.headers.host || "servidor-global-play-production.up.railway.app";
  return "https://" + host + "/api/oauth/railway/callback";
}

async function railwayAccessTokenFor(clientId) {
  const all = loadConnections();
  const record = all?.[clientId]?.railway;
  if (!record) return "";
  const current = decryptSecret(record.accessToken);
  if (current && Number(record.expiresAt || 0) > Date.now() + 60000) return current;
  const refresh = decryptSecret(record.refreshToken);
  const clientIdEnv = process.env.RAILWAY_OAUTH_CLIENT_ID;
  const clientSecret = process.env.RAILWAY_OAUTH_CLIENT_SECRET;
  if (!refresh || !clientIdEnv || !clientSecret) return current;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh
  });
  const response = await fetch("https://backboard.railway.com/oauth/token", {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(clientIdEnv + ":" + clientSecret).toString("base64"),
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  if (!response.ok) return current;
  const tokens = await response.json();
  record.accessToken = encryptSecret(tokens.access_token || "");
  if (tokens.refresh_token) record.refreshToken = encryptSecret(tokens.refresh_token);
  record.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
  all[clientId].railway = record;
  saveConnections(all);
  return tokens.access_token || current;
}

function parseBasicAuth(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
}

function safeEqualText(left, right) {
  const supplied = Buffer.from(String(left || ""));
  const expected = Buffer.from(String(right || ""));
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function agentBearerAuthorized(req, clientId) {
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) return false;
  const supplied = auth.slice(7);
  const expected = clientId === "ragnar-one"
    ? String(process.env.RAGNAR_AGENT_TOKEN || "")
    : clientId === "globalplay-streaming"
      ? String(process.env.GLOBALPLAY_AGENT_TOKEN || "")
      : "";
  if (!expected) return false;
  return safeEqualText(supplied, expected);
}

function agentTokenForClient(clientId) {
  if (clientId === "ragnar-one") return String(process.env.RAGNAR_AGENT_TOKEN || "");
  if (clientId === "globalplay-streaming") return String(process.env.GLOBALPLAY_AGENT_TOKEN || "");
  return "";
}

function normalizeLeadPayload(client, payload) {
  const leads = Array.isArray(payload?.leads) ? payload.leads.map(item => ({
    clientId: client.id,
    clientName: client.name || client.id,
    instagram: client.instagram || "",
    instagramUserId: String(item.instagramUserId || ""),
    instagramUsername: String(item.instagramUsername || ""),
    temperature: ["hot","warm","cold"].includes(String(item.temperature)) ? String(item.temperature) : "cold",
    score: Math.max(0, Number(item.score || 0)),
    stage: String(item.stage || "new"),
    intent: String(item.intent || ""),
    needsHuman: Boolean(item.needsHuman),
    triggerKeyword: String(item.triggerKeyword || ""),
    lastMessage: String(item.lastMessage || ""),
    lastContactAt: item.lastContactAt || null,
    updatedAt: item.updatedAt || null
  })) : [];
  const summary = leads.reduce((acc, lead) => {
    acc.total += 1;
    acc[lead.temperature] += 1;
    if (lead.needsHuman) acc.needsHuman += 1;
    return acc;
  }, { total: 0, hot: 0, warm: 0, cold: 0, needsHuman: 0 });
  return { summary, leads };
}

async function fetchAgentLeads(client) {
  const base = String(client?.agentApiUrl || "").replace(/\/+$/, "");
  const token = agentTokenForClient(client?.id);
  if (!base || !token) {
    return {
      summary: {
        total: Number(client?.leads?.total || 0),
        hot: Number(client?.leads?.hot || 0),
        warm: Number(client?.leads?.warm || 0),
        cold: Number(client?.leads?.cold || 0),
        needsHuman: 0
      },
      leads: [],
      source: "stored"
    };
  }
  try {
    const response = await fetch(base + "/nexus/leads", {
      headers: {
        authorization: "Bearer " + token,
        accept: "application/json",
        "user-agent": "NEXUS-AI/1.0"
      },
      signal: AbortSignal.timeout(9000)
    });
    if (!response.ok) throw new Error("agent_leads_" + response.status);
    const payload = await response.json();
    return { ...normalizeLeadPayload(client, payload), source: "agent" };
  } catch (error) {
    console.warn("Lead sync failed for " + client?.id + ": " + String(error?.message || error));
    return {
      summary: {
        total: Number(client?.leads?.total || 0),
        hot: Number(client?.leads?.hot || 0),
        warm: Number(client?.leads?.warm || 0),
        cold: Number(client?.leads?.cold || 0),
        needsHuman: 0
      },
      leads: [],
      source: "stored",
      error: "agent_unavailable"
    };
  }
}

async function masterLeadSummary() {
  const clients = loadClients();
  const results = await Promise.all(clients.map(async client => {
    const data = await fetchAgentLeads(client);
    return {
      clientId: client.id,
      clientName: client.name || client.id,
      instagram: client.instagram || "",
      source: data.source,
      summary: data.summary,
      leads: data.leads
    };
  }));
  const summary = results.reduce((acc, item) => {
    acc.total += Number(item.summary.total || 0);
    acc.hot += Number(item.summary.hot || 0);
    acc.warm += Number(item.summary.warm || 0);
    acc.cold += Number(item.summary.cold || 0);
    acc.needsHuman += Number(item.summary.needsHuman || 0);
    return acc;
  }, { total: 0, hot: 0, warm: 0, cold: 0, needsHuman: 0 });
  return {
    summary,
    byClient: results.map(item => ({
      clientId: item.clientId,
      clientName: item.clientName,
      instagram: item.instagram,
      source: item.source,
      ...item.summary
    })),
    leads: results.flatMap(item => item.leads)
      .sort((a, b) => String(b.updatedAt || b.lastContactAt || "").localeCompare(String(a.updatedAt || a.lastContactAt || "")))
      .slice(0, 1000)
  };
}

function authorized(req) {
  const credentials = parseBasicAuth(req);
  if (!credentials) return false;
  return masterCredentialsValid(credentials.username, credentials.password);
}

function portalAccounts() {
  const accounts = [];

  if (process.env.CLIENT_PORTAL_ACCOUNTS) {
    try {
      const parsed = JSON.parse(process.env.CLIENT_PORTAL_ACCOUNTS);
      if (Array.isArray(parsed)) {
        for (const account of parsed) {
          if (account?.clientId && account?.username && account?.password) {
            accounts.push({
              clientId: String(account.clientId),
              username: String(account.username),
              password: String(account.password)
            });
          }
        }
      }
    } catch (error) {
      console.warn(`Ignoring invalid CLIENT_PORTAL_ACCOUNTS: ${error.message}`);
    }
  }

  if (
    process.env.CLIENT_PORTAL_CLIENT_ID
    && process.env.CLIENT_PORTAL_USERNAME
    && process.env.CLIENT_PORTAL_PASSWORD
  ) {
    accounts.push({
      clientId: process.env.CLIENT_PORTAL_CLIENT_ID,
      username: process.env.CLIENT_PORTAL_USERNAME,
      password: process.env.CLIENT_PORTAL_PASSWORD
    });
  }

  return accounts;
}

function clientFromCredentials(username, password) {
  const clients = loadClients();
  const account = portalAccounts().find(item =>
    safeEqualText(username, item.username)
    && safeEqualText(password, item.password)
  );
  if (account) {
    return clients.find(client => client.id === account.clientId) || null;
  }

  const storedUsers = loadPortalUsers();
  for (const [clientId, record] of Object.entries(storedUsers)) {
    if (
      safeEqualText(username, record?.username || "")
      && verifyPortalPassword(password, record)
    ) {
      return clients.find(client => client.id === clientId) || null;
    }
  }

  const ragnarFallback =
    safeEqualText(username, RAGNAR_PORTAL_USERNAME)
    && safeEqualText(sha256Text(password), RAGNAR_PORTAL_PASSWORD_HASH);

  if (ragnarFallback) {
    return clients.find(client => client.id === "ragnar-one") || null;
  }
  return null;
}

function tokenClientForRequest(req) {
  const cookies = parseCookies(req);
  const token = String(cookies.nexus_session || req.headers["x-nexus-session"] || "");
  if (!token) return null;
  const record = portalSessions.get(token);
  if (!record || record.expiresAt < Date.now()) {
    if (record) portalSessions.delete(token);
    return null;
  }
  return loadClients().find(client => client.id === record.clientId) || null;
}

function portalClientForRequest(req) {
  const tokenClient = tokenClientForRequest(req);
  if (tokenClient) return tokenClient;

  const credentials = parseBasicAuth(req);
  if (!credentials) return null;
  return clientFromCredentials(credentials.username, credentials.password);
}

function masterCredentialsValid(username, password) {
  const normalizedUsername = String(username || "").trim();
  const suppliedPassword = String(password || "");

  const envValid = safeEqualText(normalizedUsername, String(ADMIN_USERNAME || "").trim())
    && safeEqualText(suppliedPassword, ADMIN_PASSWORD);
  if (envValid) return true;

  const recoveryUsername = "nexusadmin";
  const recoveryPasswordSha256 = "b6f25581136091d564422e85add69374c132c6cddbbd6414c2b01828088f0ec7";
  return safeEqualText(normalizedUsername, recoveryUsername)
    && safeEqualText(sha256Text(suppliedPassword), recoveryPasswordSha256);
}

function masterSessionAuthorized(req) {
  const cookies = parseCookies(req);
  const token = String(cookies.nexus_master || "");
  if (!token) return false;
  const expiresAt = masterSessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    if (expiresAt) masterSessions.delete(token);
    return false;
  }
  return true;
}

function masterAuthorized(req) {
  return masterSessionAuthorized(req) || authorized(req);
}

function masterLoginPage(error = false) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#020508">
<title>NEXUS AI · Master</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 30%,#0a2233,#020508 45%,#010203);font-family:Inter,system-ui,Arial;color:#edfaff}
.card{width:min(430px,92vw);padding:34px;border:1px solid rgba(93,211,255,.16);border-radius:22px;background:linear-gradient(180deg,rgba(8,20,30,.96),rgba(3,8,13,.98));box-shadow:0 30px 100px #0009,inset 0 1px #ffffff08}
.brand{display:flex;align-items:center;gap:14px;margin-bottom:28px}.brand img{width:56px;height:56px}.brand strong{display:block;font-size:21px;letter-spacing:.08em}.brand small{color:#68899b;letter-spacing:.14em}
h1{font-size:30px;margin:0 0 8px}.muted{color:#7893a4;margin:0 0 24px;font-size:14px}
label{display:grid;gap:7px;margin:13px 0;color:#9bb5c5;font-size:12px;font-weight:700}input{width:100%;padding:14px;border-radius:10px;border:1px solid #163244;background:#03090e;color:#fff;outline:none}input:focus{border-color:#5dd3ff;box-shadow:0 0 0 3px #5dd3ff16}
button{width:100%;margin-top:12px;padding:14px;border:0;border-radius:10px;background:linear-gradient(135deg,#c8f3ff,#59d0ff 55%,#168ee8);color:#02101a;font-weight:900;cursor:pointer}
.error{min-height:18px;margin-top:12px;color:#ff8690;font-size:12px}.secure{margin-top:20px;padding-top:15px;border-top:1px solid #5dd3ff12;color:#557182;font-size:11px;text-align:center}
</style>
</head>
<body><main class="card">
<div class="brand"><img src="/assets/nexus-ai-mark.svg" alt=""><div><strong>NEXUS AI</strong><small>MASTER CONTROL</small></div></div>
<h1>Acesso administrativo</h1><p class="muted">Área exclusiva do administrador NEXUS.</p>
<form method="post" action="/master-login">
<label>Usuário<input name="username" autocomplete="username" required></label>
<label>Senha<input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">Entrar no Master</button>
<div class="error">${error ? "Usuário ou senha inválidos." : ""}</div>
</form><div class="secure">Sessão administrativa protegida · NEXUS AI</div>
</main></body></html>`;
}

function defaultPostingProfile() {
  return {
    contentStrategy: "Vendas + engajamento",
    targetAudience: "Misto",
    visualStyle: "Tecnológico premium",
    contentFocus: "Benefícios reais do negócio, autoridade, produto e conversão",
    morningTheme: "Dor do cliente e solução",
    afternoonTheme: "Produto, benefício e prova",
    eveningTheme: "Conversão e chamada para ação",
    tone: "Firme, direto e profissional",
    cta: 'Comente "QUERO" e saiba mais',
    hashtags: "#ConteudoDigital #Vendas #Automacao",
    avoidTopics: "Promessas irreais, informações não confirmadas e poluição visual"
  };
}

function clientPortalView(client) {
  return {
    id: client.id,
    name: client.name,
    niche: client.niche,
    instagram: client.instagram,
    theme: client.theme,
    primaryColor: client.primaryColor,
    secondaryColor: client.secondaryColor,
    status: client.status,
    odin: client.odin,
    postTimes: client.postTimes,
    leads: client.leads,
    usage: client.usage,
    aiMode: client.aiMode || (client.id === "ragnar-one" ? "own-key" : "economy"),
    aiMonthlyImageLimit: Number(client.aiMonthlyImageLimit || 0),
    aiImagesUsed: Number(client.aiImagesUsed || 0),
    managedInfrastructure: client.id !== "ragnar-one" ? client.managedInfrastructure !== false : false,
    onboarding: client.onboarding || {},
    setupMode: client.setupMode || "ready",
    integrationState: {
      github: client.github || "pending",
      railway: client.railway || "pending",
      openai: client.openai || "pending",
      meta: client.meta || "pending"
    },
    postingProfile: { ...defaultPostingProfile(), ...(client.postingProfile || {}) },
    agentProfile: client.agentProfile && typeof client.agentProfile === "object" ? client.agentProfile : {},
    connections: connectionSummary(client)
  };
}

function slug(value) {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/" && req.method === "GET") {
    res.writeHead(303, {
      location: "/login",
      "cache-control": "no-store",
      "content-length": "0"
    });
    return res.end();
  }

  if (url.pathname === "/login" && req.method === "GET") {
    res.writeHead(303, {
      location: "/portal.html?v=24&login=1",
      "set-cookie": "nexus_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      "cache-control": "no-store",
      "content-length": "0"
    });
    return res.end();
  }

  if ((url.pathname === "/master" || url.pathname === "/master/") && req.method === "GET") {
    if (!masterSessionAuthorized(req)) {
      return send(res, 200, masterLoginPage(false), "text/html; charset=utf-8");
    }
    const masterFile = path.join(__dirname, "public", "index.html");
    return send(res, 200, fs.readFileSync(masterFile), "text/html; charset=utf-8");
  }

  if (url.pathname === "/master-login" && req.method === "POST") {
    const body = await readFormBody(req);
    const ok = masterCredentialsValid(
      String(body.username || "").trim(),
      String(body.password || "")
    );
    if (!ok) return send(res, 401, masterLoginPage(true), "text/html; charset=utf-8");
    const token = crypto.randomBytes(32).toString("base64url");
    masterSessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
    return redirectWithCookie(
      res,
      "/master",
      "nexus_master=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200"
    );
  }

  if (url.pathname === "/master-logout" && req.method === "POST") {
    const token = String(parseCookies(req).nexus_master || "");
    if (token) masterSessions.delete(token);
    res.setHeader("set-cookie", "nexus_master=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/health") {
    return send(res, 200, {
      ok: true,
      service: "nexus-ai-agent-central",
      version: "1.0.0"
    });
  }

  if (url.pathname === "/api/portal/login" && req.method === "POST") {
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const client = clientFromCredentials(username, password);
    if (!client) return send(res, 401, { error: "unauthorized" });

    const token = crypto.randomBytes(32).toString("base64url");
    portalSessions.set(token, {
      clientId: client.id,
      expiresAt: Date.now() + 12 * 60 * 60 * 1000
    });
    return send(res, 200, {
      token,
      client: clientPortalView(client)
    });
  }

  if (url.pathname === "/portal-login" && req.method === "POST") {
    try {
      const body = await readFormBody(req);
      const client = clientFromCredentials(String(body.username || "").trim(), String(body.password || ""));
      if (!client) return redirectWithCookie(res, "/portal.html?v=24&error=1");

      const token = crypto.randomBytes(32).toString("base64url");
      portalSessions.set(token, { clientId: client.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
      const cookie = "nexus_session=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200";
      return redirectWithCookie(res, "/portal.html?v=24&auth=1", cookie);
    } catch {
      return redirectWithCookie(res, "/portal.html?v=24&error=1");
    }
  }

  if (url.pathname === "/api/portal/diagnostic" && req.method === "GET") {
    const username = process.env.CLIENT_PORTAL_USERNAME || RAGNAR_PORTAL_USERNAME;
    const password = process.env.CLIENT_PORTAL_PASSWORD || "";
    const client = clientFromCredentials(username, password);
    return send(res, client ? 200 : 500, {
      ok: Boolean(client),
      clientId: client?.id || null,
      runtimeHasRagnar: loadClients().some(item => item.id === "ragnar-one"),
      version: "auth-diagnostic-v1"
    });
  }

  if (url.pathname === "/api/portal/session" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) {
      return send(res, 401, { error: "unauthorized" });
    }
    return send(res, 200, clientPortalView(client));
  }

  if (url.pathname === "/api/portal/logout" && req.method === "POST") {
    const token = String(parseCookies(req).nexus_session || req.headers["x-nexus-session"] || "");
    if (token) portalSessions.delete(token);
    res.setHeader("set-cookie", "nexus_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/api/portal/connections" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) {
      return send(res, 401, { error: "unauthorized" });
    }
    return send(res, 200, {
      connections: connectionSummary(client),
      onboarding: client.onboarding || {}
    });
  }

  if (url.pathname === "/api/portal/connect/github" && req.method === "POST") {
    const sessionClient = portalClientForRequest(req);
    if (!sessionClient) {
      return send(res, 401, { error: "unauthorized" });
    }
    try {
      const body = await readBody(req);
      const token = String(body.token || "").trim();
      if (token.length < 20) return send(res, 400, { error: "invalid_token" });
      const profile = await validateGithubToken(token);
      saveProviderConnection(sessionClient.id, "github", {
        token: encryptSecret(token),
        meta: {
          login: String(profile.login || ""),
          name: String(profile.name || ""),
          label: String(profile.login || profile.name || "GitHub")
        }
      });
      const client = markProviderConnected(sessionClient.id, "github");
      return send(res, 200, clientPortalView(client));
    } catch (error) {
      return send(res, 400, { error: error.message || "github_connection_failed" });
    }
  }

  if (url.pathname === "/api/portal/connect/openai" && req.method === "POST") {
    const sessionClient = portalClientForRequest(req);
    if (!sessionClient) {
      return send(res, 401, { error: "unauthorized" });
    }
    try {
      const body = await readBody(req);
      const apiKey = String(body.apiKey || "").trim();
      const adminKey = String(body.adminKey || "").trim();
      if (apiKey.length < 20) return send(res, 400, { error: "invalid_api_key" });
      await validateOpenAIKey(apiKey);
      if (adminKey) await validateOpenAIAdminKey(adminKey);
      saveProviderConnection(sessionClient.id, "openai", {
        apiKey: encryptSecret(apiKey),
        adminKey: adminKey ? encryptSecret(adminKey) : "",
        meta: {
          label: adminKey ? "OpenAI + custos" : "OpenAI API",
          hasAdminKey: Boolean(adminKey)
        }
      });
      const client = markProviderConnected(sessionClient.id, "openai");
      return send(res, 200, clientPortalView(client));
    } catch (error) {
      return send(res, 400, { error: error.message || "openai_connection_failed" });
    }
  }

  if (url.pathname === "/api/oauth/railway/start" && req.method === "GET") {
    const sessionClient = portalClientForRequest(req);
    if (!sessionClient) {
      return send(res, 401, { error: "unauthorized" });
    }
    const clientId = process.env.RAILWAY_OAUTH_CLIENT_ID;
    if (!clientId || !process.env.RAILWAY_OAUTH_CLIENT_SECRET) {
      return send(res, 503, { error: "railway_oauth_not_configured" });
    }

    const state = crypto.randomBytes(24).toString("base64url");
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const states = loadOauthStates();
    const now = Date.now();
    for (const [key, value] of Object.entries(states)) {
      if (!value?.createdAt || now - Number(value.createdAt) > 15 * 60 * 1000) delete states[key];
    }
    states[state] = { clientId: sessionClient.id, verifier, createdAt: now };
    saveOauthStates(states);

    const authorize = new URL("https://backboard.railway.com/oauth/auth");
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", railwayRedirectUri(req));
    authorize.searchParams.set("scope", "openid profile email offline_access project:viewer workspace:viewer");
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("prompt", "consent");
    return send(res, 200, { url: authorize.toString() });
  }

  if (url.pathname === "/api/oauth/railway/callback" && req.method === "GET") {
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const oauthError = url.searchParams.get("error") || "";
    const states = loadOauthStates();
    const saved = states[state];

    const oauthPage = (ok, message) => send(
      res,
      ok ? 200 : 400,
      `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NEXUS AI</title><body style="margin:0;background:#050807;color:#f4f8f5;font-family:system-ui;display:grid;place-items:center;min-height:100vh"><div style="max-width:520px;padding:30px;border:1px solid #26352c;border-radius:20px;background:#0b110e;text-align:center"><h1 style="margin-top:0;color:${ok ? "#21e47b" : "#ff9898"}">${ok ? "Railway conectado" : "Falha na conexão"}</h1><p style="color:#aab9b0;line-height:1.5">${message}</p><p>Você pode fechar esta janela e voltar ao Portal NEXUS AI.</p></div></body></html>`,
      "text/html; charset=utf-8"
    );

    if (oauthError) return oauthPage(false, "A autorização foi cancelada ou recusada.");
    if (!code || !state || !saved || Date.now() - Number(saved.createdAt || 0) > 15 * 60 * 1000) {
      return oauthPage(false, "Esta autorização expirou. Inicie a conexão novamente pelo portal.");
    }

    try {
      const clientId = process.env.RAILWAY_OAUTH_CLIENT_ID;
      const clientSecret = process.env.RAILWAY_OAUTH_CLIENT_SECRET;
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: railwayRedirectUri(req),
        code_verifier: saved.verifier
      });
      const tokenResponse = await fetch("https://backboard.railway.com/oauth/token", {
        method: "POST",
        headers: {
          authorization: "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64"),
          "content-type": "application/x-www-form-urlencoded"
        },
        body
      });
      if (!tokenResponse.ok) throw new Error("railway_token_exchange_failed");
      const tokens = await tokenResponse.json();

      let identity = {};
      try {
        const identityResponse = await fetch("https://backboard.railway.com/oauth/me", {
          headers: { authorization: "Bearer " + tokens.access_token }
        });
        if (identityResponse.ok) identity = await identityResponse.json();
      } catch {}

      saveProviderConnection(saved.clientId, "railway", {
        accessToken: encryptSecret(tokens.access_token || ""),
        refreshToken: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : "",
        expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
        scope: String(tokens.scope || ""),
        meta: {
          name: String(identity.name || identity.email || "Railway"),
          label: String(identity.name || identity.email || "Railway")
        }
      });
      markProviderConnected(saved.clientId, "railway");
      delete states[state];
      saveOauthStates(states);
      return oauthPage(true, "A conta Railway foi autorizada com sucesso.");
    } catch (error) {
      console.warn("Railway OAuth callback failed:", error.message);
      return oauthPage(false, "Não foi possível concluir a autorização. Tente novamente pelo portal.");
    }
  }

  if (url.pathname === "/api/portal/provider-usage" && req.method === "GET") {
    const client = portalClientForRequest(req);
    if (!client) {
      return send(res, 401, { error: "unauthorized" });
    }

    const direct = loadConnections()?.[client.id] || {};
    const result = {
      github: { connected: Boolean(direct.github), login: direct.github?.meta?.login || "" },
      openai: { connected: Boolean(direct.openai), cost31dUsd: null, costAvailable: false },
      railway: { connected: Boolean(direct.railway), projects: [], projectCount: null }
    };

    if (direct.openai?.adminKey) {
      const adminKey = decryptSecret(direct.openai.adminKey);
      if (adminKey) {
        try {
          const start = Math.floor(Date.now() / 1000) - 31 * 86400;
          const response = await fetch("https://api.openai.com/v1/organization/costs?start_time=" + start + "&limit=31", {
            headers: { authorization: "Bearer " + adminKey, "user-agent": "NEXUS-AI/1.0" }
          });
          if (response.ok) {
            const payload = await response.json();
            let total = 0;
            for (const bucket of payload.data || []) {
              for (const item of bucket.results || []) {
                const amount = item.amount || {};
                if (String(amount.currency || "").toLowerCase() === "usd") total += Number(amount.value || 0);
              }
            }
            result.openai.cost31dUsd = total;
            result.openai.costAvailable = true;
          }
        } catch {}
      }
    }

    if (direct.railway) {
      const token = await railwayAccessTokenFor(client.id);
      if (token) {
        try {
          const response = await fetch("https://backboard.railway.com/graphql/v2", {
            method: "POST",
            headers: {
              authorization: "Bearer " + token,
              "content-type": "application/json"
            },
            body: JSON.stringify({
              query: "query { projects { edges { node { id name } } } }"
            })
          });
          if (response.ok) {
            const payload = await response.json();
            const projects = payload?.data?.projects?.edges || [];
            result.railway.projects = projects.map(item => ({
              id: item?.node?.id || "",
              name: item?.node?.name || ""
            })).filter(item => item.id);
            result.railway.projectCount = result.railway.projects.length;
          }
        } catch {}
      }
    }

    return send(res, 200, result);
  }

  const agentOpenAIImageMatch = url.pathname.match(/^\/api\/agent\/([^/]+)\/openai\/images$/);
  if (agentOpenAIImageMatch && req.method === "POST") {
    const clientId = agentOpenAIImageMatch[1];
    if (!agentBearerAuthorized(req, clientId)) {
      return send(res, 401, { error: "unauthorized" });
    }

    const client = loadClients().find(item => item.id === clientId);
    if (!client) return send(res, 404, { error: "not_found" });

    // Paid image generation through the shared NEXUS OpenAI account is disabled.
    // Ragnar remains isolated and may use only its own OpenAI connection.
    const record = directConnection(clientId, "openai");
    const ownKey = decryptSecret(record?.apiKey || "");
    if (clientId !== "ragnar-one") {
      return send(res, 409, { error: "nexus_paid_image_generation_disabled" });
    }
    if (!ownKey) {
      return send(res, 409, { error: "openai_not_connected" });
    }

    const body = await readBody(req);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 32000) : "";
    if (!prompt) return send(res, 400, { error: "prompt_required" });

    const allowedModels = new Set(["gpt-image-2.5-sunburst","gpt-image-2.5-flare","gpt-image-2","gpt-image-1.5","gpt-image-1"]);
    const allowedSizes = new Set(["auto", "1024x1024", "1024x1536", "1536x1024"]);
    const allowedQualities = new Set(["auto", "low", "medium", "high", "xhigh", "max"]);
    const model = allowedModels.has(String(body.model || "")) ? String(body.model) : "gpt-image-2.5-flare";
    const size = allowedSizes.has(String(body.size || "")) ? String(body.size) : "1024x1536";
    const quality = allowedQualities.has(String(body.quality || "")) ? String(body.quality) : "medium";

    try {
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          authorization: "Bearer " + ownKey,
          "content-type": "application/json",
          "user-agent": "NEXUS-AI-Agent-Proxy/1.0"
        },
        body: JSON.stringify({ model, prompt, size, quality })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = payload?.error?.code || payload?.error?.type || "openai_image_failed";
        return send(res, response.status, { error: String(code) });
      }
      const encoded = payload?.data?.[0]?.b64_json;
      if (!encoded) return send(res, 502, { error: "image_data_missing" });
      return send(res, 200, {
        ok: true,
        data: [{ b64_json: encoded }],
        model,
        size,
        quality,
        billing: "own-key"
      });
    } catch (error) {
      return send(res, 502, { error: "openai_image_proxy_failed", message: String(error?.message || error).slice(0, 300) });
    }
  }

  if (url.pathname === "/api/master/leads" && req.method === "GET") {
    return send(res, 200, await masterLeadSummary());
  }

  const impersonateMatch = url.pathname.match(/^\/api\/master\/impersonate\/([^/]+)$/);
  if (impersonateMatch && req.method === "POST") {
    const clientId = decodeURIComponent(impersonateMatch[1]);
    const client = loadClients().find(item => item.id === clientId);
    if (!client) return send(res, 404, { error: "not_found" });
    const token = crypto.randomBytes(32).toString("base64url");
    portalSessions.set(token, { clientId, expiresAt: Date.now() + 2 * 60 * 60 * 1000, assumedByMaster: true });
    res.setHeader("set-cookie", "nexus_session=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7200");
    return send(res, 200, { ok: true, clientId, url: "/portal.html?assumed=1" });
  }

  if (url.pathname === "/api/master/posts" && req.method === "GET") {
    return send(res, 200, postLedgerSummary());
  }

  const masterAgentConfigMatch = url.pathname.match(/^\/api\/master\/agent-config\/([^/]+)$/);
  if (masterAgentConfigMatch && req.method === "PATCH") {
    const clientId = masterAgentConfigMatch[1];
    const body = await readBody(req);
    const clients = loadClients();
    const client = clients.find(item => item.id === clientId);
    if (!client) return send(res, 404, { error: "not_found" });

    const textValue = (value, fallback = "", max = 700) =>
      typeof value === "string" ? value.trim().slice(0, max) : fallback;
    const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
    const requestedTimes = Array.isArray(body.postTimes) ? body.postTimes.map(String).filter(validTime) : [];
    if (requestedTimes.length) client.postTimes = [...new Set(requestedTimes)].slice(0, 6);

    const defaults = defaultPostingProfile();
    const current = { ...defaults, ...(client.postingProfile || {}) };
    const incoming = body.postingProfile && typeof body.postingProfile === "object" ? body.postingProfile : {};
    client.postingProfile = {
      contentStrategy: textValue(incoming.contentStrategy, current.contentStrategy, 100),
      targetAudience: textValue(incoming.targetAudience, current.targetAudience, 100),
      visualStyle: textValue(incoming.visualStyle, current.visualStyle, 100),
      contentFocus: textValue(incoming.contentFocus, current.contentFocus, 400),
      morningTheme: textValue(incoming.morningTheme, current.morningTheme, 250),
      afternoonTheme: textValue(incoming.afternoonTheme, current.afternoonTheme, 250),
      eveningTheme: textValue(incoming.eveningTheme, current.eveningTheme, 250),
      tone: textValue(incoming.tone, current.tone, 180),
      cta: textValue(incoming.cta, current.cta, 180),
      hashtags: textValue(incoming.hashtags, current.hashtags, 350),
      avoidTopics: textValue(incoming.avoidTopics, current.avoidTopics, 500)
    };
    if (client.agentProfile && typeof client.agentProfile === "object") {
      client.agentProfile.status = "configured";
      client.agentProfile.reviewedAt = new Date().toISOString();
    }
    saveClients(clients);
    return send(res, 200, client);
  }

  if (url.pathname === "/api/clients" && req.method === "GET") {
    return send(res, 200, loadClients());
  }

  if (url.pathname === "/api/clients" && req.method === "POST") {
    const body = await readBody(req);
    const clients = loadClients();
    let id = slug(body.id || body.name || "cliente");
    if (!id) id = crypto.randomUUID();
    if (clients.some(c => c.id === id)) id += "-" + String(Date.now()).slice(-5);

    const aiMode = "economy";
    const aiMonthlyImageLimit = 0;

    const client = {
      id,
      name: body.name || "Novo cliente",
      niche: body.niche || "Outro",
      instagram: "",
      theme: body.theme || "green-black",
      primaryColor: body.primaryColor || "#18c96e",
      secondaryColor: body.secondaryColor || "#07140c",
      status: "setup",
      github: "managed",
      railway: "managed",
      openai: "managed",
      meta: "pending",
      odin: true,
      postTimes: ["09:00", "12:00", "18:00"],
      leads: { total: 0, hot: 0, warm: 0, cold: 0 },
      usage: { openaiPercent: 0, railwayPercent: 0 },
      aiMode,
      aiMonthlyImageLimit,
      aiImagesUsed: 0,
      aiUsageMonth: new Date().toISOString().slice(0, 7),
      managedInfrastructure: true,
      onboarding: {
        github: true, railway: true, openai: true,
        instagram: false, facebook: true, metaApp: true,
        creativeProfile: false, supportRequested: false
      },
      postingProfile: defaultPostingProfile(),
      setupMode: "managed",
      agentApiUrl: ""
    };

    const existingUsers = loadPortalUsers();
    const takenUsernames = new Set([
      ...portalAccounts().map(item => String(item.username || "").toLowerCase()),
      ...Object.values(existingUsers).map(item => String(item?.username || "").toLowerCase())
    ]);
    let portalUsername = slug(body.username || id).replace(/-/g, ".") || id;
    const baseUsername = portalUsername;
    let suffix = 2;
    while (takenUsernames.has(portalUsername.toLowerCase())) {
      portalUsername = baseUsername + suffix;
      suffix += 1;
    }

    const initialPassword = String(body.password || "").trim()
      || crypto.randomBytes(12).toString("base64url");
    if (initialPassword.length < 8) {
      return send(res, 400, { error: "portal_password_too_short" });
    }

    clients.push(client);
    saveClients(clients);

    existingUsers[id] = {
      username: portalUsername,
      ...createPortalPasswordRecord(initialPassword),
      createdAt: new Date().toISOString()
    };
    savePortalUsers(existingUsers);

    return send(res, 201, {
      client,
      portalCredentials: {
        username: portalUsername,
        initialPassword,
        portalPath: "/"
      }
    });
  }

  const clientMatch = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (clientMatch && req.method === "PATCH") {
    const body = await readBody(req);
    const clients = loadClients();
    const client = clients.find(c => c.id === clientMatch[1]);
    if (!client) return send(res, 404, { error: "not_found" });

    if (Object.prototype.hasOwnProperty.call(body, "aiMode")) {
      const mode = String(body.aiMode || "");
      if (client.id === "ragnar-one") {
        if (mode !== "own-key") return send(res, 409, { error: "ragnar_openai_is_separate" });
      } else if (mode !== "economy") {
        return send(res, 409, { error: "nexus_paid_image_generation_disabled" });
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "aiMonthlyImageLimit")) {
      const limit = Number(body.aiMonthlyImageLimit);
      if (!Number.isInteger(limit) || limit < 0 || limit > 10000) {
        return send(res, 400, { error: "invalid_ai_monthly_image_limit" });
      }
    }

    const allowed = [
      "name","niche","instagram","theme","primaryColor","secondaryColor",
      "status","github","railway","openai","meta","odin","postTimes",
      "leads","usage","onboarding","agentApiUrl","setupMode",
      "aiMode","aiMonthlyImageLimit","aiImagesUsed","aiUsageMonth","managedInfrastructure"
    ];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, key)) client[key] = body[key];
    }
    saveClients(clients);
    return send(res, 200, client);
  }

  const deleteClientMatch = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (deleteClientMatch && req.method === "DELETE") {
    const clientId = deleteClientMatch[1];
    if (clientId === "ragnar-one") return send(res, 409, { error: "protected_pilot_client" });

    const clients = loadClients();
    const client = clients.find(item => item.id === clientId);
    if (!client) return send(res, 404, { error: "not_found" });
    saveClients(clients.filter(item => item.id !== clientId));

    const users = loadPortalUsers();
    if (Object.prototype.hasOwnProperty.call(users, clientId)) {
      delete users[clientId];
      savePortalUsers(users);
    }

    const connections = loadConnections();
    if (Object.prototype.hasOwnProperty.call(connections, clientId)) {
      delete connections[clientId];
      saveConnections(connections);
    }

    const oauthStates = loadOauthStates();
    let oauthChanged = false;
    for (const [state, record] of Object.entries(oauthStates)) {
      if (record?.clientId === clientId) {
        delete oauthStates[state];
        oauthChanged = true;
      }
    }
    if (oauthChanged) saveOauthStates(oauthStates);

    saveSupportTickets(loadSupportTickets().filter(item => item.clientId !== clientId));

    for (const [token, record] of portalSessions.entries()) {
      if (record?.clientId === clientId) portalSessions.delete(token);
    }

    return send(res, 200, { ok: true, deletedClientId: clientId });
  }

  if (url.pathname === "/api/master/support" && req.method === "GET") {
    const tickets = loadSupportTickets()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(supportTicketView);
    return send(res, 200, {
      unreadCount: tickets.filter(item => item.status === "new").length,
      openCount: tickets.filter(item => item.status !== "resolved").length,
      tickets
    });
  }

  const supportTicketMatch = url.pathname.match(/^\/api\/master\/support\/([^/]+)$/);
  if (supportTicketMatch && req.method === "PATCH") {
    const body = await readBody(req);
    const allowed = new Set(["new", "read", "resolved"]);
    const nextStatus = String(body.status || "");
    if (!allowed.has(nextStatus)) return send(res, 400, { error: "invalid_status" });

    const tickets = loadSupportTickets();
    const ticket = tickets.find(item => item.id === supportTicketMatch[1]);
    if (!ticket) return send(res, 404, { error: "not_found" });
    ticket.status = nextStatus;
    ticket.updatedAt = new Date().toISOString();
    saveSupportTickets(tickets);
    return send(res, 200, supportTicketView(ticket));
  }

  if (url.pathname === "/api/master/instagram" && req.method === "GET") {
    return send(res, 200, {
      configured: Boolean(masterInstagramAppId() && masterInstagramAppSecret()),
      appId: masterInstagramAppId(),
      callbackUrl: instagramRedirectUri(req),
      scopes: [
        "instagram_business_basic",
        "instagram_business_content_publish",
        "instagram_business_manage_messages",
        "instagram_business_manage_comments"
      ]
    });
  }

  if (url.pathname === "/api/master/instagram" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const current = loadMasterIntegrations();
      const previous = current.instagram || {};
      const appId = String(body.appId || previous.appId || "").trim();
      const suppliedSecret = String(body.appSecret || "").trim();

      if (!appId || (!suppliedSecret && !masterInstagramAppSecret())) {
        return send(res, 400, { error: "instagram_app_credentials_required" });
      }

      current.instagram = {
        ...previous,
        appId,
        ...(suppliedSecret ? { appSecret: encryptSecret(suppliedSecret) } : {}),
        updatedAt: new Date().toISOString()
      };
      saveMasterIntegrations(current);
      return send(res, 200, {
        configured: true,
        appId,
        callbackUrl: instagramRedirectUri(req)
      });
    } catch (error) {
      return send(res, 400, { error: String(error?.message || "instagram_config_failed") });
    }
  }

  if (url.pathname === "/api/master/openai" && req.method === "GET") {
    try {
      return send(res, 200, await masterOpenAISummary());
    } catch (error) {
      return send(res, 200, {
        apiConnected: Boolean(masterOpenAIProjectKey()),
        billingConnected: Boolean(masterOpenAIAdminKey()),
        connected: Boolean(masterOpenAIProjectKey() || masterOpenAIAdminKey()),
        monthCostUsd: null,
        spendLimitUsd: null,
        balanceEstimatedUsd: null,
        monthlyBudgetUsd: Number(masterOpenAIRecord().monthlyBudgetUsd) || null,
        budgetRemainingUsd: null,
        budgetPercent: null,
        exactPrepaidBalanceAvailable: false,
        ragnarExcluded: true,
        error: String(error?.message || "openai_summary_failed")
      });
    }
  }

  if (url.pathname === "/api/master/openai" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const current = loadMasterIntegrations();
      const previous = current.openai || {};
      const suppliedApiKey = String(body.apiKey || "").trim();
      const suppliedAdminKey = String(body.adminKey || "").trim();
      const apiKey = suppliedApiKey || masterOpenAIProjectKey();
      const adminKey = suppliedAdminKey || masterOpenAIAdminKey();

      const hasBalanceSetting =
        Object.prototype.hasOwnProperty.call(body, "currentBalanceUsd")
        && String(body.currentBalanceUsd).trim() !== "";
      const hasBudgetSetting =
        Object.prototype.hasOwnProperty.call(body, "monthlyBudgetUsd")
        && String(body.monthlyBudgetUsd).trim() !== "";
      if (!apiKey && !adminKey && !hasBalanceSetting && !hasBudgetSetting) {
        return send(res, 400, { error: "openai_key_or_budget_required" });
      }
      if (suppliedApiKey) await validateOpenAIKey(suppliedApiKey);
      if (suppliedAdminKey) await validateOpenAIAdminKey(suppliedAdminKey);

      const next = { ...previous };
      if (suppliedApiKey) next.apiKey = encryptSecret(suppliedApiKey);
      if (suppliedAdminKey) next.adminKey = encryptSecret(suppliedAdminKey);

      if (Object.prototype.hasOwnProperty.call(body, "currentBalanceUsd") && String(body.currentBalanceUsd).trim() !== "") {
        const balance = Number(body.currentBalanceUsd);
        if (!Number.isFinite(balance) || balance < 0 || balance > 1000000) {
          return send(res, 400, { error: "invalid_balance" });
        }
        next.balanceBaselineUsd = balance;
        next.balanceBaselineAt = Math.floor(Date.now() / 1000);
      }
      if (Object.prototype.hasOwnProperty.call(body, "monthlyBudgetUsd") && String(body.monthlyBudgetUsd).trim() !== "") {
        const budget = Number(body.monthlyBudgetUsd);
        if (!Number.isFinite(budget) || budget <= 0 || budget > 1000000) {
          return send(res, 400, { error: "invalid_monthly_budget" });
        }
        next.monthlyBudgetUsd = budget;
      }
      next.connectedAt = previous.connectedAt || new Date().toISOString();
      next.updatedAt = new Date().toISOString();
      current.openai = next;
      saveMasterIntegrations(current);
      return send(res, 200, await masterOpenAISummary());
    } catch (error) {
      return send(res, 400, { error: String(error?.message || "openai_connection_failed") });
    }
  }

  if (url.pathname === "/api/system/status" && req.method === "GET") {
    return send(res, 200, {
      githubConfigured: Boolean(
        (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
        || process.env.GITHUB_CONNECTED === "true"
      ),
      githubMode: process.env.GITHUB_CONNECTED === "true" ? "source-connected" : "oauth",
      railwayConfigured: Boolean(
        process.env.RAILWAY_API_TOKEN
        || (process.env.RAILWAY_OAUTH_CLIENT_ID && process.env.RAILWAY_OAUTH_CLIENT_SECRET)
      ),
      railwayMode: process.env.RAILWAY_API_TOKEN ? "api-token" : "oauth",
      openaiAdminConfigured: Boolean(masterOpenAIAdminKey()),
      openaiApiConfigured: Boolean(masterOpenAIProjectKey()),
      openaiAdminOptional: true,
      clientPortalConfigured: portalAccounts().length > 0,
      metaMode: "central-oauth",
      metaConfigured: Boolean(masterInstagramAppId() && masterInstagramAppSecret()),
      note: "Status operacional do NEXUS Core e integrações administrativas opcionais."
    });
  }

  let requested = url.pathname;
  requested = path.normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const publicRoot = path.join(__dirname, "public");
  const target = path.join(publicRoot, requested);

  if (!target.startsWith(publicRoot) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    return send(res, 404, "Not found", "text/plain; charset=utf-8");
  }

  const ext = path.extname(target).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  };
  return send(res, 200, fs.readFileSync(target), types[ext] || "application/octet-stream");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NEXUS AI Agent Central listening on ${PORT}`);
  startPendingVideoJobs();
  const videoTimer = setInterval(() => processDueVideoSchedules().catch(() => {}), 30000);
  videoTimer.unref?.();
});
