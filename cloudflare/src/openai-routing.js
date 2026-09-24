export function openAIKeyForClient(env, clientId) {
  const ragnarClientId = String(env.RAGNAR_CLIENT_ID || "ragnar-one");
  if (String(clientId || "") === ragnarClientId) {
    return String(env.OPENAI_API_KEY_RAGNAR || "");
  }
  return String(env.OPENAI_API_KEY_SHARED || "");
}

export function openAIKeyStatus(env, clientId) {
  const key = openAIKeyForClient(env, clientId);
  return {
    clientId: String(clientId || ""),
    source: String(clientId || "") === String(env.RAGNAR_CLIENT_ID || "ragnar-one")
      ? "ragnar-exclusive"
      : "shared",
    configured: Boolean(key)
  };
}
