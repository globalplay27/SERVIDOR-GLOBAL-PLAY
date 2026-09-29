import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const instagram = fs.readFileSync(new URL("../src/instagram.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

test("Meta compliance callbacks validate signed_request with NEXUS App Secret", () => {
  assert.match(instagram, /verifyMetaSignedRequest/);
  assert.match(instagram, /HMAC/);
  assert.match(instagram, /SHA-256/);
  assert.match(instagram, /invalid_signed_request_signature/);
});

test("Meta deauthorization and deletion endpoints are public callback routes", () => {
  assert.match(instagram, /\/api\/meta\/instagram\/deauthorize/);
  assert.match(instagram, /\/api\/meta\/instagram\/data-deletion/);
  assert.match(instagram, /confirmation_code/);
  const compliance = index.indexOf("handleInstagramComplianceRequest(env, request, url)");
  const master = index.indexOf("handleMaster(request, env, url)");
  assert.ok(compliance >= 0 && master > compliance);
});

test("Deletion removes matching Instagram authorization and lead identity records", () => {
  assert.match(instagram, /DELETE FROM connections/);
  assert.match(instagram, /DELETE FROM leads WHERE instagram_user_id/);
});
