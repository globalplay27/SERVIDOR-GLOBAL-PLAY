import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const master = fs.readFileSync(new URL("../src/master.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");

test("Master shell requires an authenticated Master session", () => {
  const start = master.indexOf('url.pathname === "/master"');
  const block = master.slice(start, start + 700);
  assert.match(block, /requireMaster\(request, env\)/);
  assert.match(block, /redirect\("\/api\/master\/access"\)/);
  assert.doesNotMatch(block, /Temporary diagnostic bypass/);
});

test("Master API 401 redirects to real access page instead of looping to shell", () => {
  const start = app.indexOf("if (response.status === 401)");
  const block = app.slice(start, start + 250);
  assert.match(block, /location\.href = "\/api\/master\/access"/);
  assert.doesNotMatch(block, /location\.href = "\/master"/);
});
