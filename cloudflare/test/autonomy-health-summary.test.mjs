import test from "node:test";
import assert from "node:assert/strict";
import { buildAutonomyHealthSummary, EXPECTED_AUTONOMY_AGENTS } from "../src/autonomy-health-summary.js";

function stateWithAgents(status = "success") {
  const modules = {};
  for (const agent of EXPECTED_AUTONOMY_AGENTS) {
    modules[agent.toLowerCase()] = {
      status: "success",
      lastExecutionAt: "2026-09-30T11:00:00.000Z"
    };
  }
  return JSON.stringify({
    modules,
    lastCycleStatus: status,
    lastCycleStage: status === "success" ? "completed" : "creator",
    nextCycleAt: "2026-09-30T12:00:00.000Z"
  });
}

function fakeEnv() {
  const queries = [];
  const env = {
    CLOUDFLARE_AUTOMATION_ACTIVE: "true",
    DB: {
      prepare(sql) {
        queries.push(sql);
        if (sql.includes("item_key='heartbeat'")) {
          return { async first() {
            return {
              value_json: JSON.stringify({ runtime:"cloudflare-cron", at:"2026-09-30T11:00:00.000Z", clients:2 }),
              updated_at: "2026-09-30T11:00:00.000Z"
            };
          }};
        }
        if (sql.includes("FROM clients")) {
          return { async all() {
            return { results:[
              { id:"globalplay-streaming", status:"online" },
              { id:"ragnar-one", status:"online" }
            ] };
          }};
        }
        if (sql.includes("item_key='state'")) {
          return { async all() {
            return { results:[
              { client_id:"globalplay-streaming", value_json:stateWithAgents(), updated_at:"2026-09-30T11:00:00Z" },
              { client_id:"ragnar-one", value_json:stateWithAgents(), updated_at:"2026-09-30T11:00:00Z" }
            ] };
          }};
        }
        throw new Error("unexpected_query");
      }
    }
  };
  return { env, queries };
}

test("public autonomy summary performs only three small D1 queries", async () => {
  const { env, queries } = fakeEnv();
  const result = await buildAutonomyHealthSummary(env, Date.parse("2026-09-30T11:00:30Z"));
  assert.equal(queries.length, 3);
  assert.equal(result.ok, true);
  assert.equal(result.scheduler.healthy, true);
  assert.equal(result.clients.length, 2);
  assert.equal(result.clients.every(client => client.allAgentsSeen), true);
  assert.equal(result.clients.every(client => client.instagramConnection.validation === "not_checked_public"), true);
});

test("failed cycle keeps lightweight health unhealthy without scanning execution history", async () => {
  const { env, queries } = fakeEnv();
  const originalPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const q = originalPrepare(sql);
    if (sql.includes("item_key='state'")) {
      return { async all() {
        return { results:[
          { client_id:"globalplay-streaming", value_json:stateWithAgents("failed") },
          { client_id:"ragnar-one", value_json:stateWithAgents() }
        ] };
      }};
    }
    return q;
  };
  const result = await buildAutonomyHealthSummary(env, Date.parse("2026-09-30T11:00:30Z"));
  assert.equal(result.ok, false);
  assert.equal(result.clients[0].cycleHealth.status, "failed");
  assert.equal(queries.length, 3);
});
