import { openAIResponses } from "./openai.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function textResponse(text, status = 200) {
  return new Response(String(text ?? ""), {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function cleanPhone(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 20);
}

function nowIso() {
  return new Date().toISOString();
}

function safeJson(value, fallback = {}) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function configStatus(env) {
  const required = {
    verifyToken: Boolean(String(env.WHATSAPP_VERIFY_TOKEN || "")),
    accessToken: Boolean(String(env.WHATSAPP_ACCESS_TOKEN || "")),
    phoneNumberId: Boolean(String(env.WHATSAPP_PHONE_NUMBER_ID || "")),
    appSecret: Boolean(String(env.WHATSAPP_APP_SECRET || "")),
    graphVersion: Boolean(String(env.WHATSAPP_GRAPH_VERSION || "")),
    clientId: Boolean(String(env.WHATSAPP_CLIENT_ID || ""))
  };
  return {
    configured: Object.values(required).every(Boolean),
    required,
    clientId: String(env.WHATSAPP_CLIENT_ID || ""),
    sendLimitPerHour: Math.max(1, Math.min(100, Number(env.WHATSAPP_SEND_LIMIT_PER_HOUR || 30)))
  };
}

export async function ensureWhatsAppSchema(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS whatsapp_contacts (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      wa_id TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      classification TEXT NOT NULL DEFAULT 'cliente',
      priority INTEGER NOT NULL DEFAULT 0,
      needs_human INTEGER NOT NULL DEFAULT 0,
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(client_id, wa_id)
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      wa_id TEXT NOT NULL,
      provider_message_id TEXT,
      direction TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text',
      text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'received',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider_message_id)
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS whatsapp_drafts (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      wa_id TEXT NOT NULL,
      classification TEXT NOT NULL DEFAULT 'cliente',
      priority INTEGER NOT NULL DEFAULT 0,
      needs_human INTEGER NOT NULL DEFAULT 0,
      reply_text TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS whatsapp_send_log (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      wa_id TEXT NOT NULL,
      message_id TEXT,
      text_preview TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_wa_contacts_updated ON whatsapp_contacts(client_id, updated_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_wa_messages_phone ON whatsapp_messages(client_id, wa_id, created_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_wa_drafts_status ON whatsapp_drafts(client_id, status, created_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_wa_send_log_created ON whatsapp_send_log(client_id, created_at DESC)").run();
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function equalHex(a, b) {
  const left = String(a || "").toLowerCase();
  const right = String(b || "").toLowerCase();
  if (!left || left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

async function validWebhookSignature(rawBody, signature, appSecret) {
  const provided = String(signature || "").replace(/^sha256=/i, "");
  if (!provided || !appSecret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(appSecret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return equalHex(bytesToHex(signed), provided);
}

function messageText(message) {
  if (message?.type === "text") return String(message?.text?.body || "");
  if (message?.type === "button") return String(message?.button?.text || "");
  if (message?.type === "interactive") {
    return String(
      message?.interactive?.button_reply?.title ||
      message?.interactive?.list_reply?.title ||
      ""
    );
  }
  return "";
}

function localTriage(text) {
  const value = String(text || "").toLowerCase();
  const urgent = /urgente|agora|parou|fora do ar|não funciona|nao funciona|problema|erro/.test(value);
  const lead = /preço|preco|valor|plano|assinar|revenda|quero|como funciona|teste/.test(value);
  return {
    classification: urgent ? "urgente" : lead ? "lead" : "cliente",
    priority: urgent ? 90 : lead ? 70 : 45,
    needsHuman: urgent,
    reply: lead
      ? "Oi! Claro. Posso te ajudar. Você procura uma opção para uso próprio ou para revenda?"
      : "Oi! Recebi sua mensagem. Pode me contar em uma frase o que você precisa?",
    reason: urgent ? "palavra-chave de urgência detectada" : lead ? "sinal de intenção comercial" : "triagem inicial"
  };
}

function responseText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (typeof part?.text === "string") return part.text;
    }
  }
  return "";
}

function parseDraft(text, fallback) {
  const raw = String(text || "").trim().replace(/^\`\`\`json\s*/i, "").replace(/\`\`\`$/i, "");
  const parsed = safeJson(raw, null);
  if (!parsed || typeof parsed !== "object") return fallback;
  const allowed = new Set(["urgente", "lead", "cliente", "fornecedor", "pessoal", "ruido"]);
  return {
    classification: allowed.has(String(parsed.classification)) ? String(parsed.classification) : fallback.classification,
    priority: Math.max(0, Math.min(100, Number(parsed.priority ?? fallback.priority))),
    needsHuman: parsed.needsHuman === true,
    reply: String(parsed.reply || fallback.reply).slice(0, 1000),
    reason: String(parsed.reason || fallback.reason).slice(0, 300)
  };
}

async function buildDraft(env, clientId, waId, displayName, inboundText) {
  const fallback = localTriage(inboundText);
  const historyResult = await env.DB.prepare(
    `SELECT direction,text,created_at FROM whatsapp_messages
     WHERE client_id=?1 AND wa_id=?2 ORDER BY created_at DESC LIMIT 20`
  ).bind(clientId, waId).all();

  const history = [...(historyResult?.results || [])].reverse()
    .map(row => `${row.direction === "outbound" ? "EMPRESA" : "CLIENTE"}: ${String(row.text || "").slice(0, 500)}`)
    .join("\n");

  try {
    const data = await openAIResponses(env, clientId, {
      input: [
        "Você faz triagem de WhatsApp empresarial em português do Brasil.",
        "Classifique em exatamente uma categoria: urgente, lead, cliente, fornecedor, pessoal ou ruido.",
        "Escreva um rascunho curto, natural, no máximo 5 linhas e no máximo uma pergunta.",
        "Nunca invente preço, prazo, condição comercial ou informação que não esteja no histórico.",
        "Nunca envie nada: apenas produza rascunho.",
        'Responda SOMENTE JSON válido no formato {"classification":"lead","priority":70,"needsHuman":false,"reply":"...","reason":"..."}.',
        `Contato: ${displayName || waId}`,
        "Histórico:",
        history || "(sem histórico anterior)",
        "Nova mensagem:",
        inboundText
      ].join("\n"),
      max_output_tokens: 320
    });
    return parseDraft(responseText(data), fallback);
  } catch {
    return fallback;
  }
}

async function storeInbound(env, clientId, value) {
  const contacts = new Map(
    (Array.isArray(value?.contacts) ? value.contacts : [])
      .map(contact => [String(contact?.wa_id || ""), String(contact?.profile?.name || "")])
  );

  const messages = Array.isArray(value?.messages) ? value.messages : [];
  for (const message of messages) {
    const waId = cleanPhone(message?.from);
    if (!waId) continue;
    const providerId = String(message?.id || "");
    const text = messageText(message);
    const createdAt = Number(message?.timestamp)
      ? new Date(Number(message.timestamp) * 1000).toISOString()
      : nowIso();
    const displayName = contacts.get(waId) || "";

    const rowId = providerId || `wa-in-${clientId}-${waId}-${Date.now()}`;
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO whatsapp_messages(
        id,client_id,wa_id,provider_message_id,direction,message_type,text,status,payload_json,created_at
      ) VALUES(?1,?2,?3,?4,'inbound',?5,?6,'received',?7,?8)`
    ).bind(
      rowId, clientId, waId, providerId || null,
      String(message?.type || "unknown"),
      text.slice(0, 4000),
      JSON.stringify(message),
      createdAt
    ).run();

    if (!Number(inserted?.meta?.changes || 0)) continue;

    await env.DB.prepare(
      `INSERT INTO whatsapp_contacts(
        id,client_id,wa_id,display_name,unread_count,last_message_at,created_at,updated_at
      ) VALUES(?1,?2,?3,?4,1,?5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(client_id,wa_id) DO UPDATE SET
        display_name=CASE WHEN excluded.display_name<>'' THEN excluded.display_name ELSE whatsapp_contacts.display_name END,
        unread_count=whatsapp_contacts.unread_count+1,
        last_message_at=excluded.last_message_at,
        updated_at=CURRENT_TIMESTAMP`
    ).bind(`wa-contact-${clientId}-${waId}`, clientId, waId, displayName, createdAt).run();

    if (text) {
      const draft = await buildDraft(env, clientId, waId, displayName, text);
      await env.DB.prepare(
        `INSERT INTO whatsapp_drafts(
          id,message_id,client_id,wa_id,classification,priority,needs_human,reply_text,reason,status,created_at,updated_at
        ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'pending',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
      ).bind(
        `wa-draft-${providerId || Date.now()}`,
        rowId, clientId, waId, draft.classification,
        draft.priority, draft.needsHuman ? 1 : 0,
        draft.reply, draft.reason
      ).run();

      await env.DB.prepare(
        `UPDATE whatsapp_contacts SET classification=?3,priority=?4,needs_human=?5,updated_at=CURRENT_TIMESTAMP
         WHERE client_id=?1 AND wa_id=?2`
      ).bind(clientId, waId, draft.classification, draft.priority, draft.needsHuman ? 1 : 0).run();
    }
  }
}

export async function handleWhatsAppWebhook(request, env, url, ctx) {
  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode") || "";
    const token = url.searchParams.get("hub.verify_token") || "";
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (mode === "subscribe" && token && token === String(env.WHATSAPP_VERIFY_TOKEN || "")) {
      return textResponse(challenge, 200);
    }
    return json({ error: "whatsapp_webhook_verification_failed" }, 403);
  }

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const appSecret = String(env.WHATSAPP_APP_SECRET || "");
  if (!appSecret) return json({ error: "whatsapp_app_secret_not_configured" }, 503);

  const rawBody = await request.text();
  const valid = await validWebhookSignature(
    rawBody,
    request.headers.get("x-hub-signature-256"),
    appSecret
  );
  if (!valid) return json({ error: "invalid_webhook_signature" }, 401);

  const body = safeJson(rawBody, {});
  const clientId = String(env.WHATSAPP_CLIENT_ID || "").trim();
  if (!clientId) return json({ error: "whatsapp_client_id_not_configured" }, 503);

  await ensureWhatsAppSchema(env);
  const work = (async () => {
    for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        if (change?.field !== "messages") continue;
        await storeInbound(env, clientId, change?.value || {});
      }
    }
  })();

  if (ctx?.waitUntil) ctx.waitUntil(work);
  else await work;

  return json({ ok: true });
}

async function sendText(env, to, text) {
  const version = String(env.WHATSAPP_GRAPH_VERSION || "").trim();
  const phoneNumberId = String(env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  const token = String(env.WHATSAPP_ACCESS_TOKEN || "").trim();
  if (!version || !phoneNumberId || !token) throw new Error("whatsapp_send_not_configured");

  const response = await fetch(
    `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text }
      }),
      signal: AbortSignal.timeout(15000)
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`whatsapp_http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function handleWhatsAppProtected(request, env, url) {
  if (!url.pathname.startsWith("/api/whatsapp/") || url.pathname === "/api/whatsapp/webhook") {
    return null;
  }

  await ensureWhatsAppSchema(env);
  const clientId = String(env.WHATSAPP_CLIENT_ID || "").trim();

  if (url.pathname === "/api/whatsapp/status" && request.method === "GET") {
    const counts = clientId
      ? await env.DB.prepare(
          `SELECT
            (SELECT COUNT(*) FROM whatsapp_contacts WHERE client_id=?1) AS contacts,
            (SELECT COUNT(*) FROM whatsapp_drafts WHERE client_id=?1 AND status='pending') AS pending_drafts,
            (SELECT COUNT(*) FROM whatsapp_messages WHERE client_id=?1) AS messages`
        ).bind(clientId).first()
      : {};
    return json({ ok: true, ...configStatus(env), counts: {
      contacts: Number(counts?.contacts || 0),
      pendingDrafts: Number(counts?.pending_drafts || 0),
      messages: Number(counts?.messages || 0)
    }});
  }

  if (!clientId) return json({ error: "whatsapp_client_id_not_configured" }, 503);

  if (url.pathname === "/api/whatsapp/inbox" && request.method === "GET") {
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 30)));
    const rows = await env.DB.prepare(
      `SELECT wa_id,display_name,classification,priority,needs_human,unread_count,last_message_at,updated_at
       FROM whatsapp_contacts WHERE client_id=?1
       ORDER BY priority DESC, COALESCE(last_message_at,updated_at) DESC LIMIT ?2`
    ).bind(clientId, limit).all();
    return json({ ok: true, items: rows?.results || [] });
  }

  if (url.pathname === "/api/whatsapp/messages" && request.method === "GET") {
    const waId = cleanPhone(url.searchParams.get("phone"));
    if (!waId) return json({ error: "phone_required" }, 400);
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 50)));
    const rows = await env.DB.prepare(
      `SELECT id,direction,message_type,text,status,created_at
       FROM whatsapp_messages WHERE client_id=?1 AND wa_id=?2
       ORDER BY created_at DESC LIMIT ?3`
    ).bind(clientId, waId, limit).all();
    return json({ ok: true, phone: waId, items: [...(rows?.results || [])].reverse() });
  }

  if (url.pathname === "/api/whatsapp/drafts" && request.method === "GET") {
    const status = String(url.searchParams.get("status") || "pending");
    const rows = await env.DB.prepare(
      `SELECT id,message_id,wa_id,classification,priority,needs_human,reply_text,reason,status,created_at
       FROM whatsapp_drafts WHERE client_id=?1 AND status=?2
       ORDER BY priority DESC, created_at DESC LIMIT 100`
    ).bind(clientId, status).all();
    return json({ ok: true, items: rows?.results || [] });
  }

  if (url.pathname === "/api/whatsapp/send" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (body?.confirmed !== true) {
      return json({ error: "human_confirmation_required" }, 409);
    }

    const to = cleanPhone(body?.to);
    const text = String(body?.text || "").trim();
    if (to.length < 10 || to.length > 15) return json({ error: "invalid_phone" }, 400);
    if (!text) return json({ error: "text_required" }, 400);
    if (text.length > 4096) return json({ error: "text_too_long" }, 400);

    const limit = configStatus(env).sendLimitPerHour;
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM whatsapp_send_log WHERE client_id=?1 AND created_at>=datetime('now','-1 hour')"
    ).bind(clientId).first();
    if (Number(row?.total || 0) >= limit) {
      return json({ error: "whatsapp_hourly_send_limit_reached", limit }, 429);
    }

    try {
      const result = await sendText(env, to, text);
      const providerId = String(result?.messages?.[0]?.id || "");
      const id = providerId || `wa-out-${clientId}-${Date.now()}`;

      await env.DB.prepare(
        `INSERT OR IGNORE INTO whatsapp_messages(
          id,client_id,wa_id,provider_message_id,direction,message_type,text,status,payload_json,created_at
        ) VALUES(?1,?2,?3,?4,'outbound','text',?5,'sent',?6,CURRENT_TIMESTAMP)`
      ).bind(id, clientId, to, providerId || null, text, JSON.stringify(result)).run();

      await env.DB.prepare(
        `INSERT INTO whatsapp_send_log(id,client_id,wa_id,message_id,text_preview,created_at)
         VALUES(?1,?2,?3,?4,?5,CURRENT_TIMESTAMP)`
      ).bind(`wa-log-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, clientId, to, providerId, text.slice(0, 120)).run();

      if (body?.draftId) {
        await env.DB.prepare(
          "UPDATE whatsapp_drafts SET status='sent',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
        ).bind(String(body.draftId), clientId).run();
      }

      return json({ ok: true, to, providerMessageId: providerId || null });
    } catch (error) {
      return json({ error: String(error?.message || error) }, Number(error?.status || 502));
    }
  }

  return json({ error: "not_found" }, 404);
}

export function whatsappConfigStatus(env) {
  return configStatus(env);
}
