import { runSchedulerTick, recordSchedulerFailure } from "./scheduler.js";

export const WATCHDOG_STALE_SECONDS = 180;

export function heartbeatNeedsKick(ageSeconds, thresholdSeconds = WATCHDOG_STALE_SECONDS) {
  const age = Number(ageSeconds);
  return !Number.isFinite(age) || age > Math.max(30, Number(thresholdSeconds || WATCHDOG_STALE_SECONDS));
}

async function claimWatchdog(env) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO nexus_state(namespace,item_key,client_id,value_json,updated_at)
     VALUES('scheduler','watchdog-lock','', '{}', datetime('now','-10 minutes'))`
  ).run();

  const result = await env.DB.prepare(
    `UPDATE nexus_state
     SET value_json='{}',updated_at=CURRENT_TIMESTAMP
     WHERE namespace='scheduler' AND item_key='watchdog-lock' AND client_id=''
       AND updated_at < datetime('now','-2 minutes')`
  ).run();

  return Number(result?.meta?.changes || 0) > 0;
}

export async function refreshSchedulerIfStale(env, now = new Date()) {
  if (String(env.CLOUDFLARE_AUTOMATION_ACTIVE || "").toLowerCase() !== "true") {
    return { kicked:false, reason:"automation_disabled" };
  }

  const heartbeat = await env.DB.prepare(
    `SELECT updated_at,
            CAST(unixepoch('now') - unixepoch(updated_at) AS INTEGER) AS age_seconds
     FROM nexus_state
     WHERE namespace='scheduler' AND item_key='heartbeat' AND client_id=''
     LIMIT 1`
  ).first();

  const ageSeconds = heartbeat?.age_seconds == null ? Infinity : Number(heartbeat.age_seconds);
  if (!heartbeatNeedsKick(ageSeconds)) {
    return { kicked:false, reason:"heartbeat_fresh", ageSeconds };
  }

  if (!await claimWatchdog(env)) {
    return { kicked:false, reason:"watchdog_locked", ageSeconds };
  }

  const at = now instanceof Date ? now : new Date(now || Date.now());
  try {
    const scheduler = await runSchedulerTick(env, at);
    return { kicked:true, reason:"scheduler_refreshed", ageSeconds, scheduler };
  } catch (error) {
    const errorCode = await recordSchedulerFailure(env, at, error).catch(() => "scheduler_tick_error");
    return { kicked:true, reason:"scheduler_failed", ageSeconds, errorCode };
  }
}
