import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { shouldRefreshGrowthAI } from "../src/ai-growth.js";

const runtime = fs.readFileSync(new URL("../src/agent-runtime.js", import.meta.url), "utf8");
const extended = fs.readFileSync(new URL("../src/extended-agents.js", import.meta.url), "utf8");

test("OpenAI growth brain refreshes once per Sao Paulo day unless an event invalidates it",()=>{
  const previous={version:"openai-growth-brain-v1",dayKey:"2026-09-29"};
  assert.equal(shouldRefreshGrowthAI(previous,"","2026-09-29T15:00:00Z"),false);
  assert.equal(shouldRefreshGrowthAI(previous,"new_hot_lead","2026-09-29T15:00:00Z"),true);
  assert.equal(shouldRefreshGrowthAI(previous,"","2026-09-30T15:00:00Z"),true);
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
