import { sha256Hex } from "./auth.js";
import { getClient, upsertClient } from "./clients.js";
import { encryptSecret, decryptSecret } from "./secrets.js";

export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
  "instagram_business_manage_insights"
];

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function randomToken(size = 24) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function instagramRedirectUri(request) {
  return new URL("/api/oauth/instagram/callback", new URL(request.url).origin).toString();
}

async function masterInstagramRecord(env) {
  const row = await env.DB.prepare(
    `SELECT value_json, updated_at
     FROM nexus_state
     WHERE namespace = 'integration' AND item_key = 'instagram-master' AND client_id = ''
     LIMIT 1`
  ).first();
  const value = row ? parseJson(row.value_json, {}) : {};
  return { ...value, updatedAt: row?.updated_at || value.updatedAt || null };
}

export async function getMasterInstagramSummary(env, request) {
  const record = await masterInstagramRecord(env);
  const appId = String(record.appId || env.INSTAGRAM_APP_ID || "").trim();
  const encrypted = String(record.appSecret || "");
  const hasSecret = Boolean(encrypted || String(env.INSTAGRAM_APP_SECRET || "").trim());
  return {
    configured: Boolean(appId && hasSecret),
    appId,
    callbackUrl: instagramRedirectUri(request),
    scopes: INSTAGRAM_SCOPES,
    updatedAt: record.updatedAt || null
  };
}

export async function saveMasterInstagramConfig(env, request, body = {}) {
  const current = await masterInstagramRecord(env);
  const appId = String(body.appId || env.INSTAGRAM_APP_ID || current.appId || "").trim();
  const suppliedSecret = String(body.appSecret || "").trim();
  const existingSecret = String(current.appSecret || "");

  if (!appId) throw new Error("instagram_app_id_required");
  if (!suppliedSecret && !String(env.INSTAGRAM_APP_SECRET || "").trim() && !existingSecret) {
    throw new Error("instagram_app_secret_required");
  }

  const next = {
    ...current,
    appId,
    appSecret: suppliedSecret ? await encryptSecret(env, suppliedSecret) : existingSecret,
    updatedAt: new Date().toISOString()
  };

  await env.DB.prepare(
    `INSERT INTO nexus_state(namespace, item_key, client_id, value_json, updated_at)
     VALUES('integration', 'instagram-master', '', ?1, CURRENT_TIMESTAMP)
     ON CONFLICT(namespace, item_key, client_id) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(JSON.stringify(next)).run();

  return getMasterInstagramSummary(env, request);
}

async function masterInstagramCredentials(env) {
  const record = await masterInstagramRecord(env);
  const appId = String(record.appId || env.INSTAGRAM_APP_ID || "").trim();
  const envSecret = String(env.INSTAGRAM_APP_SECRET || "").trim();
  const storedSecret = record.appSecret ? await decryptSecret(env, record.appSecret).catch(() => "") : "";
  const appSecret = storedSecret || envSecret;
  return { appId, appSecret };
}

export async function startInstagramOAuth(env, request, clientId, returnTo = "") {
  const client = await getClient(env, clientId);
  if (!client) throw new Error("client_not_found");

  const { appId, appSecret } = await masterInstagramCredentials(env);
  if (!appId || !appSecret) throw new Error("instagram_nexus_not_configured");

  await env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < CURRENT_TIMESTAMP").run().catch(() => {});

  const state = "ig_" + randomToken(24);
  const stateHash = await sha256Hex(state);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO oauth_states(state_hash, client_id, provider, payload_json, expires_at, created_at)
     VALUES(?1, ?2, 'instagram', ?3, ?4, CURRENT_TIMESTAMP)`
  ).bind(
    stateHash,
    client.id,
    JSON.stringify({ redirectUri: instagramRedirectUri(request), returnTo: String(returnTo || "") }),
    expiresAt
  ).run();

  const authorize = new URL("https://www.instagram.com/oauth/authorize");
  authorize.searchParams.set("client_id", appId);
  authorize.searchParams.set("redirect_uri", instagramRedirectUri(request));
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("force_reauth", "true");
  authorize.searchParams.set("enable_fb_login", "0");
  return { url: authorize.toString(), expiresAt };
}

