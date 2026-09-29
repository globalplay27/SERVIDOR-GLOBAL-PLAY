import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const master = fs.readFileSync(new URL("../src/master.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");

test("Master exposes safe per-account Instagram connection status", () => {
  assert.match(master, /\/api\/master\/instagram\/accounts-status/);
  assert.match(master, /instagramCredentialStatus\(env, "globalplay-streaming"\)/);
  assert.match(master, /instagramCredentialStatus\(env, "ragnar-one"\)/);
});

test("Master hides authorize link when Instagram account is valid", () => {
  assert.match(app, /account\.tokenValid&&account\.accountMatches/);
  assert.match(app, /linkEl\.hidden=valid/);
  assert.match(html, /data-instagram-account-link="ragnar-one"/);
  assert.match(html, /data-instagram-account-badge="globalplay-streaming"/);
});
