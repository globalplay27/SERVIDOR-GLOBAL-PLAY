import test from "node:test";
import assert from "node:assert/strict";
import { autonomyOverallHealthy, clientAutonomyHealthy } from "../src/health-policy.js";

test("heartbeat saudável não mascara ciclo atrasado", () => {
  const client = {
    allAgentsSeen: true,
    cycleHealth: { delayed: true }
  };
  assert.equal(clientAutonomyHealthy(client), false);
  assert.equal(autonomyOverallHealthy({
    schedulerHealthy: true,
    clients: [client]
  }), false);
});

test("health exige pelo menos um cliente e agentes observados", () => {
  assert.equal(autonomyOverallHealthy({ schedulerHealthy: true, clients: [] }), false);
  assert.equal(autonomyOverallHealthy({
    schedulerHealthy: true,
    clients: [{ allAgentsSeen: false, cycleHealth: { delayed: false } }]
  }), false);
});

test("health fica saudável quando heartbeat, agentes e ciclo estão normais", () => {
  assert.equal(autonomyOverallHealthy({
    schedulerHealthy: true,
    clients: [
      { allAgentsSeen: true, cycleHealth: { delayed: false } },
      { allAgentsSeen: true, cycleHealth: { delayed: false } }
    ]
  }), true);
});
