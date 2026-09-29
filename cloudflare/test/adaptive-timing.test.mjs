import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const runtime = fs.readFileSync(new URL("../src/agent-runtime.js", import.meta.url), "utf8");
const master = fs.readFileSync(new URL("../src/master.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");

test("posting times are adaptive and performance driven", () => {
  assert.match(runtime, /historical engagement decides/);
  assert.match(runtime, /const ranked=\[\.\.\.scores\.entries\(\)\]/);
  assert.match(runtime, /recommendedPostTimes:postTimes/);
  assert.match(runtime, /adaptiveTiming:true/);
});

test("master and UI do not expose legacy fixed posting slots", () => {
  assert.match(master, /postTimes: \[\]/);
  assert.match(master, /adaptiveTiming: true/);
  assert.doesNotMatch(app, /data-master-time=/);
  assert.match(app, /Automático pelo NEXUS/);
  assert.match(app, /Horários adaptativos/);
});
