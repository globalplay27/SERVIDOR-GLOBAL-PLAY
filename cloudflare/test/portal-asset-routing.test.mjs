import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const assetSource = source.slice(source.indexOf("async function asset("), source.indexOf("async function mediaResponse("));
const context = vm.createContext({ URL, Request, Response, Headers });
vm.runInContext(assetSource, context);

for (const method of ["GET", "HEAD"]) {
  for (const path of ["/portal", "/portal.html", "/login"]) {
    test(`${method} ${path} serves the client shell without a redirect loop`, async () => {
      const env = { ASSETS: { async fetch(request) {
        const url = new URL(request.url);
        assert.equal(url.search, "");
        assert.equal(request.method, method);
        // Reproduce Cloudflare's default HTML canonicalization.
        if (url.pathname === "/portal.html") return Response.redirect("https://nexus.test/portal", 307);
        assert.equal(url.pathname, "/portal");
        return new Response(method === "HEAD" ? null : '<button data-tab="videos">Vídeos</button>', {
          headers: { "content-type": "text/html" }
        });
      } } };
      const response = await context.asset(env, new Request(`https://nexus.test${path}?auth=1`, { method }), "/portal.html");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("location"), null);
      assert.match(response.headers.get("cache-control"), /no-store/);
      if (method === "GET") assert.match(await response.text(), /data-tab="videos"/);
      else assert.equal(await response.text(), "");
    });
  }
}
