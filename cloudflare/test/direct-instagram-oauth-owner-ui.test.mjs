import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const master = fs.readFileSync(new URL("../src/master.js", import.meta.url), "utf8");
const instagram = fs.readFileSync(new URL("../src/instagram.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");

test("Master Instagram authorization uses a direct redirect route", () => {
  assert.match(master, /\/api\/master\/instagram\/authorize/);
  assert.match(master, /return redirect\(result\.url\)/);
  assert.match(html, /href="\/api\/master\/instagram\/authorize\?clientId=globalplay-streaming"/);
  assert.match(html, /href="\/api\/master\/instagram\/authorize\?clientId=ragnar-one"/);
});

test("OAuth callback can return directly to Master integrations", () => {
  assert.match(instagram, /returnTo/);
  assert.match(instagram, /oauth=success/);
  assert.match(app, /requestedView === "settings"/);
});

test("Global Play owner account is hidden from customer lists", () => {
  assert.match(app, /state\.clients\.filter\(client => !client\.ownerAccount\)/);
  assert.match(html, /Global Play é a conta principal do NEXUS e não aparece mais como cliente/);
});

test("Manual popup OAuth handler is no longer required", () => {
  assert.doesNotMatch(app, /window\.open\(result\.url/);
});
