import test from "node:test";
import assert from "node:assert/strict";
import { heartbeatNeedsKick, WATCHDOG_STALE_SECONDS } from "../src/watchdog.js";

test("watchdog não interfere em heartbeat saudável", () => {
  assert.equal(heartbeatNeedsKick(0), false);
  assert.equal(heartbeatNeedsKick(WATCHDOG_STALE_SECONDS), false);
});

test("watchdog recupera heartbeat vencido ou ausente", () => {
  assert.equal(heartbeatNeedsKick(WATCHDOG_STALE_SECONDS + 1), true);
  assert.equal(heartbeatNeedsKick(Infinity), true);
  assert.equal(heartbeatNeedsKick(undefined), true);
});
