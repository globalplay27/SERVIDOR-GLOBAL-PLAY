import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  masterCredentialsValid,
  createMasterSession,
  resolveMasterSession
} from "../src/auth.js";

function unavailableD1() {
  let prepareCalls = 0;
  return {
    get prepareCalls() { return prepareCalls; },
    DB: {
      prepare() {
        prepareCalls += 1;
        throw new Error("D1_ERROR: free tier daily row read limit exceeded");
      }
    }
  };
}

test("Master environment credentials authenticate without touching D1", async () => {
  const d1 = unavailableD1();
  const env = {
    DB: d1.DB,
    NEXUS_SECRET_KEY: "test-secret-that-stays-server-side",
    NEXUS_ADMIN_USERNAME: "admin",
    NEXUS_ADMIN_PASSWORD: "correct-password"
  };

  assert.equal(await masterCredentialsValid(env, "admin", "correct-password"), true);
  assert.equal(d1.prepareCalls, 0);
});

test("Master stateless session opens the shell while D1 is unavailable", async () => {
  const d1 = unavailableD1();
  const env = {
    DB: d1.DB,
    NEXUS_SECRET_KEY: "test-secret-that-stays-server-side"
  };

  const session = await createMasterSession(env);
  assert.match(session.token, /^ms1\./);
  assert.equal(session.stateless, true);
  assert.equal(d1.prepareCalls, 0);

  const request = new Request("https://nexus.example/api/master/console", {
    headers: { cookie: "nexus_master=" + encodeURIComponent(session.token) }
  });
  const resolved = await resolveMasterSession(env, request);
  assert.equal(resolved?.stateless, true);
  assert.equal(resolved?.token, session.token);
  assert.equal(d1.prepareCalls, 0);
});

test("Master access GET is routed before Instagram and D1-dependent handlers", async () => {
  const index = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  const access = index.indexOf('url.pathname === "/api/master/access"');
  const oauth = index.indexOf("handleInstagramOAuthCallback(env, request, url)");
  const master = index.indexOf("handleMaster(request, env, url)");
  assert.ok(access >= 0);
  assert.ok(oauth > access);
  assert.ok(master > access);
  assert.match(index.slice(access, access + 650), /masterLoginPage\(false, "\/api\/master\/access"\)/);
});
