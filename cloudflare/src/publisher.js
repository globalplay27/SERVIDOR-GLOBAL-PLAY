import { decryptSecret } from "./secrets.js";

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

async function metaConnection(env, clientId) {
  const row = await env.DB.prepare(
    `SELECT payload_json FROM connections
     WHERE client_id = ?1 AND provider = 'meta'
     LIMIT 1`
  ).bind(String(clientId)).first();
  if (!row) return null;
  return parseJson(row.payload_json, {});
}

async function graphRequest(accessToken, pathName, method = "GET", form = null) {
  const endpoint = "https://graph.instagram.com/" + String(pathName || "").replace(/^\/+/, "");
  const headers = {
    authorization: "Bearer " + accessToken,
    "user-agent": "NEXUS-AI-Cloudflare/1.0"
  };
  const options = { method, headers };

  if (form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(form);
  }

  const response = await fetch(endpoint, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const metaError = payload?.error || {};
    const error = new Error(String(metaError.message || "instagram_api_failed"));
    error.code = metaError.code || response.status;
    error.type = metaError.type || "";
    throw error;
  }
  return payload;
}

export async function publishInstagramImage(env, clientId, imageUrl, caption = "") {
  const connection = await metaConnection(env, clientId);
  const accessToken = connection?.accessToken
    ? await decryptSecret(env, connection.accessToken).catch(() => "")
    : "";
  const igUserId = String(connection?.igUserId || "").trim();

  if (!accessToken || !igUserId) {
    throw new Error("instagram_not_connected");
  }
  if (!/^https:\/\//i.test(String(imageUrl || ""))) {
    throw new Error("instagram_public_image_url_required");
  }

  const created = await graphRequest(accessToken, igUserId + "/media", "POST", {
    image_url: String(imageUrl),
    caption: String(caption || "")
  });
  const containerId = String(created?.id || "");
  if (!containerId) throw new Error("instagram_container_missing");

  const deadline = Date.now() + 85000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const status = await graphRequest(accessToken, containerId + "?fields=status_code,status");
    const code = String(status?.status_code || "").toUpperCase();
    lastStatus = String(status?.status || code || "");

    if (code === "FINISHED") {
      const published = await graphRequest(accessToken, igUserId + "/media_publish", "POST", {
        creation_id: containerId
      });
      const mediaId = String(published?.id || "");
      let permalink = "";
      if (mediaId) {
        try {
          const media = await graphRequest(accessToken, mediaId + "?fields=permalink");
          permalink = String(media?.permalink || "");
        } catch {}
      }
      return { mediaId, containerId, permalink };
    }

    if (code === "ERROR" || code === "EXPIRED") {
      const error = new Error("instagram_media_processing_failed");
      error.detail = lastStatus;
      throw error;
    }
  }

  const error = new Error("instagram_media_processing_timeout");
  error.detail = lastStatus;
  throw error;
}


export async function publishInstagramVideo(env, clientId, videoUrl, caption = "") {
  const connection = await metaConnection(env, clientId);
  const accessToken = connection?.accessToken
    ? await decryptSecret(env, connection.accessToken).catch(() => "")
    : "";
  const igUserId = String(connection?.igUserId || "").trim();

  if (!accessToken || !igUserId) throw new Error("instagram_not_connected");
  if (!/^https:\/\//i.test(String(videoUrl || ""))) throw new Error("instagram_public_video_url_required");

  const created = await graphRequest(accessToken, igUserId + "/media", "POST", {
    media_type: "REELS",
    video_url: String(videoUrl),
    caption: String(caption || ""),
    share_to_feed: "true"
  });
  const containerId = String(created?.id || "");
  if (!containerId) throw new Error("instagram_container_missing");

  const deadline = Date.now() + 120000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const status = await graphRequest(accessToken, containerId + "?fields=status_code,status");
    const code = String(status?.status_code || "").toUpperCase();
    lastStatus = String(status?.status || code || "");

    if (code === "FINISHED") {
      const published = await graphRequest(accessToken, igUserId + "/media_publish", "POST", {
        creation_id: containerId
      });
      const mediaId = String(published?.id || "");
      let permalink = "";
      if (mediaId) {
        try {
          const media = await graphRequest(accessToken, mediaId + "?fields=permalink");
          permalink = String(media?.permalink || "");
        } catch {}
      }
      return { mediaId, containerId, permalink };
    }

    if (code === "ERROR" || code === "EXPIRED") {
      const error = new Error("instagram_video_processing_failed");
      error.detail = lastStatus;
      throw error;
    }
  }

  const error = new Error("instagram_video_processing_timeout");
  error.detail = lastStatus;
  throw error;
}
