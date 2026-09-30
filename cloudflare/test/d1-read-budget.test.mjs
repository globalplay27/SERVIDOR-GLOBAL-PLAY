import test from "node:test";
import assert from "node:assert/strict";
import { agentCoreDashboard } from "../src/agent-core.js";

function fakeEnv() {
  const queries = [];
  const clientRows = [
    { id:"globalplay-streaming", name:"Global Play", niche:"Streaming", instagram:"@globalplay_streaming", status:"online", config_json:"{}", created_at:"2026-09-01", updated_at:"2026-09-30" },
    { id:"ragnar-one", name:"Ragnar One", niche:"Streaming", instagram:"@ragnarplay1", status:"online", config_json:"{}", created_at:"2026-09-01", updated_at:"2026-09-30" }
  ];
  const today = "2026-09-30T10:00:00.000Z";

  const DB = {
    prepare(sql) {
      const entry = { sql:String(sql), args:[] };
      queries.push(entry);
      return {
        bind(...args) { entry.args = args; return this; },
        async first() {
          if (entry.sql.includes("FROM nexus_state")) {
            return { value_json:JSON.stringify({ lastCycleStatus:"success", modules:{} }), updated_at:today };
          }
          return null;
        },
        async all() {
          if (entry.sql.includes("FROM clients")) return { results:clientRows };
          if (entry.sql.includes("FROM agent_executions")) {
            const clientId = String(entry.args[0] || "");
            return {
              results:Array.from({length:120}, (_, index) => ({
                id:clientId + "-" + index,
                client_id:clientId,
                agent:"RADAR",
                status:"success",
                detail_json:JSON.stringify({ costUsd:0.01, finishedAt:today }),
                created_at:today
              }))
            };
          }
          return { results:[] };
        }
      };
    }
  };
  return { env:{ DB }, queries };
}

test("Agent Core dashboard reads recent executions only through client-scoped queries", async () => {
  const { env, queries } = fakeEnv();
  const result = await agentCoreDashboard(env);

  assert.equal(result.clients.length, 2);
  assert.equal(result.totalExecutionsToday, 240);
  assert.equal(result.statsWindowLimited, true);

  const executionQueries = queries.filter(item => item.sql.includes("FROM agent_executions"));
  assert.equal(executionQueries.length, 2);
  assert.ok(executionQueries.every(item => item.sql.includes("WHERE client_id = ?1")));
  assert.ok(executionQueries.every(item => item.sql.includes("LIMIT ?2")));
  assert.ok(!queries.some(item => /LIMIT\s+5000/i.test(item.sql)));
});
