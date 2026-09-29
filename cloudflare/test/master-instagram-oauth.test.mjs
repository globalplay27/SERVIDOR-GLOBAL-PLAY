import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const master = fs.readFileSync(new URL("../src/master.js", import.meta.url), "utf8");
const instagram = fs.readFileSync(new URL("../src/instagram.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");

test("Master can start Instagram OAuth for a selected client", () => {
  assert.match(master, /\/api\/master\/instagram\/oauth-start/);
  assert.match(master, /startInstagramOAuth\(env, request, clientId\)/);
});

test("OAuth callback rejects authorization for the wrong Instagram username", () => {
  assert.match(instagram, /oauth_account_mismatch/);
  assert.match(instagram, /expectedUsername/);
});

test("Master OAuth uses direct redirect instead of popup or manual token copy", () => {
  assert.doesNotMatch(app, /window\.open\(result\.url/);
  assert.doesNotMatch(app, /data-instagram-token-form/);
  assert.match(master, /\/api\/master\/instagram\/authorize/);
});
