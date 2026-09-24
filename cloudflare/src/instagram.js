import { sha256Hex } from "./auth.js";
import { getClient, upsertClient } from "./clients.js";
import { encryptSecret, decryptSecret } from "./secrets.js";

export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments"
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
  const appId = String(env.INSTAGRAM_APP_ID || record.appId || "").trim();
  const encrypted = String(record.appSecret || "");
  const hasSecret = Boolean(String(env.INSTAGRAM_APP_SECRET || "").trim() || encrypted);
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
  const appId = String(env.INSTAGRAM_APP_ID || record.appId || "").trim();
  const envSecret = String(env.INSTAGRAM_APP_SECRET || "").trim();
  const appSecret = envSecret || (record.appSecret ? await decryptSecret(env, record.appSecret) : "");
  return { appId, appSecret };
}

export async function startInstagramOAuth(env, request, clientId) {
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
    JSON.stringify({ redirectUri: instagramRedirectUri(request) }),
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

  try {
    const { appId, appSecret } = await masterInstagramCredentials(env);
    if (!appId || !appSecret) throw new Error("instagram_nexus_not_configured");

    const payload = parseJson(saved.payload_json, {});
    const redirectUri = String(payload.redirectUri || instagramRedirectUri(request));
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
    return oauthHtml(
      true,
      username ? "Conta @" + username + " autorizada com sucesso." : "Conta autorizada com sucesso."
    );
  } catch (error) {
    await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?1").bind(stateHash).run().catch(() => {});
    return oauthHtml(false, "Não foi possível concluir a autorização do Instagram.");
  }
}
