import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const scheduler = fs.readFileSync(new URL("../src/scheduler.js", import.meta.url), "utf8");
const runtime = fs.readFileSync(new URL("../src/agent-runtime.js", import.meta.url), "utf8");

test("autonomous accounts catch up toward three daily posts with spacing", () => {
  assert.match(scheduler, /publishedCount < 3/);
  assert.match(scheduler, /90 \* 60 \* 1000/);
  assert.match(scheduler, /Math\.min\(config\.cycleMinutes, 15\)/);
  assert.match(runtime, /publishedTodayCount<dailyPublishTarget/);
  assert.match(runtime, /scheduledRecoveryReason:"daily_target_catch_up"/);
});

test("catch-up keeps one-at-a-time publishing instead of dumping multiple posts", () => {
  assert.match(runtime, /if\(published>0\)break/);
  assert.match(runtime, /recoveryPulledForward=true/);
});
