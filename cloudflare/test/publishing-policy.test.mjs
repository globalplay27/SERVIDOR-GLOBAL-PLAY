import test from "node:test";
import assert from "node:assert/strict";
import {isPublishingWindow,publishingGate,sameSaoPauloDay,shouldExpireDraft} from "../src/publishing-policy.js";

test("publishing window is 08:00 through 22:00 Sao Paulo",()=>{
  assert.equal(isPublishingWindow("2026-09-29T10:59:00Z"),false);
  assert.equal(isPublishingWindow("2026-09-29T11:00:00Z"),true);
  assert.equal(isPublishingWindow("2026-09-30T01:00:00Z"),true);
  assert.equal(isPublishingWindow("2026-09-30T01:01:00Z"),false);
});

test("publisher gate has no fixed daily cap and enforces ninety minute spacing",()=>{
  assert.equal(publishingGate({now:"2026-09-29T15:00:00Z",publishedToday:20,lastPublishedAt:"2026-09-29T12:00:00Z"}).ok,true);
  assert.equal(publishingGate({now:"2026-09-29T15:00:00Z",publishedToday:1,lastPublishedAt:"2026-09-29T14:00:01Z"}).reason,"minimum_spacing_not_reached");
  assert.equal(publishingGate({now:"2026-09-29T15:30:00Z",publishedToday:1,lastPublishedAt:"2026-09-29T14:00:00Z"}).ok,true);
});

test("Sao Paulo local day prevents pulling tomorrow into today",()=>{
  assert.equal(sameSaoPauloDay("2026-09-30T01:30:00Z","2026-09-29T22:30:00Z"),true);
  assert.equal(sameSaoPauloDay("2026-09-30T03:30:00Z","2026-09-29T22:30:00Z"),false);
});

test("due drafts older than 24h expire but future drafts do not",()=>{
  const now="2026-09-30T15:00:00Z";
  assert.equal(shouldExpireDraft({status:"ready",created_at:"2026-09-29T14:59:00Z",scheduled_for:"2026-09-29T18:00:00Z"},now),true);
  assert.equal(shouldExpireDraft({status:"ready",created_at:"2026-09-29T14:00:00Z",scheduled_for:"2026-10-01T15:00:00Z"},now),false);
  assert.equal(shouldExpireDraft({status:"published",created_at:"2026-09-28T10:00:00Z",scheduled_for:"2026-09-28T12:00:00Z"},now),false);
});
