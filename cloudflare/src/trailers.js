import { openAIResponses } from "./openai.js";

function outputText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  const parts = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function youtubeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:") return "";
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] || "";
      return id ? "https://www.youtube.com/watch?v=" + encodeURIComponent(id) : "";
    }
    if (host !== "youtube.com") return "";
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v") || "";
      return id ? "https://www.youtube.com/watch?v=" + encodeURIComponent(id) : "";
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (["shorts","embed","live"].includes(parts[0]) && parts[1]) {
      return "https://www.youtube.com/watch?v=" + encodeURIComponent(parts[1]);
    }
  } catch {}
  return "";
}

function youtubeThumbnail(url) {
  try {
    const id = new URL(youtubeUrl(url)).searchParams.get("v") || "";
    return id ? "https://i.ytimg.com/vi/" + encodeURIComponent(id) + "/hqdefault.jpg" : "";
  } catch {
    return "";
  }
}

function normalizeResult(item, kind, fallbackTitle = "") {
  const trailerUrl = youtubeUrl(item?.trailerUrl);
  const trailerThumb = youtubeThumbnail(trailerUrl);
  const poster = String(item?.posterUrl || "").trim();
  return {
    id: String(item?.id || ""),
    type: kind === "tv" ? "series" : "movie",
    title: String(item?.title || item?.name || fallbackTitle || "").trim().slice(0, 160),
    year: String(item?.year || item?.release_date || item?.first_air_date || "").slice(0, 4),
    overview: String(item?.overview || item?.synopsis || "").trim().slice(0, 1800),
    posterUrl: poster || trailerThumb,
    posterFallbackUrl: trailerThumb,
    trailerUrl,
    trailerName: String(item?.trailerName || item?.channel || "").trim().slice(0, 180),
    official: item?.official === true,
    downloadable: false,
    downloadUrl: ""
  };
}



