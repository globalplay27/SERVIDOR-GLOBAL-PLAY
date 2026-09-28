import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const runtime = fs.readFileSync(new URL("../src/agent-runtime.js", import.meta.url), "utf8");

test("Instagram insights are part of autonomous feedback", () => {
  for (const metric of ["reach","views","saved","shares","total_interactions"]) {
    assert.match(runtime, new RegExp(metric.replace("_","\\_")));
  }
  assert.match(runtime, /instagramMediaInsights/);
});

test("Ragnar excludes recycled Instagram media while other accounts retain R2 replenishment", () => {
  assert.match(runtime, /if\(client\.id==="ragnar-one"\)return \{url:"",source:"awaiting-new-original-media"/);
  assert.match(runtime, /recycled_instagram_media_blocked/);
  assert.match(runtime, /own-instagram-r2-replenishment/);
  assert.match(runtime, /stageOwnInstagramImage/);
  assert.match(runtime, /sourceInstagramMediaId/);
});