function oauthHtml(ok, message) {
  const safe = String(message || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  return new Response(
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NEXUS AI</title><body style="margin:0;background:#050807;color:#f4f8f5;font-family:system-ui;display:grid;place-items:center;min-height:100vh"><div style="max-width:520px;padding:30px;border:1px solid #173549;border-radius:20px;background:#071018;text-align:center"><h1 style="margin-top:0;color:${ok ? "#5dd3ff" : "#ff9898"}">${ok ? "Instagram conectado" : "Falha na conexão"}</h1><p style="color:#aab9c2;line-height:1.5">${safe}</p><p>Você pode fechar esta janela e voltar ao NEXUS AI.</p></div><script>try{if(window.opener)window.opener.postMessage({type:"nexus-instagram-oauth",ok:${ok ? "true" : "false"}},"*");}catch(e){}setTimeout(()=>window.close(),900);<\/script></body></html>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

export async function handleInstagramOAuthCallback(env, request, url) {
  if (url.pathname !== "/api/oauth/instagram/callback" || request.method !== "GET") return null;

  const oauthError = String(url.searchParams.get("error") || "");
  if (oauthError) return oauthHtml(false, "A autorização foi cancelada ou recusada.");

  const code = String(url.searchParams.get("code") || "").split("#")[0];
  const state = String(url.searchParams.get("state") || "");
  if (!code || !state) return oauthHtml(false, "Autorização inválida ou incompleta.");

  const stateHash = await sha256Hex(state);
  const saved = await env.DB.prepare(
    `SELECT state_hash, client_id, provider, payload_json, expires_at
     FROM oauth_states WHERE state_hash = ?1 LIMIT 1`
  ).bind(stateHash).first();

  const expires = saved?.expires_at ? new Date(saved.expires_at).getTime() : 0;
  if (!saved || saved.provider !== "instagram" || !expires || expires < Date.now()) {
    await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?1").bind(stateHash).run().catch(() => {});
    return oauthHtml(false, "Esta autorização expirou. Inicie novamente pelo painel.");
  }

  let returnTo = "";
  try {
    const { appId, appSecret } = await masterInstagramCredentials(env);
    if (!appId || !appSecret) throw new Error("instagram_nexus_not_configured");

    const payload = parseJson(saved.payload_json, {});
    const redirectUri = String(payload.redirectUri || instagramRedirectUri(request));
    returnTo = String(payload.returnTo || "");
    if (returnTo && !returnTo.startsWith("/master")) returnTo = "";
    const tokenBody = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code
    });

    const tokenResponse = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenBody
    });
    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      throw new Error("instagram_token_exchange_failed");
    }

    let accessToken = String(tokenPayload.access_token);
    let expiresIn = Number(tokenPayload.expires_in || 3600);

    try {
      const longUrl = new URL("https://graph.instagram.com/access_token");
      longUrl.searchParams.set("grant_type", "ig_exchange_token");
      longUrl.searchParams.set("client_secret", appSecret);
      longUrl.searchParams.set("access_token", accessToken);
      const longResponse = await fetch(longUrl);
      if (longResponse.ok) {
        const longPayload = await longResponse.json().catch(() => ({}));
        if (longPayload.access_token) accessToken = String(longPayload.access_token);
        if (longPayload.expires_in) expiresIn = Number(longPayload.expires_in);
      }
    } catch {}

    const meUrl = new URL("https://graph.instagram.com/me");
    meUrl.searchParams.set("fields", "id,username,account_type");
    meUrl.searchParams.set("access_token", accessToken);
    const meResponse = await fetch(meUrl);
    const profile = await meResponse.json().catch(() => ({}));
    if (!meResponse.ok || !profile.id) throw new Error("instagram_profile_failed");

    const client = await getClient(env, saved.client_id);
    if (!client) throw new Error("client_not_found");

    const username = String(profile.username || "").replace(/^@/, "");
    const expectedUsername = String(client.instagram || "").replace(/^@/, "").trim();
    if (expectedUsername && username && expectedUsername.toLowerCase() !== username.toLowerCase()) {
      throw new Error("oauth_account_mismatch");
    }

    const connectionPayload = {
      accessToken: await encryptSecret(env, accessToken),
      expiresAt: new Date(Date.now() + Math.max(3600, expiresIn) * 1000).toISOString(),
      igUserId: String(profile.id || tokenPayload.user_id || ""),
      accountType: String(profile.account_type || ""),
      scopes: INSTAGRAM_SCOPES,
      label: username ? "@" + username : "Instagram conectado",
      username
    };

    await env.DB.prepare(
      `INSERT INTO connections(client_id, provider, payload_json, connected_at, updated_at)
       VALUES(?1, 'meta', ?2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(client_id, provider) DO UPDATE SET
         payload_json = excluded.payload_json,
         connected_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(client.id, JSON.stringify(connectionPayload)).run();

    const onboarding = {
      ...(client.config?.onboarding && typeof client.config.onboarding === "object"
        ? client.config.onboarding
        : {}),
      instagram: true
    };
    const integrationState = {
      ...(client.config?.integrationState && typeof client.config.integrationState === "object"
        ? client.config.integrationState
        : {}),
      meta: "connected"
    };

    await upsertClient(env, {
      ...client,
      instagram: username ? "@" + username : "Instagram conectado",
      config: { ...client.config, onboarding, integrationState }
    });

    await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?1").bind(stateHash).run();
    if (returnTo) {
      const separator = returnTo.includes("?") ? "&" : "?";
      return new Response(null, {
        status: 303,
        headers: {
          location: returnTo + separator + "oauth=success",
          "cache-control": "no-store"
        }
      });
    }
    return oauthHtml(
      true,
      username ? "Conta @" + username + " autorizada com sucesso." : "Conta autorizada com sucesso."
    );
  } catch (error) {
    await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?1").bind(stateHash).run().catch(() => {});
    if (returnTo) {
      const separator = returnTo.includes("?") ? "&" : "?";
      const reason = error?.message === "oauth_account_mismatch" ? "account_mismatch" : "failed";
      return new Response(null, {
        status: 303,
        headers: {
          location: returnTo + separator + "oauth=" + encodeURIComponent(reason),
          "cache-control": "no-store"
        }
      });
    }
    return oauthHtml(false, error?.message === "oauth_account_mismatch" ? "Você autorizou uma conta diferente da conta cadastrada neste cliente." : "Não foi possível concluir a autorização do Instagram.");
  }
}


export async function instagramMasterConfigStatus(env) {
  const record = await masterInstagramRecord(env);
  const envAppId = String(env.INSTAGRAM_APP_ID || "").trim();
  const envAppSecret = String(env.INSTAGRAM_APP_SECRET || "").trim();
  const storedAppId = String(record.appId || "").trim();
  const storedSecret = String(record.appSecret || "").trim();

  return {
    configured: Boolean((storedAppId || envAppId) && (storedSecret || envAppSecret)),
    appId: storedAppId || envAppId || "",
    appIdConfigured: Boolean(storedAppId || envAppId),
    appSecretConfigured: Boolean(storedSecret || envAppSecret),
    appIdSource: storedAppId ? "nexus-d1" : envAppId ? "cloudflare-env" : "none",
    appSecretSource: storedSecret ? "nexus-d1" : envAppSecret ? "cloudflare-secret" : "none",
    updatedAt: record.updatedAt || null
  };
}


export async function connectInstagramWithToken(env, clientId, suppliedToken) {
  const client = await getClient(env, clientId);
  if (!client) throw new Error("client_not_found");

  let accessToken = String(suppliedToken || "").trim();
  if (accessToken.length < 20) throw new Error("instagram_token_required");

  let expiresIn = 0;
  try {
    const { appSecret } = await masterInstagramCredentials(env);
    if (appSecret) {
      const exchangeUrl = new URL("https://graph.instagram.com/access_token");
      exchangeUrl.searchParams.set("grant_type", "ig_exchange_token");
      exchangeUrl.searchParams.set("client_secret", appSecret);
      exchangeUrl.searchParams.set("access_token", accessToken);
      const exchange = await fetch(exchangeUrl, { signal: AbortSignal.timeout(15000) });
      if (exchange.ok) {
        const payload = await exchange.json().catch(() => ({}));
        if (payload?.access_token) accessToken = String(payload.access_token);
        if (payload?.expires_in) expiresIn = Number(payload.expires_in || 0);
      }
    }
  } catch {}

  const meUrl = new URL("https://graph.instagram.com/me");
  meUrl.searchParams.set("fields", "id,username,account_type");
  meUrl.searchParams.set("access_token", accessToken);
  const me = await fetch(meUrl, { signal: AbortSignal.timeout(15000) });
  const profile = await me.json().catch(() => ({}));
  if (!me.ok || !profile?.id) throw new Error("instagram_token_invalid");

  const username = String(profile.username || "").replace(/^@/, "").trim();
  const expectedUsername = String(client.instagram || "").replace(/^@/, "").trim();
  if (expectedUsername && username && expectedUsername.toLowerCase() !== username.toLowerCase()) {
    const error = new Error("instagram_account_mismatch");
    error.expected = expectedUsername;
    error.received = username;
    throw error;
  }

  const connectionPayload = {
    accessToken: await encryptSecret(env, accessToken),
    expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    igUserId: String(profile.id),
    accountType: String(profile.account_type || ""),
    scopes: INSTAGRAM_SCOPES,
    label: username ? "@" + username : "Instagram conectado",
    username,
    source: "manual-nexus-token"
  };

  await env.DB.prepare(
    `INSERT INTO connections(client_id, provider, payload_json, connected_at, updated_at)
     VALUES(?1, 'meta', ?2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(client_id, provider) DO UPDATE SET
       payload_json = excluded.payload_json,
       connected_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(client.id, JSON.stringify(connectionPayload)).run();

  const onboarding = {
    ...(client.config?.onboarding && typeof client.config.onboarding === "object"
      ? client.config.onboarding
      : {}),
    instagram: true
  };
  const integrationState = {
    ...(client.config?.integrationState && typeof client.config.integrationState === "object"
      ? client.config.integrationState
      : {}),
    meta: "connected"
  };

  const updated = await upsertClient(env, {
    ...client,
    instagram: username ? "@" + username : client.instagram,
    config: { ...client.config, onboarding, integrationState }
  });

  return {
    ok: true,
    clientId: updated.id,
    instagram: updated.instagram,
    igUserId: String(profile.id),
    accountType: String(profile.account_type || ""),
    expiresAt: connectionPayload.expiresAt,
    source: "d1-oauth"
  };
}


function base64UrlToBytes(value) {
  let input = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (input.length % 4) input += "=";
  const binary = atob(input);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

function base64UrlToText(value) {
  const bytes = base64UrlToBytes(value);
  return new TextDecoder().decode(bytes);
}

function timingSafeEqualBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyMetaSignedRequest(env, signedRequest) {
  const raw = String(signedRequest || "").trim();
  const parts = raw.split(".");
  if (parts.length !== 2) throw new Error("invalid_signed_request");

  const [signaturePart, payloadPart] = parts;
  const { appSecret } = await masterInstagramCredentials(env);
  if (!appSecret) throw new Error("instagram_nexus_not_configured");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expectedBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadPart)
  );
  const expected = new Uint8Array(expectedBuffer);
  const supplied = base64UrlToBytes(signaturePart);
  if (!timingSafeEqualBytes(expected, supplied)) throw new Error("invalid_signed_request_signature");

  const payload = JSON.parse(base64UrlToText(payloadPart));
  if (!payload || typeof payload !== "object") throw new Error("invalid_signed_request_payload");
  return payload;
}

