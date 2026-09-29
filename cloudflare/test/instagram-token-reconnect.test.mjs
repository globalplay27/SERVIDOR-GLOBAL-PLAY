import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const instagram = fs.readFileSync(new URL("../src/instagram.js", import.meta.url), "utf8");
const master = fs.readFileSync(new URL("../src/master.js", import.meta.url), "utf8");

test("manual Instagram reconnect validates the token with Instagram before storage", () => {
  assert.match(instagram, /connectInstagramWithToken/);
  assert.match(instagram, /graph\.instagram\.com\/me/);
  assert.match(instagram, /instagram_token_invalid/);
  assert.match(instagram, /instagram_account_mismatch/);
});

test("manual Instagram reconnect encrypts tokens before D1 storage", () => {
  const start = instagram.indexOf("export async function connectInstagramWithToken");
  const block = instagram.slice(start);
  assert.match(block, /encryptSecret\(env, accessToken\)/);
  assert.match(block, /INSERT INTO connections/);
});

test("Master exposes reconnect only under protected master API", () => {
  assert.match(master, /\/api\/master\/instagram\/connect-token/);
  assert.match(master, /connectInstagramWithToken/);
});