function decodeYoutubeText(value) {
  const raw=String(value||"");
  try { return JSON.parse('"' + raw.replace(/"/g,'\\\"') + '"'); } catch {}
  return raw.replace(/\\u0026/g,"&").replace(/\\n/g," ").replace(/\\t/g," ").replace(/\\\//g,"/");
}

async function youtubeHtmlSearch(query, kind) {
  const q=String(query||"").trim();
  if(!q)throw new Error("query_required");

  const url=new URL("https://www.youtube.com/results");
  url.searchParams.set("search_query",q);
  url.searchParams.set("hl","pt-BR");
  url.searchParams.set("gl","BR");

  const response=await fetch(url.toString(),{
    headers:{
      accept:"text/html,application/xhtml+xml",
      "accept-language":"pt-BR,pt;q=0.9,en;q=0.7",
      "user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36",
      cookie:"CONSENT=YES+cb.20210328-17-p0.en+FX+417"
    },
    signal:AbortSignal.timeout(5500)
  });
  if(!response.ok)throw new Error("youtube_search_http_"+response.status);

  const html=await response.text();
  const seen=new Set();
  const results=[];
  const idPattern=/"videoId":"([A-Za-z0-9_-]{11})"/g;
  let match;

  while((match=idPattern.exec(html))&&results.length<12){
    const videoId=match[1];
    if(seen.has(videoId))continue;
    seen.add(videoId);

    const from=Math.max(0,match.index-4500);
    const to=Math.min(html.length,match.index+6500);
    const chunk=html.slice(from,to);

    const titleMatch=
      chunk.match(/"title":\{"runs":\[\{"text":"((?:\\.|[^"])*)"/)
      || chunk.match(/"title":\{"simpleText":"((?:\\.|[^"])*)"/);
    const ownerMatch=
      chunk.match(/"ownerText":\{"runs":\[\{"text":"((?:\\.|[^"])*)"/)
      || chunk.match(/"longBylineText":\{"runs":\[\{"text":"((?:\\.|[^"])*)"/);
    const descriptionMatch=
      chunk.match(/"detailedMetadataSnippets":\[\{"snippetText":\{"runs":\[\{"text":"((?:\\.|[^"])*)"/)
      || chunk.match(/"descriptionSnippet":\{"runs":\[\{"text":"((?:\\.|[^"])*)"/);

    const title=decodeYoutubeText(titleMatch?.[1]||"").trim();
    if(!title)continue;

    results.push(normalizeResult({
      id:videoId,
      title,
      year:"",
      overview:decodeYoutubeText(descriptionMatch?.[1]||""),
      posterUrl:"https://i.ytimg.com/vi/"+encodeURIComponent(videoId)+"/hqdefault.jpg",
      trailerUrl:"https://www.youtube.com/watch?v="+encodeURIComponent(videoId),
      trailerName:decodeYoutubeText(ownerMatch?.[1]||""),
      official:false
    },kind,q));
  }

  const cleaned=results
    .filter(item=>item.trailerUrl&&item.title)
    .filter((item,index,all)=>all.findIndex(other=>other.id===item.id)===index)
    .slice(0,8);

  if(!cleaned.length)throw new Error("youtube_search_empty");
  return {configured:true,source:"youtube-direct",results:cleaned};
}

const PIPED_APIS = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.tokhmi.xyz",
  "https://pipedapi.moomoo.me",
  "https://pipedapi.syncpundit.io",
  "https://api-piped.mha.fi",
  "https://piped-api.garudalinux.org",
  "https://pipedapi.rivo.lol",
  "https://pipedapi.leptons.xyz"
];

async function pipedSearch(query, kind) {
  const q = (String(query || "").trim() + " trailer dublado").trim();

  const attempt = async base => {
    const url = new URL(base + "/search");
    url.searchParams.set("q", q);
    url.searchParams.set("filter", "videos");
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "NEXUS-AI/2.2" },
      signal: AbortSignal.timeout(4500)
    });
    if (!response.ok) throw new Error("piped_search_" + response.status);
    const payload = await response.json().catch(() => ({}));
    const items = Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.relatedStreams)
        ? payload.relatedStreams
        : Array.isArray(payload?.results) ? payload.results : [];

    const results = items
      .filter(item => String(item?.type || "stream") === "stream")
      .slice(0, 4)
      .map(item => {
        const rawUrl = String(item?.url || "");
        const videoId = rawUrl.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] || "";
        return normalizeResult({
          id: videoId,
          title: item?.title || query,
          year: "",
          overview: item?.shortDescription || "",
          posterUrl: String(item?.thumbnail || ""),
          trailerUrl: videoId ? "https://www.youtube.com/watch?v=" + videoId : "",
          trailerName: item?.uploaderName || "",
          official: Boolean(item?.uploaderVerified)
        }, kind, query);
      })
      .filter(item => item.trailerUrl && item.title);

    if (!results.length) throw new Error("piped_search_empty");
    return { configured: true, source: "piped-youtube", results: results.slice(0, 6) };
  };

  return Promise.any(PIPED_APIS.map(attempt));
}

async function tmdbSearch(env, query, kind) {
  const token = String(env.TMDB_API_TOKEN || "").trim();
  const apiKey = String(env.TMDB_API_KEY || "").trim();
  if (!token && !apiKey) return null;

  const get = async (pathname, params = {}, language = "pt-BR") => {
    const url = new URL("https://api.themoviedb.org/3/" + String(pathname).replace(/^\/+/, ""));
    url.searchParams.set("language", language);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    if (apiKey) url.searchParams.set("api_key", apiKey);
    const response = await fetch(url, {
      headers: { accept: "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      signal: AbortSignal.timeout(4500)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("tmdb_http_" + response.status);
    return payload;
  };

  const search = await get("search/" + kind, { query, include_adult: "false" });
  const base = (Array.isArray(search?.results) ? search.results : []).slice(0, 4);
  const score = video => {
    const name = String(video?.name || "").toLowerCase();
    const lang = String(video?.iso_639_1 || "").toLowerCase();
    const country = String(video?.iso_3166_1 || "").toUpperCase();
    let value = 0;
    if (/dublad|portugu[eê]s|pt[- ]?br|brasil/.test(name)) value += 120;
    if (lang === "pt") value += 100;
    if (country === "BR") value += 80;
    if (video?.type === "Trailer") value += 35;
    if (video?.official === true) value += 30;
    if (/legendad/.test(name)) value -= 45;
    if (lang === "en") value -= 80;
    return value;
  };

  const results = await Promise.all(base.slice(0, 6).map(async item => {
    let videos = [];
    try {
      const primary = await get(kind + "/" + item.id + "/videos");
      videos = Array.isArray(primary?.results) ? primary.results : [];
      if (!videos.length) {
        const english = await get(kind + "/" + item.id + "/videos", {}, "en-US");
        videos = Array.isArray(english?.results) ? english.results : [];
      }
    } catch {}

    const youtube = videos.filter(video => video?.site === "YouTube");
    const trailer = [...youtube].sort((a, b) => score(b) - score(a))[0] || null;
    const title = String(kind === "tv" ? item.name : item.title || query);
    const date = String(kind === "tv" ? item.first_air_date : item.release_date || "");

    return normalizeResult({
      id: item.id,
      title,
      year: date.slice(0, 4),
      overview: item.overview || "",
      posterUrl: item.poster_path ? "https://image.tmdb.org/t/p/w342" + item.poster_path : "",
      trailerUrl: trailer?.key ? "https://www.youtube.com/watch?v=" + encodeURIComponent(trailer.key) : "",
      trailerName: trailer?.name || "",
      official: Boolean(trailer?.official)
    }, kind, query);
  }));

  return { configured: true, source: "tmdb", results };
}

async function openAISearch(env, clientId, query, kind) {
  const response = await openAIResponses(env, clientId, {
    model: "gpt-5.6-luna",
    tools: [{ type: "web_search" }],
    instructions: [
      "Localize vídeos públicos do YouTube relacionados ao título pesquisado para público brasileiro.",
      "Priorize áudio em português do Brasil quando houver, mas não exija canal oficial.",
      "Nunca invente URL.",
      "Retorne somente JSON válido e não inclua markdown."
    ].join(" "),
    input: [
      "Pesquise no YouTube vídeos públicos relacionados a", kind === "tv" ? "a série" : "o filme", JSON.stringify(query) + ".",
      "Retorne até 6 resultados no formato",
      '{"results":[{"title":"...","year":"2026","overview":"...","trailerUrl":"https://www.youtube.com/watch?v=...","channel":"...","official":true}]}'
    ].join(" "),
    max_output_tokens: 1600
  });

  const text = outputText(response);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { configured: false, source: "openai", results: [] };

  let parsed = {};
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch {}
  const results = (Array.isArray(parsed?.results) ? parsed.results : [])
    .slice(0, 6)
    .map(item => normalizeResult(item, kind, query))
    .filter(item => item.title);
  return { configured: true, source: "openai-web-search", results };
}

export async function searchTrailers(env, clientId, query, type = "movie") {
  const q = String(query || "").trim().slice(0, 120);
  if (!q) throw new Error("query_required");
  const kind = String(type || "") === "series" ? "tv" : "movie";

  // 1) Catálogo estruturado, quando houver TMDB configurado.
  try {
    const tmdb = await tmdbSearch(env, q, kind);
    const rows = Array.isArray(tmdb?.results) ? tmdb.results : [];
    if (rows.length) {
      return {
        configured: true,
        source: "tmdb-catalog",
        results: rows
          .filter(item => item.type === (kind === "tv" ? "series" : "movie"))
          .slice(0, 4)
      };
    }
  } catch {}

  // 2) Sem catálogo externo, usa busca web da IA para identificar OBRAS,
  // não vídeos. Só depois associa trailer do YouTube à obra encontrada.
  try {
    const response = await openAIResponses(env, clientId, {
      model: "gpt-5.6-luna",
      tools: [{ type: "web_search" }],
      instructions: [
        "Você é um catálogo de filmes e séries.",
        "A busca do usuário deve retornar somente obras audiovisuais do tipo solicitado.",
        "NUNCA retorne clipes musicais, shows, entrevistas, reviews, cenas soltas, fan edits, vídeos de reação ou compilações.",
        "Para FILME, retorne somente longas, documentários ou telefilmes que sejam de fato filmes.",
        "Para SÉRIE, retorne somente séries ou minisséries.",
        "Para cada obra, confirme título, ano e forneça sinopse em português com 2 a 5 frases.",
        "Depois localize no YouTube um trailer oficial ou promocional confiável daquela obra.",
        "Nunca invente URL de YouTube.",
        "Se não houver trailer verificável, deixe trailerUrl vazio.",
        "Retorne somente JSON válido, sem markdown."
      ].join(" "),
      input: [
        "Tipo solicitado:", kind === "tv" ? "SÉRIE" : "FILME",
        "Consulta:", JSON.stringify(q),
        "Retorne no máximo 4 obras realmente correspondentes.",
        "Formato obrigatório:",
        '{"results":[{"title":"Título da obra","year":"2024","overview":"Sinopse completa em português.","posterUrl":"","trailerUrl":"https://www.youtube.com/watch?v=...","channel":"Canal","official":true}]}'
      ].join("\n"),
      max_output_tokens: 1200
    });

    const text = outputText(response);
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) {
      const parsed = JSON.parse(text.slice(a, b + 1));
      const results = (Array.isArray(parsed?.results) ? parsed.results : [])
        .slice(0, 4)
        .map(item => normalizeResult(item, kind, q))
        .filter(item => item.title && item.type === (kind === "tv" ? "series" : "movie"));

      return { configured: true, source: "catalog-web-search", results };
    }
  } catch (error) {
    const code = String(error instanceof Error ? error.message : error);
    if (!code.includes("openai_not_configured")) throw error;
  }

  // Nunca cair para uma busca crua do YouTube: isso mistura clipes e outros vídeos.
  return { configured: false, source: "catalog-unavailable", results: [] };
}
