import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const instagram = fs.readFileSync(new URL("../src/instagram.js", import.meta.url), "utf8");

test("NEXUS-saved Instagram credentials take precedence over stale Worker values", () => {
  assert.match(instagram, /record\.appId \|\| env\.INSTAGRAM_APP_ID/);
  assert.match(instagram, /storedSecret \|\| envSecret/);
  assert.match(instagram, /appSecretSource: storedSecret \? "nexus-d1"/);
});
