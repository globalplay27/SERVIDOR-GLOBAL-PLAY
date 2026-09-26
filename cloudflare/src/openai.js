import { openAIKeyForClient, openAIKeyStatus } from "./openai-routing.js";
import { getClient } from "./clients.js";

function usageNumbers(usage = {}) {
  const inputTokens = Math.max(0, Number(usage.input_tokens ?? usage.prompt_tokens ?? 0));
  const outputTokens = Math.max(0, Number(usage.output_tokens ?? usage.completion_tokens ?? 0));
  const total = Math.max(0, Number(usage.total_tokens ?? 0)) || (inputTokens + outputTokens);
  return { inputTokens, outputTokens, total };
}

function saoPauloDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function ensureRuntimeStatusTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS openai_runtime_status (
      client_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'ok',
      detail TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();
}

async function setRuntimeStatus(env, clientId, status, detail = "") {
  try {
    await ensureRuntimeStatusTable(env);
    await env.DB.prepare(
      `INSERT INTO openai_runtime_status(client_id,status,detail,updated_at)
       VALUES(?1,?2,?3,CURRENT_TIMESTAMP)
       ON CONFLICT(client_id) DO UPDATE SET
         status=excluded.status,
         detail=excluded.detail,
         updated_at=CURRENT_TIMESTAMP`
    ).bind(String(clientId), String(status || "ok"), String(detail || "").slice(0,500)).run();
  } catch {}
}

async function runtimeStatus(env, clientId) {
  try {
    await ensureRuntimeStatusTable(env);
    const row = await env.DB.prepare(
      "SELECT status, detail, updated_at FROM openai_runtime_status WHERE client_id=?1 LIMIT 1"
    ).bind(String(clientId)).first();
    return {
      status: String(row?.status || "ok"),
      detail: String(row?.detail || ""),
      updatedAt: row?.updated_at || null
    };
  } catch {
    return { status: "unknown", detail: "", updatedAt: null };
  }
}

async function recordUsage(env, clientId, usage, model = "") {
  const { inputTokens, outputTokens, total } = usageNumbers(usage);
  if (!total) return;
  const dayKey = saoPauloDay();

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

function estimateLunaCost(inputTokens, outputTokens) {
  const inputRate = 0.20;
  const outputRate = 1.20;
  return (Number(inputTokens || 0) / 1_000_000) * inputRate
    + (Number(outputTokens || 0) / 1_000_000) * outputRate;
}

export async function tokenUsageToday(env, clientId) {
  const dayKey = saoPauloDay();
  const [row, client, status] = await Promise.all([
    env.DB.prepare(
      `SELECT input_tokens, output_tokens, used_tokens, calls, last_model, updated_at
       FROM token_usage WHERE client_id = ?1 AND day_key = ?2 LIMIT 1`
    ).bind(String(clientId), dayKey).first(),
    getClient(env, clientId).catch(() => null),
    runtimeStatus(env, clientId)
  ]);

  const inputTokens = Number(row?.input_tokens || 0);
  const outputTokens = Number(row?.output_tokens || 0);
  const usedTokens = Number(row?.used_tokens || 0);
  const configuredLimit = Number(
    client?.config?.openaiDailyTokenLimit
    ?? env.NEXUS_OPENAI_DAILY_TOKEN_LIMIT
    ?? 30000
  );
  const limitTokens = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? Math.floor(configuredLimit)
    : 30000;
  const remainingTokens = Math.max(0, limitTokens - usedTokens);
  const percent = limitTokens > 0 ? Math.min(100, Math.round((usedTokens / limitTokens) * 100)) : 0;
  const key = openAIKeyStatus(env, clientId);
  const quotaExhausted = status.status === "quota_exhausted";

  return {
    clientId: String(clientId),
    dayKey,
    inputTokens,
    outputTokens,
    usedTokens,
    calls: Number(row?.calls || 0),
    lastModel: row?.last_model || null,
    updatedAt: row?.updated_at || null,
    limitTokens,
    remainingTokens,
    percent,
    blocked: quotaExhausted || usedTokens >= limitTokens,
    quotaExhausted,
    providerStatus: status.status,
    providerDetail: status.detail,
    providerUpdatedAt: status.updatedAt,
    connected: key.configured,
    keySource: key.source,
    estimatedCostUsd: Number(estimateLunaCost(inputTokens, outputTokens).toFixed(6)),
    costIsEstimate: true,
    pricingModel: "gpt-5.6-luna"
  };
}

export async function openAIResponses(env, clientId, input, options = {}) {
  const apiKey = openAIKeyForClient(env, clientId);
  if (!apiKey) {
    await setRuntimeStatus(env, clientId, "not_configured", "OpenAI key not configured");
    throw new Error("openai_not_configured_for_client");
  }

  const enforceBudget = options?.enforceBudget !== false;
  const recordBudgetUsage = options?.recordBudgetUsage !== false;

  if (enforceBudget) {
    const budget = await tokenUsageToday(env, clientId);
    if (budget.blocked) {
      const error = new Error(budget.quotaExhausted ? "openai_quota_exhausted" : "openai_daily_budget_reached");
      error.status = 429;
      error.detail = budget;
      throw error;
    }
  }

  const payload = { ...(input && typeof input === "object" ? input : {}) };
  delete payload.clientId;
  if (!payload.model) payload.model = "gpt-5.6-luna";
  if (!Object.prototype.hasOwnProperty.call(payload, "input")) payload.input = "";
  if (!Object.prototype.hasOwnProperty.call(payload, "max_output_tokens")) {
    payload.max_output_tokens = Math.max(128, Math.min(4000, Number(env.NEXUS_OPENAI_MAX_OUTPUT_TOKENS || 1200)));
  }

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
    const code = String(data?.error?.code || data?.error?.type || "");
    const message = String(data?.error?.message || "");
    const quota = code === "insufficient_quota"
      || /insufficient[_ ]quota|quota.*exceeded|billing/i.test(code + " " + message);
    await setRuntimeStatus(
      env,
      clientId,
      quota ? "quota_exhausted" : (response.status === 429 ? "rate_limited" : "error"),
      code || message || `HTTP ${response.status}`
    );
    const error = new Error(quota ? "openai_quota_exhausted" : `openai_http_${response.status}`);
    error.status = response.status;
    error.detail = data;
    throw error;
  }

  await Promise.all([
    recordBudgetUsage ? recordUsage(env, clientId, data?.usage || {}, payload.model).catch(() => {}) : Promise.resolve(),
    setRuntimeStatus(env, clientId, "ok", "")
  ]);
  return data;
}
