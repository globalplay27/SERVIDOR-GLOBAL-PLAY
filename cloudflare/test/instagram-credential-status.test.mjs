import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const cred = fs.readFileSync(new URL("../src/instagram-credentials.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

test("Instagram auth diagnostics never expose access tokens", () => {
  assert.match(cred, /instagramCredentialStatus/);
  assert.match(cred, /tokenValid/);
  assert.match(cred, /accountMatches/);
  const start = index.indexOf("instagramConnection:");
  assert.ok(start >= 0);
  const block = index.slice(start, start + 800);
  assert.doesNotMatch(block, /accessToken/);
});

test("Instagram auth diagnostics validate token against graph.instagram.com", () => {
  assert.match(cred, /https:\/\/graph\.instagram\.com\/me/);
});
