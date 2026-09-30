import { visualApproval } from "./visual-review.js";
import { publishInstagramImage } from "./publisher.js";

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function decodeBase64Image(encoded) {
  const binary = atob(String(encoded || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function postImageKeyBelongsToClient(key, clientId) {
  const value = String(key || "");
  return value.startsWith("posts/" + String(clientId) + "/")
    && !value.includes("..")
    && !value.includes("\\");
}

async function postRow(env, clientId, postId) {
  return env.DB.prepare(
    `SELECT id, client_id, scheduled_for, scheduled_hour, status, approval_status,
            media_id, caption, image_object_key, error, cost_usd, payload_json,
            created_at, updated_at
     FROM post_ledger WHERE id = ?1 AND client_id = ?2 LIMIT 1`
  ).bind(String(postId), String(clientId)).first();
}

function view(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    scheduledFor: row.scheduled_for || null,
    scheduledHour: row.scheduled_hour || "",
    status: row.status || "scheduled",
    approvalStatus: row.approval_status || "pending",
    mediaId: row.media_id || "",
    caption: row.caption || "",
    imageObjectKey: row.image_object_key || "",
    error: row.error || "",
    costUsd: Number(row.cost_usd || 0),
    ...parseJson(row.payload_json, {}),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

async function updateRow(env, row, patch = {}) {
  const payload = {
    ...parseJson(row.payload_json, {}),
    ...(patch.payload && typeof patch.payload === "object" ? patch.payload : {})
  };
  await env.DB.prepare(
    `UPDATE post_ledger
     SET status = ?3,
         approval_status = ?4,
         media_id = ?5,
         caption = ?6,
         image_object_key = ?7,
         error = ?8,
         payload_json = ?9,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1 AND client_id = ?2`
  ).bind(
    row.id,
    row.client_id,
    String(patch.status ?? row.status ?? "scheduled"),
    String(patch.approvalStatus ?? row.approval_status ?? "pending"),
    String(patch.mediaId ?? row.media_id ?? ""),
    String(patch.caption ?? row.caption ?? "").slice(0, 2200),
    String(patch.imageObjectKey ?? row.image_object_key ?? ""),
    String(patch.error ?? row.error ?? "").slice(0, 900),
    JSON.stringify(payload)
  ).run();
  return postRow(env, row.client_id, row.id);
}

export async function decidePost(env, client, postId, decision) {
  const clean = String(decision || "").toLowerCase();
  if (!["approved","rejected"].includes(clean)) throw new Error("invalid_decision");
  const row = await postRow(env, client.id, postId);
  if (!row) throw new Error("not_found");
  const payload = parseJson(row.payload_json, {});
  const nextStatus = clean === "approved" && row.status === "failed" ? "ready" : row.status;
  const updated = await updateRow(env, row, {
    approvalStatus: clean,
    status: nextStatus,
    error: clean === "approved" && row.status === "failed" ? "" : row.error
  });
  return {
    ok: true,
    post: view(updated),
    message: clean === "approved"
      ? (payload.imageUrl ? "Conteúdo aprovado e liberado para o Publisher." : "Pauta aprovada; aguardando mídia antes da publicação.")
      : "Pauta reprovada e bloqueada para publicação."
  };
}

export async function requestPostRevision(env, client, postId, instructions) {
  const text = String(instructions || "").trim().slice(0, 1600);
  if (!text) throw new Error("revision_instructions_required");
  const row = await postRow(env, client.id, postId);
  if (!row) throw new Error("post_not_found");

  const currentPayload = parseJson(row.payload_json, {});
  const previousImageUrl = String(currentPayload.imageUrl || currentPayload.publicImageUrl || "");
  const payload = {
    ...currentPayload,
    revisionRequest: text,
    revisionRequestedAt: new Date().toISOString(),
    blockedRevisionMedia: previousImageUrl,
    imageUrl: "",
    publicImageUrl: "",
    visualReview: null,
    qualityGates: { copyChief: "pending", designer: "pending" },
    mediaGeneration: {
      status: "requested",
      attempts: 0,
      lastError: "",
      updatedAt: new Date().toISOString()
    }
  };
  const updated = await updateRow(env, row, {
    approvalStatus: "correction_requested",
    status: "ready",
    error: "media_generation_required",
    payload
  });

  const jobId = "client-revision:" + String(client.id) + ":" + String(row.id) + ":" + Date.now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO scheduled_jobs(
       id, client_id, kind, due_at, status, attempts, payload_json, created_at, updated_at
     ) VALUES(?1, ?2, 'agent-core-cycle', ?3, 'scheduled', 0, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(
    jobId,
    client.id,
    new Date().toISOString(),
    JSON.stringify({ trigger: "client-revision", agent: "all", postId: row.id })
  ).run();

  const ticketId = "sup_" + crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO support_tickets(id, client_id, status, subject, payload_json, created_at, updated_at)
     VALUES(?1, ?2, 'open', ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(
    ticketId,
    client.id,
    "Correção solicitada · " + (row.scheduled_hour || "postagem"),
    JSON.stringify({
      category: "Postagens / correção",
      message: text,
      postId: row.id
    })
  ).run();

  return {
    ok: true,
    message: "Correção enviada ao NEXUS.",
    post: view(updated)
  };
}

export async function cancelPost(env, client, postId) {
  const row = await postRow(env, client.id, postId);
  if (!row) throw new Error("post_not_found");
  if (row.status === "published") throw new Error("already_published");
  if (row.status === "publishing") throw new Error("publishing_in_progress");

  const payload = {
    ...parseJson(row.payload_json, {}),
    cancelledAt: new Date().toISOString(),
    cancelledBy: "client"
  };
  const updated = await updateRow(env, row, {
    status: "cancelled",
    approvalStatus: "rejected",
    error: "",
    payload
  });

  return {
    ok: true,
    message: "Postagem cancelada. Ela não será enviada ao Instagram.",
    post: view(updated)
  };
}

export async function saveOwnPostContent(env, client, postId, body = {}, publicOrigin = "") {
  const caption = String(body.caption || "").trim().slice(0, 2200);
  const imageDataUrl = String(body.imageDataUrl || "").trim();
  if (!caption) throw new Error("caption_required");
  if (!imageDataUrl) throw new Error("image_required");

  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl);
  if (!match) throw new Error("invalid_image");
  const estimatedBytes = Math.floor(match[2].length * 0.75);
  if (!estimatedBytes || estimatedBytes > 10 * 1024 * 1024) throw new Error("image_too_large");

  const row = await postRow(env, client.id, postId);
  if (!row) throw new Error("post_not_found");

  if (!env.MEDIA) throw new Error("r2_unavailable");
  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  const contentType = match[1] === "jpeg" ? "image/jpeg" : "image/" + match[1];
  const bytes = decodeBase64Image(match[2]);
  if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) throw new Error("image_too_large");

  const objectKey = "posts/" + String(client.id) + "/" + String(postId) + "/" + crypto.randomUUID() + "." + extension;
  await env.MEDIA.put(objectKey, bytes, {
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable"
    },
    customMetadata: {
      clientId: String(client.id),
      postId: String(postId),
      kind: "manual-post-image"
    }
  });

  const origin = String(publicOrigin || "").replace(/\/+$/, "");
  if (!origin) {
    await env.MEDIA.delete(objectKey).catch(() => {});
    throw new Error("public_origin_required");
  }

  const previousObjectKey = String(row.image_object_key || "");
  const payload = {
    ...parseJson(row.payload_json, {}),
    imageUrl: origin + "/media/" + objectKey,
    source: "client_manual",
    revisionRequest: ""
  };

  let updated;
  try {
    updated = await updateRow(env, row, {
      caption,
      approvalStatus: "approved",
      status: "ready",
      error: "",
      imageObjectKey: objectKey,
      payload
    });
  } catch (error) {
    await env.MEDIA.delete(objectKey).catch(() => {});
    throw error;
  }

  if (
    previousObjectKey
    && previousObjectKey !== objectKey
    && postImageKeyBelongsToClient(previousObjectKey, client.id)
  ) {
    await env.MEDIA.delete(previousObjectKey).catch(() => {});
  }
  return {
    ok: true,
    message: "Conteúdo manual aprovado e pronto para envio.",
    post: view(updated)
  };
}


export async function useLibraryImageForPost(env, client, postId, libraryKey, publicOrigin = "") {
  if (!env.MEDIA) throw new Error("r2_unavailable");
  const row = await postRow(env, client.id, postId);
  if (!row) throw new Error("post_not_found");
  if (row.status === "published") throw new Error("already_published");

  const key = String(libraryKey || "");
  const prefix = "library/" + String(client.id) + "/";
  if (!key.startsWith(prefix) || key.includes("..") || key.includes("\\")) {
    throw new Error("library_media_not_found");
  }

  const object = await env.MEDIA.get(key);
  if (!object) throw new Error("library_media_not_found");
  const contentType = String(object.httpMetadata?.contentType || object.customMetadata?.contentType || "").toLowerCase();
  if (!["image/png","image/jpeg","image/webp"].includes(contentType)) {
    throw new Error("library_media_image_required");
  }
  const size = Number(object.size || 0);
  if (!size || size > 10 * 1024 * 1024) throw new Error("image_too_large");

  const origin = String(publicOrigin || "").replace(/\/+$/, "");
  if (!origin) throw new Error("public_origin_required");

  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const objectKey = "posts/" + String(client.id) + "/" + String(postId) + "/client-library-" + crypto.randomUUID() + "." + extension;
  await env.MEDIA.put(objectKey, object.body, {
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable"
    },
    customMetadata: {
      clientId: String(client.id),
      postId: String(postId),
      kind: "client-library-post-image",
      sourceLibraryKey: key
    }
  });

  const previousObjectKey = String(row.image_object_key || "");
  const payload = {
    ...parseJson(row.payload_json, {}),
    imageUrl: origin + "/media/" + objectKey,
    publicImageUrl: "",
    source: "client_library",
    sourceLibraryKey: key,
    revisionRequest: "",
    visualReview: null,
    qualityGates: {
      copyChief: "pending",
      designer: "pending"
    },
    mediaGeneration: {
      status: "client-owned",
      attempts: 0,
      lastError: "",
      updatedAt: new Date().toISOString()
    }
  };

  let updated;
  try {
    updated = await updateRow(env, row, {
      approvalStatus: "approved",
      status: "ready",
      error: "",
      imageObjectKey: objectKey,
      payload
    });
  } catch (error) {
    await env.MEDIA.delete(objectKey).catch(() => {});
    throw error;
  }

  if (
    previousObjectKey &&
    previousObjectKey !== objectKey &&
    postImageKeyBelongsToClient(previousObjectKey, client.id)
  ) {
    await env.MEDIA.delete(previousObjectKey).catch(() => {});
  }

  return {
    ok: true,
    message: "Mídia aplicada. Copy Chief e Designer vão revisar antes da publicação.",
    post: view(updated)
  };
}

export async function publishPostNow(env, client, postId) {
  const row = await postRow(env, client.id, postId);
  if (!row) throw new Error("post_not_found");
  const payload = parseJson(row.payload_json, {});
  const quality = payload.qualityGates && typeof payload.qualityGates === "object"
    ? payload.qualityGates : {};
  const retryCount = Math.max(0, Number(payload.retryCount || 0));
  const current = view(row);

  if (row.status === "published") {
    const error = new Error("already_published");
    error.status = 409;
    error.messageForUser = "Esta postagem já foi enviada.";
    error.post = current;
    throw error;
  }
  if (String(row.approval_status || "pending") !== "approved") {
    const error = new Error("post_not_approved");
    error.status = 409;
    error.messageForUser = "O servidor bloqueou o envio porque esta postagem ainda não foi aprovada. Envie para correção ou use seu próprio conteúdo.";
    error.post = current;
    throw error;
  }
  if (quality.copyChief !== "approved" || quality.designer !== "approved" || !visualApproval(client.id, payload)) {
    const error = new Error("quality_gate_pending");
    error.status = 409;
    error.messageForUser = "O NEXUS bloqueou o envio porque Copy Chief e Designer ainda não aprovaram o conteúdo.";
    error.post = current;
    throw error;
  }
  if (retryCount >= 3) {
    const error = new Error("publish_retry_limit_reached");
    error.status = 409;
    error.messageForUser = "O envio atingiu o limite de três tentativas e precisa de correção antes de tentar novamente.";
    error.post = current;
    throw error;
  }

  const imageUrl = String(payload.imageUrl || payload.publicImageUrl || "");
  if (!imageUrl || !row.caption) {
    const error = new Error("post_content_not_ready");
    error.status = 409;
    error.messageForUser = "A postagem está aprovada, mas o arquivo final ainda não está disponível no NEXUS.";
    error.post = current;
    throw error;
  }

  await updateRow(env, row, {
    status: "publishing",
    error: "",
    payload: { ...payload, attemptedAt: new Date().toISOString() }
  });

  try {
    const result = await publishInstagramImage(env, client.id, imageUrl, row.caption);
    const updated = await updateRow(env, row, {
      status: "published",
      approvalStatus: "approved",
      mediaId: result.mediaId || "",
      error: "",
      payload: {
        ...payload,
        permalink: result.permalink || "",
        containerId: result.containerId || "",
        publishedAt: new Date().toISOString()
      }
    });
    return {
      ok: true,
      message: "Postagem enviada manualmente com sucesso.",
      post: view(updated),
      permalink: result.permalink || ""
    };
  } catch (cause) {
    const updated = await updateRow(env, row, {
      status: "failed",
      error: cause instanceof Error ? cause.message : String(cause),
      payload: {
        ...payload,
        retryCount: retryCount + 1,
        lastPublishAttemptAt: new Date().toISOString()
      }
    });
    const error = new Error("manual_publish_failed");
    error.status = 400;
    error.messageForUser = String(cause?.message || "Falha ao publicar").slice(0, 900);
    error.post = view(updated);
    throw error;
  }
}
