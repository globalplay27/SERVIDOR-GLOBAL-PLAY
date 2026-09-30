import test from "node:test";
import assert from "node:assert/strict";
import { compareDueJobs } from "../src/executor.js";
import { queueTimestamp } from "../src/scheduler.js";

test("ciclo antigo vence publisher mais novo e não fica faminto", () => {
  const jobs = [
    { id:"publisher-new", kind:"publisher-sweep", due_at:"2026-09-30T01:10:00Z" },
    { id:"cycle-old", kind:"agent-core-cycle", due_at:"2026-09-30T01:00:00Z" }
  ].sort(compareDueJobs);
  assert.equal(jobs[0].id, "cycle-old");
});

test("publisher só ganha como desempate quando due_at é igual", () => {
  const due = "2026-09-30T01:00:00Z";
  const jobs = [
    { id:"cycle", kind:"agent-core-cycle", due_at:due },
    { id:"publisher", kind:"publisher-sweep", due_at:due },
    { id:"hunter", kind:"lead-hunter", due_at:due }
  ].sort(compareDueJobs);
  assert.deepEqual(jobs.map(job=>job.id), ["publisher","cycle","hunter"]);
});

test("enqueue recusado não renova artificialmente o relógio", () => {
  const previous = "2026-09-30T00:30:00.000Z";
  const now = new Date("2026-09-30T01:00:00.000Z");
  assert.equal(queueTimestamp(previous, now, false), previous);
  assert.equal(queueTimestamp(previous, now, true), now.toISOString());
});
