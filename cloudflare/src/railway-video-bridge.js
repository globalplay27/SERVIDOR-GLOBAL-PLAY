function bridgeBase(env) {
  return String(env.RAILWAY_VIDEO_BRIDGE_URL || "").trim().replace(/\/+$/, "");
}

function bridgeSecret(env) {
  return String(env.NEXUS_RAILWAY_BRIDGE_SECRET || "").trim();
}

export function videoBridgeConfigured(env) {
  return Boolean(bridgeBase(env) && bridgeSecret(env));
}

function isBridgePath(pathname) {
  const path = String(pathname || "");
  return path === "/api/portal/videos"
    || path.startsWith("/api/portal/videos/")
    || path === "/api/portal/video-folders"
    || path.startsWith("/api/portal/video-folders/")
    || path.startsWith("/api/portal/trailers/");
}

function isDirectBinaryUpload(request, url) {
  if (url.pathname !== "/api/portal/videos" || request.method !== "POST") return false;
  const type = String(request.headers.get("content-type") || "").toLowerCase();
  return type.startsWith("video/") || type === "application/octet-stream";
}

function base64Url(bytes) {
  let raw = "";
  for (const value of bytes) raw += String.fromCharCode(value);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSha256(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

export async function createVideoUploadTicket(env, clientId) {
  const base = bridgeBase(env);
  const secret = bridgeSecret(env);
  if (!base || !secret) throw new Error("railway_video_bridge_not_configured");

  const expires = Math.floor(Date.now() / 1000) + 10 * 60;
  const payload = "video-upload|" + String(clientId) + "|" + String(expires);
  const sig = await hmacSha256(secret, payload);
  const target = new URL(base + "/api/portal/videos");
  target.searchParams.set("bridge_client", String(clientId));
  target.searchParams.set("bridge_exp", String(expires));
  target.searchParams.set("bridge_sig", sig);

  return {
    url: target.toString(),
    expiresAt: new Date(expires * 1000).toISOString()
  };
}

function requestHeaders(request, secret, clientId) {
  const headers = new Headers();
  const allowed = [
    "accept",
    "content-type",
    "range",
    "if-none-match",
    "if-modified-since",
    "x-file-name",
    "x-video-goal",
    "x-clip-duration",
    "x-requested-clips",
    "x-output-format",
    "x-auto-subtitles",
    "x-subtitle-size",
    "x-subtitle-color",
    "x-subtitle-weight",
    "x-subtitle-bg",
    "x-video-folder",
    "x-content-title",
    "x-video-end-text",
    "x-video-end-contact"
  ];
  for (const name of allowed) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("x-nexus-bridge-secret", secret);
  headers.set("x-nexus-client-id", String(clientId));
  headers.set("x-nexus-bridge-source", "cloudflare");
  return headers;
}

function responseHeaders(response) {
  const headers = new Headers();
  const allowed = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "content-disposition",
    "cache-control",
    "etag",
    "last-modified"
  ];
  for (const name of allowed) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("x-nexus-video-runtime", "railway-bridge");
  return headers;
}

export async function proxyRailwayVideoRequest(request, env, url, clientId) {
  if (!videoBridgeConfigured(env)) return null;
  if (!isBridgePath(url.pathname)) return null;
  if (isDirectBinaryUpload(request, url)) return null;

  const base = bridgeBase(env);
  const target = new URL(base + url.pathname);
  target.search = url.search;

  const init = {
    method: request.method,
    headers: requestHeaders(request, bridgeSecret(env), clientId),
    redirect: "manual"
  };

  if (!["GET","HEAD"].includes(request.method)) {
    init.body = request.body;
  }

  const response = await fetch(target.toString(), init);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response)
  });
}


export async function storeManualPostImage(env, clientId, imageDataUrl) {
  const base = bridgeBase(env);
  const secret = bridgeSecret(env);
  if (!base || !secret) throw new Error("railway_video_bridge_not_configured");

  const response = await fetch(base + "/api/nexus/bridge/manual-post", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nexus-bridge-secret": secret,
      "x-nexus-client-id": String(clientId),
      "x-nexus-bridge-source": "cloudflare"
    },
    body: JSON.stringify({ imageDataUrl: String(imageDataUrl || "") })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.imageUrl) {
    throw new Error(String(payload.error || "manual_post_store_failed"));
  }
  return { imageUrl: String(payload.imageUrl) };
}
