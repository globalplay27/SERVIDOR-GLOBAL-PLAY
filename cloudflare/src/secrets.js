const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const padded = String(value || "").replace(/-/g, "+").replace(/_/g, "/")
    + "===".slice((String(value || "").length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function encryptionKey(env) {
  const secret = String(env.NEXUS_SECRET_KEY || "").trim();
  if (!secret) throw new Error("nexus_secret_not_configured");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode("nexus-secret-v1|" + secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(env, value) {
  const plain = String(value || "");
  if (!plain) return "";
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await encryptionKey(env);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plain)
  ));
  return "v1." + bytesToBase64Url(iv) + "." + bytesToBase64Url(encrypted);
}

export async function decryptSecret(env, value) {
  const raw = String(value || "");
  if (!raw) return "";
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("invalid_encrypted_secret");
  const key = await encryptionKey(env);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(parts[1]) },
    key,
    base64UrlToBytes(parts[2])
  );
  return decoder.decode(decrypted);
}
