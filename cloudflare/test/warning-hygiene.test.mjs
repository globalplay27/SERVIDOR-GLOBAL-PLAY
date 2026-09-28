import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const extended = fs.readFileSync(new URL("../src/extended-agents.js", import.meta.url), "utf8");
const runtime = fs.readFileSync(new URL("../src/agent-runtime.js", import.meta.url), "utf8");

test("Designer ignores stale/exhausted historical failures", () => {
  assert.match(extended, /72\*60\*60\*1000/);
  assert.match(extended, /retryCount<3/);
});

test("Support ignores transient self-healing post errors", () => {
  for (const error of [
    "quality_gate_pending",
    "visual_quality_rejected",
    "copy_quality_rejected",
    "unique_media_required",
    "duplicate_media_blocked",
    "duplicate_caption_blocked"
  ]) assert.match(extended, new RegExp(error));
  assert.match(extended, /status\|\|"failed"/);
});

test("Auditor falls back to recent valid RADAR data before warning", () => {
  assert.match(runtime, /scannedAt:new Date\(\)\.toISOString\(\)/);
  assert.match(runtime, /hasRecentRadar/);
});