async function disconnectInstagramUser(env, userId) {
  const target = String(userId || "").trim();
  if (!target) return [];

  const rows = await env.DB.prepare(
    `SELECT client_id, provider, payload_json
     FROM connections
     WHERE provider IN ('meta','instagram')`
  ).all();

  const disconnected = [];
  for (const row of rows?.results || []) {
    const payload = parseJson(row.payload_json, {});
    if (String(payload?.igUserId || "") !== target) continue;

    await env.DB.prepare(
      "DELETE FROM connections WHERE client_id = ?1 AND provider = ?2"
    ).bind(String(row.client_id), String(row.provider)).run();

    const client = await getClient(env, row.client_id).catch(() => null);
    if (client) {
      const onboarding = {
        ...(client.config?.onboarding && typeof client.config.onboarding === "object"
          ? client.config.onboarding
          : {}),
        instagram: false
      };
      const integrationState = {
        ...(client.config?.integrationState && typeof client.config.integrationState === "object"
          ? client.config.integrationState
          : {}),
        meta: "disconnected"
      };
      await upsertClient(env, {
        ...client,
        config: { ...client.config, onboarding, integrationState }
      }).catch(() => {});
    }
    disconnected.push(String(row.client_id));
  }

  await env.DB.prepare(
    "DELETE FROM leads WHERE instagram_user_id = ?1"
  ).bind(target).run().catch(() => {});

  return disconnected;
}

