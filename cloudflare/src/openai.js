import { openAIKeyForClient } from "./openai-routing.js";

function usageNumbers(usage = {}) {
  const inputTokens = Math.max(0, Number(usage.input_tokens ?? usage.prompt_tokens ?? 0));
  const outputTokens = Math.max(0, Number(usage.output_tokens ?? usage.completion_tokens ?? 0));
  const total = Math.max(0, Number(usage.total_tokens ?? 0)) || (inputTokens + outputTokens);
  return { inputTokens, outputTokens, total };
}

async function recordUsage(env, clientId, usage, model = "") {
  const { inputTokens, outputTokens, total } = usageNumbers(usage);
  if (!total) return;
  const dayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  await env.DB.prepare(
    `INSERT INTO token_usage(client_id, day_key, input_tokens, output_tokens, used_tokens, calls, last_model, updated_at)
     VALUES(?1, ?2, ?3, ?4, ?5, 1, ?6, CURRENT_TIMESTAMP)
     ON CONFLICT(client_id, day_key) DO UPDATE SET
       input_tokens = token_usage.input_tokens + excluded.input_tokens,
       output_tokens = token_usage.output_tokens + excluded.output_tokens,
       used_tokens = token_usage.used_tokens + excluded.used_tokens,
       calls = token_usage.calls + 1,
       last_model = excluded.last_model,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(String(clientId), dayKey, inputTokens, outputTokens, total, String(model || "")).run();
}

export async function openAIResponses(env, clientId, input) {
  const apiKey = openAIKeyForClient(env, clientId);
  if (!apiKey) throw new Error("openai_not_configured_for_client");

  const payload = { ...(input && typeof input === "object" ? input : {}) };
  delete payload.clientId;
  if (!payload.model) payload.model = "gpt-5.6-luna";
  if (!Object.prototype.hasOwnProperty.call(payload, "input")) payload.input = "";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "Servidor-Nexus/1.0"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`openai_http_${response.status}`);
    error.status = response.status;
    error.detail = data;
    throw error;
  }

  await recordUsage(env, clientId, data?.usage || {}, payload.model).catch(() => {});
  return data;
}

export async function tokenUsageToday(env, clientId) {
  const dayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const row = await env.DB.prepare(
    `SELECT input_tokens, output_tokens, used_tokens, calls, last_model, updated_at
     FROM token_usage WHERE client_id = ?1 AND day_key = ?2 LIMIT 1`
  ).bind(String(clientId), dayKey).first();
  return {
    clientId: String(clientId),
    dayKey,
    inputTokens: Number(row?.input_tokens || 0),
    outputTokens: Number(row?.output_tokens || 0),
    usedTokens: Number(row?.used_tokens || 0),
    calls: Number(row?.calls || 0),
    lastModel: row?.last_model || null,
    updatedAt: row?.updated_at || null
  };
}
