import test from "node:test";
import assert from "node:assert/strict";
import { runCronIteration } from "../src/cron-runtime.js";
import { schedulerErrorCode } from "../src/scheduler.js";

test("executor continua mesmo quando o planejamento do scheduler falha", async () => {
  const calls = [];
  const result = await runCronIteration({
    at: new Date("2026-09-30T11:00:00Z"),
    runScheduler: async () => {
      calls.push("scheduler");
      throw new Error("D1_ERROR: query failed");
    },
    recordFailure: async (_at, error) => {
      calls.push("failure");
      return schedulerErrorCode(error);
    },
    processJobs: async () => {
      calls.push("jobs");
      return { processed: 1 };
    }
  });

  assert.deepEqual(calls, ["scheduler", "failure", "jobs"]);
  assert.equal(result.schedulerErrorCode, "d1_query_error");
  assert.equal(result.jobs.processed, 1);
});

test("scheduler error codes are sanitized into stable categories", () => {
  assert.equal(schedulerErrorCode(new Error("no such column: foo")), "d1_schema_error");
  assert.equal(schedulerErrorCode(new Error("request timed out")), "scheduler_timeout");
  assert.equal(schedulerErrorCode(new Error("Too many subrequests")), "scheduler_resource_limit");
  assert.equal(schedulerErrorCode(new Error("unexpected failure with secret-looking text")), "scheduler_tick_error");
});