async function requestBodyValue(request, key) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return String(body?.[key] || "");
  }
  const text = await request.text().catch(() => "");
  return String(new URLSearchParams(text).get(key) || "");
}

export async function handleInstagramComplianceRequest(env, request, url) {
  const path = url.pathname;
  const deauthorizePath = "/api/meta/instagram/deauthorize";
  const deletionPath = "/api/meta/instagram/data-deletion";
  const statusPath = "/api/meta/instagram/data-deletion/status";

  if (![deauthorizePath, deletionPath, statusPath].includes(path)) return null;

  if (path === statusPath && request.method === "GET") {
    const code = String(url.searchParams.get("code") || "").trim();
    if (!code) {
      return new Response("Código de confirmação ausente.", {
        status: 400,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
      });
    }
    const row = await env.DB.prepare(
      `SELECT value_json, updated_at
       FROM nexus_state
       WHERE namespace='instagram-data-deletion' AND item_key=?1 AND client_id=''
       LIMIT 1`
    ).bind(code).first();
    if (!row) {
      return new Response("Solicitação não encontrada.", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
      });
    }
    const record = parseJson(row.value_json, {});
    return new Response(
      `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NEXUS AI · Exclusão de dados</title><body style="font-family:system-ui;background:#050807;color:#f4f8f5;display:grid;place-items:center;min-height:100vh"><main style="max-width:620px;padding:28px;border:1px solid #173549;border-radius:18px;background:#071018"><h1>Solicitação de exclusão</h1><p>Status: <strong>${String(record.status || "concluída")}</strong></p><p>Código: <code>${code.replace(/[<>&"]/g, "")}</code></p><p>Dados de autorização e registros vinculados ao identificador recebido da Meta foram removidos do NEXUS.</p></main></body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
    );
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }

  try {
    const signedRequest = await requestBodyValue(request, "signed_request");
    const payload = await verifyMetaSignedRequest(env, signedRequest);
    const userId = String(payload?.user_id || payload?.userId || "").trim();
    if (!userId) throw new Error("user_id_missing");

    const disconnectedClients = await disconnectInstagramUser(env, userId);

    if (path === deauthorizePath) {
      return new Response(JSON.stringify({
        ok: true,
        disconnected: disconnectedClients.length
      }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
      });
    }

    const confirmationCode = "del_" + randomToken(18);
    const statusUrl = new URL(statusPath, new URL(request.url).origin);
    statusUrl.searchParams.set("code", confirmationCode);

    await env.DB.prepare(
      `INSERT INTO nexus_state(namespace, item_key, client_id, value_json, updated_at)
       VALUES('instagram-data-deletion', ?1, '', ?2, CURRENT_TIMESTAMP)
       ON CONFLICT(namespace, item_key, client_id) DO UPDATE SET
         value_json=excluded.value_json,
         updated_at=CURRENT_TIMESTAMP`
    ).bind(
      confirmationCode,
      JSON.stringify({
        status: "concluída",
        requestedAt: new Date().toISOString(),
        disconnectedClients
      })
    ).run();

    return new Response(JSON.stringify({
      url: statusUrl.toString(),
      confirmation_code: confirmationCode
    }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error)
    }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }
}
