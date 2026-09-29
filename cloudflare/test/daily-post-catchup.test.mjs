import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const scheduler = fs.readFileSync(new URL("../src/scheduler.js", import.meta.url), "utf8");
const runtime = fs.readFileSync(new URL("../src/agent-runtime.js", import.meta.url), "utf8");

test("autonomous accounts catch up toward three daily posts with spacing", () => {
  assert.match(scheduler, /publishedCount < 3/);
  assert.match(scheduler, /90 \* 60 \* 1000/);
  assert.match(scheduler, /Math\.min\(config\.cycleMinutes, 15\)/);
  assert.match(scheduler, /scheduledRecoveryReason = "daily_target_catch_up"/);
  assert.match(scheduler, /UPDATE post_ledger SET scheduled_for=\?2/);
  assert.match(scheduler, /if \(!dueReady\)/);
  assert.match(scheduler, /due\(state\.lastPublisherQueuedAt, 1, nowMs\)/);
  assert.match(runtime, /publishedTodayCount\+=1/);
  assert.match(runtime, /publishedTodayCount<dailyPublishTarget/);
  assert.match(runtime, /scheduledRecoveryReason:"daily_target_catch_up"/);
});

test("catch-up keeps one-at-a-time publishing instead of dumping multiple posts", () => {
  assert.match(runtime, /if\(published>0\|\|publishedTodayCount>=3\)break/);
  assert.match(runtime, /recoveryPulledForward=true/);
});
