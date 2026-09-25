import { Container, getContainer } from "@cloudflare/containers";

function youtubeVideoId(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";
    if (host === "youtube.com") {
      if (url.pathname === "/watch") return url.searchParams.get("v") || "";
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts","embed","live"].includes(parts[0])) return parts[1] || "";
    }
  } catch {}
  return "";
}

export class YoutubeDownloader extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";
  enableInternet = true;
}

export async function downloadYoutubeWithContainer(env, sourceUrl) {
  if (!env?.YOUTUBE_DOWNLOADER) throw new Error("youtube_container_unavailable");
  const videoId = youtubeVideoId(sourceUrl);
  if (!videoId) throw new Error("invalid_trailer_url");

  const instance = getContainer(env.YOUTUBE_DOWNLOADER, "youtube-downloader");
  const response = await instance.fetch(new Request("http://container/download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: String(sourceUrl || "") })
  }));

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    const code = String(payload?.error || ("youtube_container_http_" + response.status));
    const detail = String(payload?.detail || "").replace(/\s+/g, " ").trim().slice(0, 700);
    throw new Error(detail ? code + ":" + detail : code);
  }

  const size = Number(response.headers.get("content-length") || 0);
  if (!size) throw new Error("youtube_container_size_missing");
  if (size > 100 * 1024 * 1024) throw new Error("video_too_large");

  const contentType = String(response.headers.get("content-type") || "video/mp4").toLowerCase().split(";")[0].trim();
  const extension = String(response.headers.get("x-nexus-extension") || "").toLowerCase() === "webm" ? "webm" : "mp4";

  return {
    response,
    videoId,
    host: "cloudflare-container",
    extension,
    contentType,
    size,
    resolver: "cloudflare-container"
  };
}
