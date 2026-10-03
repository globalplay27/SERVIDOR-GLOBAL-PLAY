import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("client portal exposes minimal video, Instagram and logo navigation", async () => {
  const [html, js, portal, index, wrangler] = await Promise.all([
    readFile(new URL("../../public/portal.html", import.meta.url), "utf8"),
    readFile(new URL("../../public/client-lite.js", import.meta.url), "utf8"),
    readFile(new URL("../src/portal.js", import.meta.url), "utf8"),
    readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8")
  ]);

  assert.match(html, /data-tab="videos"/);
  assert.match(html, /data-tab="instagram"/);
  assert.match(html, /data-tab="logo"/);
  assert.doesNotMatch(html, /data-tab="overview"/);
  assert.doesNotMatch(html, /data-tab="posts"/);
  assert.doesNotMatch(html, /data-tab="agents"/);
  assert.doesNotMatch(html, /data-tab="campaigns"/);
  assert.doesNotMatch(html, /data-tab="performance"/);
  assert.equal((html.match(/id="logo-form"/g) || []).length, 1);
  assert.match(html, /id="media-upload-form"/);
  assert.match(html, /id="video-job-list"/);
  assert.match(js, /async function loadVideoJobs\(/);
  assert.match(js, /Gerar vídeo agora/);
  assert.match(js, /Baixar vídeo 9:16/);
  assert.match(js, /let pendingUploadMetadata = null/);
  assert.match(js, /const uploadMetadata = pendingUploadMetadata \|\| selectedCatalog/);
  assert.match(js, /NEXUS mantém o título, a sinopse e gera o 9:16/);
  assert.match(js, /MAX_VIDEO_UPLOAD_BYTES = 90 \* 1024 \* 1024/);
  assert.match(portal, /const maxBytes = 90 \* 1024 \* 1024/);
  assert.match(portal, /env\.MEDIA\.put\(key, file\.stream\(\)/);
  assert.match(index, /"\/portal", "\/portal\.html"/);
  assert.match(index, /no-store, no-cache, must-revalidate/);
  assert.match(wrangler, /"\/portal\*"/);
  assert.match(wrangler, /"\/client-lite\.js"/);
  assert.match(portal, /postDecisionMatch/);
  assert.match(portal, /postRevisionMatch/);
  assert.equal(portal.includes("/decision"), true);
  assert.equal(portal.includes("/revision"), true);
  assert.match(portal, /pendingApproval/);
  assert.match(portal, /correctionRequested/);
});
