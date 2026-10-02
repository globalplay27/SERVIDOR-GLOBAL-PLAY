import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("client portal exposes agent activity and post review controls", async () => {
  const [html, js, portal] = await Promise.all([
    readFile(new URL("../../public/portal.html", import.meta.url), "utf8"),
    readFile(new URL("../../public/client-lite.js", import.meta.url), "utf8"),
    readFile(new URL("../src/portal.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /data-tab="agents"/);
  assert.match(html, /id="agent-list"/);
  assert.match(js, /Aprovar/);
  assert.match(js, /Reprovar/);
  assert.match(js, /Refazer/);
  assert.match(js, /Publicar agora/);
  assert.match(js, /\/api\/portal\/agent-core/);
  assert.match(js, /\/decision/);
  assert.match(js, /\/revision/);
  assert.match(js, /\/manual/);
  assert.match(js, /post-preview/);
  assert.equal((js.match(/async function loadAgents\(/g) || []).length, 1);
  assert.equal((js.match(/className = "post-preview"/g) || []).length, 1);
  assert.match(html, /data-tab="videos"/);
  assert.match(html, /id="video-job-list"/);
  assert.match(js, /target === "videos"\) return Promise\.all\(\[loadMedia\(\), loadVideoJobs\(\)\]\)/);
  assert.match(js, /async function loadVideoJobs\(/);
  assert.match(js, /Gerar MP4/);
  assert.match(js, /Baixar MP4/);
  assert.match(portal, /postDecisionMatch/);
  assert.match(portal, /postRevisionMatch/);
  assert.equal(portal.includes("/decision"), true);
  assert.equal(portal.includes("/revision"), true);
  assert.match(portal, /pendingApproval/);
  assert.match(portal, /correctionRequested/);
});
