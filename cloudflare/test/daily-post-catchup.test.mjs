import test from "node:test";
import assert from "node:assert/strict";
import { isPublishingWindow, publishingGate, sameSaoPauloDay } from "../src/publishing-policy.js";

test("catch-up is allowed only in useful Sao Paulo hours",()=>{
  assert.equal(isPublishingWindow("2026-09-29T10:59:00Z"),false);
  assert.equal(isPublishingWindow("2026-09-29T11:00:00Z"),true);
  assert.equal(isPublishingWindow("2026-09-30T01:00:00Z"),true);
  assert.equal(isPublishingWindow("2026-09-30T01:05:00Z"),false);
});

test("catch-up cannot publish a burst but has no fixed daily cap",()=>{
  assert.equal(publishingGate({now:"2026-09-29T15:00:00Z",publishedToday:12,lastPublishedAt:"2026-09-29T12:00:00Z"}).ok,true);
  assert.equal(publishingGate({now:"2026-09-29T15:00:00Z",publishedToday:1,lastPublishedAt:"2026-09-29T14:15:00Z"}).reason,"minimum_spacing_not_reached");
  assert.equal(publishingGate({now:"2026-09-29T15:45:00Z",publishedToday:1,lastPublishedAt:"2026-09-29T14:15:00Z"}).ok,true);
});

test("future content from tomorrow is never a same-day catch-up candidate",()=>{
  assert.equal(sameSaoPauloDay("2026-09-29T20:00:00Z","2026-09-30T03:10:00Z"),false);
});
