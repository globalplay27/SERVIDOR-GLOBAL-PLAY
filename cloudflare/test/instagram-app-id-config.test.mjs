import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const wrangler = fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

test("Cloudflare deploy uses the NEXUS Instagram platform App ID", () => {
  assert.match(wrangler, /"INSTAGRAM_APP_ID"\s*:\s*"1053178344199625"/);
  assert.doesNotMatch(wrangler, /17841473822444936/);
});
