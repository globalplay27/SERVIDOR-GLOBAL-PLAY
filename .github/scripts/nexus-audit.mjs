// Read-only operational snapshot. Never print raw connection payloads, tokens,
// captions, image URLs, or unfiltered provider errors into public Actions logs.
import { execFileSync } from "node:child_process";

const clients = ["ragnar-one", "globalplay-streaming"];
const safe = value => String(value ?? "").slice(0, 120);
const category = value => {
  const v = String(value || "").toLowerCase();
  if (!v) return "none";
  if (/quality_gate|visual_quality|copy_quality/.test(v)) return "quality_gate";
  if (/unique_media|duplicate_media|image.*required|media.*missing/.test(v)) return "media_missing_or_repeat";
  if (/duplicate_caption/.test(v)) return "duplicate_caption";
  if (/instagram_not_connected|access.token|token|oauth|permission|scope|authoriz/.test(v)) return "auth_or_permission";
  if (/instagram.*process|container|media_publish/.test(v)) return "meta_processing_or_publish";
  if (/quota|budget|openai/.test(v)) return "openai_or_budget";
  if (/timed?out|timeout|network|fetch|http_5/.test(v)) return "network_or_timeout";
  if (/instagram|graph|meta/.test(v)) return "meta_other";
  return "other";
};
let failedQueries = 0;
function select(label, sql) {
  let output = "";
  let parsed;
  try {
    output = execFileSync("npx", [
      "--no-install", "wrangler", "d1", "execute", "servidor-nexus",
      "--remote", "--json", "--command", sql
    ], { encoding: "utf8", maxBuffer: 5 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    const start = output.indexOf("[");
    const end = output.lastIndexOf("]");
    parsed = JSON.parse(start >= 0 && end >= start ? output.slice(start, end + 1) : output.trim());
    const block = Array.isArray(parsed) ? parsed[0] : parsed;
    if (block?.success === false || !Array.isArray(block?.results)) throw Error("query_result");
    return block.results;
  } catch (error) {
    failedQueries++;
    const diagnostic = String(error?.stderr || error?.message || "").toLowerCase();
    const reason = /authentication|unauthorized|invalid api token|code: 10000|code: 9109|forbidden/.test(diagnostic)
      ? "authentication_or_permission"
      : /permission|scope|code: 10001/.test(diagnostic) ? "permission"
      : /sql|syntax|no such table|no such column/.test(diagnostic) ? "sql_or_schema"
      : output && /json|unexpected token|parse/.test(diagnostic) ? "output_parse"
      : /network|timeout|fetch/.test(diagnostic) ? "network"
      : "unknown";
    console.log(JSON.stringify({ section: label, status: "query_failed", reason,
      firstCharCode: output.trim().charCodeAt(0) || 0,
      lastCharCode: output.trim().charCodeAt(output.trim().length - 1) || 0,
      length: output.length,
      parsedType: Array.isArray(parsed) ? "array" : typeof parsed,
      commandExitCode: Number(error?.status) || 0,
      diagnosticFlags: {
        database: /database|d1|binding/.test(diagnostic),
        notFound: /not found|couldn't find|does not exist/.test(diagnostic),
        unauthorized: /unauthorized|authentication|permission|forbidden|not allowed/.test(diagnostic),
        account: /account/.test(diagnostic),
        invalidArgument: /unknown argument|invalid argument|option|requires/.test(diagnostic),
        network: /network|fetch|timed out/.test(diagnostic),
        wranglerConfig: /wrangler\\.jsonc|configuration file/.test(diagnostic)
      },
      resultKeys: parsed && typeof parsed === "object"
        ? Object.keys(Array.isArray(parsed) ? parsed[0] || {} : parsed).slice(0, 12) : [] }));
    return null;
  }
}
const where = "('ragnar-one','globalplay-streaming')";
const c = select("clients", `SELECT id,status,instagram,updated_at,
  json_extract(CASE WHEN json_valid(config_json) THEN config_json ELSE '{}' END,'$.agentCore.enabled') enabled,
  json_extract(CASE WHEN json_valid(config_json) THEN config_json ELSE '{}' END,'$.agentCore.autoPublish') auto_publish
  FROM clients WHERE id IN ${where}`);
if (c) console.log(JSON.stringify({section:"clients",rows:c.map(x=>({
  client:safe(x.id),status:safe(x.status),handle:safe(x.instagram),updated:safe(x.updated_at),
  enabled:x.enabled,autoPublish:x.auto_publish
}))}));
const j = select("jobs", `SELECT id,client_id,kind,status,attempts,due_at,updated_at,last_error
  FROM scheduled_jobs WHERE client_id IN ${where}
  ORDER BY updated_at DESC LIMIT 40`);
if (j) console.log(JSON.stringify({section:"jobs",rows:j.map(x=>({
  id:safe(x.id),client:safe(x.client_id),kind:safe(x.kind),status:safe(x.status),
  attempts:Number(x.attempts)||0,due:safe(x.due_at),updated:safe(x.updated_at),
  errorCategory:category(x.last_error)
}))}));
const p = select("posts", `SELECT id,client_id,status,approval_status,scheduled_for,created_at,updated_at,error,
  json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.copyChief') copy_gate,
  json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.designer') visual_gate,
  json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.retryCount') retry_count,
  json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.source') source,
  CASE WHEN json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.imageUrl') IS NOT NULL
    AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.imageUrl') <> '' THEN 1 ELSE 0 END media_present
  FROM post_ledger WHERE client_id IN ${where}
  ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 45`);
if (p) console.log(JSON.stringify({section:"posts",rows:p.map(x=>({
  id:safe(x.id),client:safe(x.client_id),status:safe(x.status),
  approval:safe(x.approval_status),scheduled:safe(x.scheduled_for),
  created:safe(x.created_at),updated:safe(x.updated_at),
  errorCategory:category(x.error),copyGate:safe(x.copy_gate),
  visualGate:safe(x.visual_gate),retryCount:Number(x.retry_count)||0,
  source:safe(x.source),mediaPresent:Boolean(x.media_present)
}))}));
const e = select("executions", `SELECT client_id,agent,status,created_at
  FROM agent_executions WHERE client_id IN ${where}
  ORDER BY created_at DESC LIMIT 50`);
if (e) console.log(JSON.stringify({section:"executions",rows:e.map(x=>({
  client:safe(x.client_id),agent:safe(x.agent),status:safe(x.status),
  at:safe(x.created_at)
}))}));
const n = select("state", `SELECT namespace,item_key,client_id,updated_at,
  json_extract(CASE WHEN json_valid(value_json) THEN value_json ELSE '{}' END,'$.lastCronAt') last_cron,
  json_extract(CASE WHEN json_valid(value_json) THEN value_json ELSE '{}' END,'$.lastCycleAt') last_cycle,
  json_extract(CASE WHEN json_valid(value_json) THEN value_json ELSE '{}' END,'$.lastCycleStatus') cycle_status,
  json_extract(CASE WHEN json_valid(value_json) THEN value_json ELSE '{}' END,'$.lastCycleError') cycle_error
  FROM nexus_state WHERE (namespace='agent-core' AND item_key IN ('scheduler','state') AND client_id IN ${where})
  OR (namespace='scheduler' AND item_key='heartbeat' AND client_id='')
  ORDER BY updated_at DESC LIMIT 8`);
if (n) console.log(JSON.stringify({section:"state",rows:n.map(x=>({
  namespace:safe(x.namespace),item:safe(x.item_key),client:safe(x.client_id),
  updated:safe(x.updated_at),lastCron:safe(x.last_cron),lastCycle:safe(x.last_cycle),
  cycleStatus:safe(x.cycle_status),errorCategory:category(x.cycle_error)
}))}));
const o = select("oauth", `SELECT client_id,provider,connected_at,updated_at,
  json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.expiresAt') expires_at,
  CASE WHEN json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.accessToken') IS NOT NULL THEN 1 ELSE 0 END has_token,
  CASE WHEN client_id='ragnar-one' AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.username')='ragnarplay1' THEN 1
       WHEN client_id='globalplay-streaming' AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.username')='globalplay_streaming' THEN 1 ELSE 0 END username_matches
  FROM connections WHERE client_id IN ${where} AND provider IN ('instagram','meta')`);
if (o) console.log(JSON.stringify({section:"oauth",rows:o.map(x=>({
  client:safe(x.client_id),provider:safe(x.provider),connected:safe(x.connected_at),
  updated:safe(x.updated_at),expires:safe(x.expires_at),hasToken:Boolean(x.has_token),
  usernameMatches:Boolean(x.username_matches)
}))}));
const u = select("usage", `SELECT client_id,SUM(calls) calls,SUM(used_tokens) tokens
  FROM token_usage WHERE client_id IN ${where} AND day_key>=date('now','-7 days')
  GROUP BY client_id`);
if (u) console.log(JSON.stringify({section:"usage_7d",rows:u.map(x=>({
  client:safe(x.client_id),calls:Number(x.calls)||0,tokens:Number(x.tokens)||0
}))}));
if (failedQueries) process.exitCode = 1;
