import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");

test("Master exposes only a password field for the NEXUS Instagram App Secret", () => {
  assert.match(html, /id="instagram-secret-form"/);
  assert.match(html, /name="appSecret" type="password"/);
  assert.match(html, /id="instagram-current-app-id" readonly/);
  assert.doesNotMatch(html, /data-instagram-token-form/);
});

test("Master saves the NEXUS App Secret through the protected Instagram settings endpoint", () => {
  assert.match(app, /instagramSecretForm/);
  assert.match(app, /body:JSON\.stringify\(\{appSecret\}\)/);
  assert.match(app, /App Secret do NEXUS salvo com segurança/);
});
