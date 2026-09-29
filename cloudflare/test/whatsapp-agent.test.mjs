import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/whatsapp-agent.js", import.meta.url), "utf8");

test("WhatsApp agent keeps human confirmation and hourly send guard", () => {
  assert.match(source, /human_confirmation_required/);
  assert.match(source, /WHATSAPP_SEND_LIMIT_PER_HOUR/);
  assert.match(source, /whatsapp_send_log/);
});

test("WhatsApp webhook verifies Meta signature before processing", () => {
  assert.match(source, /x-hub-signature-256/);
  assert.match(source, /WHATSAPP_APP_SECRET/);
  assert.match(source, /invalid_webhook_signature/);
});

test("WhatsApp agent never auto-sends AI drafts", () => {
  assert.match(source, /status='pending'/);
  assert.match(source, /Nunca envie nada: apenas produza rascunho/);
  assert.doesNotMatch(source, /buildDraft\([\s\S]{0,400}sendText\(/);
});
