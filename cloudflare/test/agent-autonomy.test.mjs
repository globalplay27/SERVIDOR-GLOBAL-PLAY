import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_CORE_MODULES, normalizeAgentCoreConfig } from "../src/agent-core.js";

test("all 13 Nexus agents are registered, including VIDEO and ODIN", () => {
  const ids = AGENT_CORE_MODULES.map(item => item.id);
  assert.equal(ids.length, 13);
  assert.deepEqual(ids, [
    "radar",
    "estrategista",
    "pesquisador",
    "analista",
    "creator",
    "copy-chief",
    "designer",
    "video",
    "publisher",
    "odin",
    "suporte",
    "auditor",
    "growth"
  ]);
});

test("all autonomous modules default to enabled for Nexus clients", () => {
  const cfg = normalizeAgentCoreConfig({
    id: "globalplay-streaming",
    config: {}
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.autoPublish, true);
  for (const agent of AGENT_CORE_MODULES) {
    assert.equal(cfg.modules[agent.id], true, agent.id + " should default enabled");
  }
});
