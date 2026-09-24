import { publishInstagramImage } from "./publisher.js";
import { storeManualPostImage } from "./railway-video-bridge.js";

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
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

  const payload = {
    ...parseJson(row.payload_json, {}),
    revisionRequest: text
  };
  const updated = await updateRow(env, row, {
    approvalStatus: "correction_requested",
    error: "",
    payload
  });

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

export async function saveOwnPostContent(env, client, postId, body = {}) {
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

  const stored = await storeManualPostImage(env, client.id, imageDataUrl);
  const payload = {
    ...parseJson(row.payload_json, {}),
    imageUrl: stored.imageUrl,
    source: "client_manual",
    revisionRequest: ""
  };
  const updated = await updateRow(env, row, {
    caption,
    approvalStatus: "approved",
    status: "ready",
    error: "",
    payload
  });
  return {
    ok: true,
    message: "Conteúdo manual aprovado e pronto para envio.",
    post: view(updated)
  };
}

export async function publishPostNow(env, client, postId) {
  const row = await postRow(env, client.id, postId);
  if (!row) throw new Error("post_not_found");
  const payload = parseJson(row.payload_json, {});
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
