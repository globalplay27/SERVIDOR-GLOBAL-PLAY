import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {buildVisualPrompt} from "../src/media-generation.js";

const runtime = fs.readFileSync(new URL("../src/agent-runtime.js", import.meta.url), "utf8");

test("Instagram insights remain part of autonomous feedback", () => {
  for (const metric of ["reach","views","saved","shares","total_interactions"]) {
    assert.match(runtime, new RegExp(metric.replace("_","\\_")));
  }
});

test("protected accounts request genuinely new generated media",()=>{
  assert.match(buildVisualPrompt({id:"globalplay-streaming"}),/original family-friendly 3D animated\/cartoon/i);
  assert.match(buildVisualPrompt({id:"ragnar-one"}),/ORIGINAL premium Nordic cinematic/i);
  assert.match(runtime,/openai-original-media/);
  assert.match(runtime,/media_generation_required/);
});

test("duplicate media invalidates the Designer gate before regeneration",()=>{
  assert.match(runtime,/payload\.visualReview=null/);
  assert.match(runtime,/designer:"pending"/);
  assert.match(runtime,/mediaGeneration=.*status:"requested"/s);
});
