const plain = value => String(value || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();
export function portugueseTrailerScore(item) {
  const clean = value => String(value || "").normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const title = clean(item.title), channel = clean(item.channel);
  if (/legendad|subtitled|english|ingles/.test(title)) return -1;
  const studio = /^(?:amazon )?(?:prime video|netflix|warner bros\.? pictures|warner play|universal pictures|paramount pictures|sony pictures|disney|disney studios|20th century studios|diamond films|paris filmes|imagem filmes|hbo|max|globoplay|lionsgate|mubi)(?: brasil| brazil| br)?$/.test(channel);
  const brazil = /brasil|brazil|\bbr\b|portugues/.test(channel);
  const dubbed = /dublad|portugues|pt[- ]?br/.test(title);
  if (!studio || !item.channelVerified || (!brazil && !dubbed) || !/trailer/.test(title)) return -1;
  return (dubbed ? 100 : 0) + (brazil ? 70 : 0) + (/oficial/.test(title) ? 30 : 0) + (item.channelVerified ? 20 : 0);
}
export function youtubeUrl(value) {
  try {
    const u = new URL(value); let id = "";
    if (u.protocol !== "https:") return "";
    if (u.hostname === "youtu.be") id = u.pathname.slice(1);
    else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(u.hostname)) {
      id = u.pathname === "/watch" ? u.searchParams.get("v") : u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)$/)?.[1];
    }
    return /^[a-zA-Z0-9_-]{11}$/.test(id || "") ? "https://www.youtube.com/watch?v=" + id : "";
  } catch { return ""; }
}
async function get(url) {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("catalog_unavailable");
  return r.json();
}
export async function searchCatalog(query, type = "movie") {
  if (type === "series") {
    const data = await get("https://api.tvmaze.com/search/shows?q=" + encodeURIComponent(query));
    return data.slice(0, 8).map(({ show: s }) => ({ id: "tvmaze:" + s.id, title: s.name, year: (s.premiered || "").slice(0, 4), overview: plain(s.summary), posterUrl: s.image?.original || "", mediaType: "SÉRIE" }));
  }
  const data = await get("https://itunes.apple.com/search?entity=movie&country=BR&limit=8&term=" + encodeURIComponent(query));
  return (data.results || []).map(s => ({ id: "itunes:" + s.trackId, title: s.trackName, year: (s.releaseDate || "").slice(0, 4), overview: plain(s.longDescription || s.shortDescription), posterUrl: (s.artworkUrl100 || "").replace("100x100bb", "600x900bb"), mediaType: "FILME" }));
}
export async function catalogMetadata(title, type, catalogId = "") {
  const matches = await searchCatalog(title, type);
  const match = catalogId ? matches.find(x => x.id === catalogId) : matches.find(x => x.title.toLowerCase() === title.toLowerCase());
  if (!match) throw new Error("catalog_title_not_found");
  const result = { ...match, cast: [], reviews: [], related: [], sources: [] };
  if (match.id.startsWith("tvmaze:")) {
    const id = match.id.split(":")[1];
    const [show, cast] = await Promise.all([get("https://api.tvmaze.com/shows/" + id), get("https://api.tvmaze.com/shows/" + id + "/cast")]);
    result.cast = cast.slice(0, 9).map(x => ({ name: x.person.name, image: x.person.image?.original || x.person.image?.medium || "" }));
    result.genres = (show.genres || []).join(" • ");
    result.runtime = show.averageRuntime ? show.averageRuntime + " min / episódio" : "";
    result.rating = show.rating?.average ? "TVmaze " + show.rating.average + "/10" : "";
    if (result.rating) result.reviews = [{ author: "Avaliação do público", source: "TVmaze", text: result.rating, summary: false }];
    result.sources.push(show.url);
    const candidates = await get("https://api.tvmaze.com/shows?page=0");
    result.related = candidates.filter(x => x.id !== show.id && x.image && x.genres?.some(g => show.genres?.includes(g)))
      .map(x => ({ ...x, score: x.genres.filter(g => show.genres.includes(g)).length }))
      .sort((a, b) => b.score - a.score || (b.rating?.average || 0) - (a.rating?.average || 0)).slice(0, 3)
      .map(x => ({ title: x.name, year: (x.premiered || "").slice(0, 4), image: x.image.original }));
  } else {
    result.sources.push("https://itunes.apple.com/lookup?id=" + match.id.split(":")[1]);
    result.related = matches.filter(x => x.id !== match.id).slice(0, 3).map(x => ({ title: x.title, year: x.year, image: x.posterUrl }));
  }
  return result;
}
export async function dispatchVideoSearch(env, clientId, query, type) {
  const token = String(env.GITHUB_ACTIONS_TOKEN || env.GITHUB_TOKEN || "").trim();
  if (!token) throw new Error("github_actions_token_missing");
  const id = "search_" + crypto.randomUUID().replace(/-/g, "");
  const callbackToken = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare("INSERT INTO video_jobs(id,client_id,source_object_key,status,settings_json,result_json,created_at,updated_at) VALUES(?1,?2,'','searching',?3,'{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
    .bind(id, clientId, JSON.stringify({ contentTitle: query, githubRenderToken: callbackToken, searchOnly: true })).run();
  const r = await fetch("https://api.github.com/repos/" + (env.GITHUB_INGEST_REPOSITORY || "globalplay27/SERVIDOR-GLOBAL-PLAY") + "/dispatches", {
    method: "POST", headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "NEXUS" },
    body: JSON.stringify({ event_type: "video-youtube-search", client_payload: { job_id: id, client_id: clientId, callback_token: callbackToken, query: query.slice(0, 120) + " trailer oficial dublado português Brasil" } })
  });
  if (r.status !== 204) throw new Error("youtube_search_dispatch_failed");
  return id;
}
