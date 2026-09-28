import test from "node:test";
import assert from "node:assert/strict";
import { leadHunterConfig } from "../src/lead-hunter.js";

function envWithStoredConfig(config) {
  return {
    DB: {
      prepare() {
        return { bind() { return { async first() {
          return config === null ? null : { value_json: JSON.stringify(config) };
        } }; } };
      }
    }
  };
}

test("existing autonomous accounts scan comments hourly by default", async () => {
  for (const id of ["globalplay-streaming", "ragnar-one"]) {
    const config = await leadHunterConfig(envWithStoredConfig(null), { id, niche: "streaming" });
    assert.equal(config.autoRun, true);
    assert.equal(config.scanIntervalMinutes, 60);
    assert.equal(config.metaComments, true);
  }
  assert.equal((await leadHunterConfig(envWithStoredConfig(null), { id: "new-client" })).autoRun, false);
});

test("explicit client opt-out remains effective", async () => {
  const config = await leadHunterConfig(envWithStoredConfig({ autoRun: false }), { id: "ragnar-one" });
  assert.equal(config.autoRun, false);
});
