import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const runtime = fs.readFileSync(new URL("../src/agent-runtime.js", import.meta.url), "utf8");
const scheduler = fs.readFileSync(new URL("../src/scheduler.js", import.meta.url), "utf8");
const extended = fs.readFileSync(new URL("../src/extended-agents.js", import.meta.url), "utf8");
const ai = fs.readFileSync(new URL("../src/ai-growth.js", import.meta.url), "utf8");

test("RADAR consults OpenAI and shares one cached growth brain", () => {
  assert.match(runtime, /consultGrowthAI\(env,client/);
  assert.match(runtime, /patchAgentCoreState\(env,client\.id,\{radar:output,aiGrowth\}\)/);
  assert.match(ai, /CACHE_MS = 90 \* 60 \* 1000/);
  assert.match(ai, /gpt-5\.6-luna/);
});

test("Strategist and Creator consume AI strategy and creative batch", () => {
  assert.match(runtime, /aiCreativeBatch:aiBatch/);
  assert.match(runtime, /const aiCreative=aiBatch\[index\]\|\|null/);
  assert.match(runtime, /strategySource:aiCreative\?"openai-growth-brain":"fallback-rules"/);
  assert.match(runtime, /aiCreativeVersion/);
});

test("Researcher Analyst Growth and Copy Chief use the shared AI feedback", () => {
  assert.match(extended, /state\?\.aiGrowth\?\.researchOpportunities/);
  assert.match(extended, /aiStrategyChanges/);
  assert.match(extended, /openai-growth-intelligence/);
  assert.match(extended, /genericFiller/);
});

test("Global Play cartoon campaign ends on October 12 and generic filler is gone", () => {
  assert.match(runtime, /endInclusive:"2026-10-12"/);
  assert.doesNotMatch(runtime, /Descoberta, entretenimento, utilidade e motivo claro para seguir o perfil/);
});

test("scheduler refreshes stale AI intelligence", () => {
  assert.match(scheduler, /\.aiGrowth\.generatedAt/);
  assert.match(scheduler, /90 \* 60 \* 1000/);
  assert.match(scheduler, /aiRefreshDue = true/);
});
