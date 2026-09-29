import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

test("Worker routes Instagram OAuth callback before protected Master and generic API handlers", () => {
  assert.match(index, /handleInstagramOAuthCallback/);
  const callback = index.indexOf("handleInstagramOAuthCallback(env, request, url)");
  const master = index.indexOf("handleMaster(request, env, url)");
  const generic = index.indexOf('if (url.pathname.startsWith("/api/"))');
  assert.ok(callback >= 0);
  assert.ok(master > callback);
  assert.ok(generic > callback);
});
