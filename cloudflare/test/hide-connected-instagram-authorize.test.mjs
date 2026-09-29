import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");

test("Connected Instagram account hides authorize action", () => {
  assert.match(app, /linkEl\.style\.display=valid\?"none":"inline-flex"/);
  assert.match(css, /\.link-button\[hidden\]\{display:none!important\}/);
});
