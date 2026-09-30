import { openAIKeyForClient } from "./openai-routing.js";
import { buildVisualPrompt } from "./media-generation.js";
import { publishInstagramImage } from "./publisher.js";

const CLIENTS = [
  { id: "globalplay-streaming", name: "Global Play", niche: "streaming" },
  { id: "ragnar-one", name: "Ragnar One", niche: "streaming" }
];

function localParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(now);
  return Object.fromEntries(parts.map(p => [p.type, p.value]));
}

function dayKey(now) {
  const p = localParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

function localHour(now) {
  return Number(localParts(now).hour || 0);
}

function stateKey(clientId, day) {
  return `emergency-state/${clientId}/${day}.json`;
}

async function loadState(env, clientId, day) {
  if (!env.MEDIA) return { count: 0, lastPublishedAt: null };
  const obj = await env.MEDIA.get(stateKey(clientId, day));
  if (!obj) return { count: 0, lastPublishedAt: null };
  try {
    return JSON.parse(await obj.text());
  } catch {
    return { count: 0, lastPublishedAt: null };
  }
}

async function saveState(env, clientId, day, value) {
  if (!env.MEDIA) return;
  await env.MEDIA.put(stateKey(clientId, day), JSON.stringify(value), {
    httpMetadata: { contentType: "application/json" }
  });
}

function decodeBase64(value) {
  const raw = atob(String(value || ""));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function emergencyImage(env, client, now) {
  const key = openAIKeyForClient(env, client.id);
  if (!key) throw new Error("emergency_openai_not_configured");

  const seed = `emergency-${client.id}-${now.toISOString()}-${crypto.randomUUID()}`;
  const prompt = buildVisualPrompt(
    client,
    "Create a fresh, high-impact customer-facing streaming advertisement. One coherent scene, contemporary home entertainment, emotionally positive, no prices, no reseller language.",
    seed
  );

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "Servidor-Nexus-Emergency/1.0"
    },
    body: JSON.stringify({
      model: env.NEXUS_MEDIA_PLANNER_MODEL || "gpt-5.6-luna",
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
      tools: [{
        type: "image_generation",
        model: env.NEXUS_IMAGE_MODEL || "gpt-image-2",
        quality: String(env.NEXUS_IMAGE_QUALITY || "medium"),
        size: "1024x1536",
        output_format: "jpeg"
      }],
      tool_choice: "required"
    }),
    signal: AbortSignal.timeout(45000)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`emergency_openai_http_${response.status}`);
  const item = (data?.output || []).find(x => x?.type === "image_generation_call" && x?.result);
  if (!item?.result) throw new Error("emergency_image_missing_result");

  const bytes = decodeBase64(item.result);
  if (!bytes.byteLength || bytes.byteLength > 12 * 1024 * 1024) {
    throw new Error("emergency_image_invalid_bytes");
  }

  const objectKey = `posts/${client.id}/emergency/${dayKey(now)}/${crypto.randomUUID()}.jpg`;
  await env.MEDIA.put(objectKey, bytes, {
    httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { clientId: client.id, kind: "d1-emergency-original-media" }
  });

  const base = String(env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return `${base}/media/${objectKey}`;
}

function emergencyCaption(client, now) {
  const stamp = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(now);
  if (client.id === "globalplay-streaming") {
    return `Seu entretenimento merece praticidade. 🎬\n\nConteúdo para curtir em casa, do seu jeito. Digite QUERO e fale com a Global Play.\n\n#GlobalPlay #Streaming #Entretenimento #Filmes #Series #DicaDeHoje\n\nAtualizado em ${stamp}`;
  }
  return `Mais praticidade para aproveitar seu entretenimento. 📺\n\nQuer saber como funciona? Digite QUERO e fale com a Ragnar One.\n\n#RagnarOne #Streaming #Entretenimento #Filmes #Series #Diversao\n\nAtualizado em ${stamp}`;
}

export function isD1Emergency(error) {
  return /d1|daily row read limit|database|sqlite/i.test(String(error?.message || error || ""));
}

export async function runEmergencyPublisher(env, now = new Date()) {
  if (!env.MEDIA) return { attempted: 0, published: 0, errors: ["r2_unavailable"] };
  const hour = localHour(now);
  if (hour < 9 || hour >= 23) return { attempted: 0, published: 0, errors: [] };

  const day = dayKey(now);
  const summary = { attempted: 0, published: 0, errors: [] };

  for (const client of CLIENTS) {
    const state = await loadState(env, client.id, day);
    const count = Math.max(0, Number(state?.count || 0));
    const lastMs = Date.parse(String(state?.lastPublishedAt || ""));
    const spaced = !Number.isFinite(lastMs) || now.getTime() - lastMs >= 90 * 60 * 1000;
    if (count >= 3 || !spaced) continue;

    summary.attempted += 1;
    try {
      const imageUrl = await emergencyImage(env, client, now);
      const result = await publishInstagramImage(env, client.id, imageUrl, emergencyCaption(client, now));
      await saveState(env, client.id, day, {
        count: count + 1,
        lastPublishedAt: now.toISOString(),
        mediaId: String(result?.mediaId || ""),
        mode: "d1-emergency"
      });
      summary.published += 1;
    } catch (error) {
      summary.errors.push(`${client.id}:${String(error?.message || error).slice(0,120)}`);
    }
  }
  return summary;
}


export async function emergencyPublisherStatus(env, now = new Date()) {
  const day = dayKey(now);
  const clients = [];
  for (const client of CLIENTS) {
    const state = await loadState(env, client.id, day);
    clients.push({
      clientId: client.id,
      day,
      count: Math.max(0, Number(state?.count || 0)),
      lastPublishedAt: state?.lastPublishedAt || null,
      mediaIdPresent: Boolean(state?.mediaId),
      mode: String(state?.mode || "")
    });
  }
  return { ok: true, storage: "r2", clients };
}
