import test from "node:test";
import assert from "node:assert/strict";
import {dueMetricCheckpoints,featureSignature} from "../src/post-learning.js";

test("metrics mature at 2h, 24h and 72h exactly once",()=>{
  const published="2026-09-29T10:00:00Z";
  assert.deepEqual(dueMetricCheckpoints(published,[],"2026-09-29T11:59:59Z"),[]);
  assert.deepEqual(dueMetricCheckpoints(published,[],"2026-09-29T12:00:00Z"),[2]);
  assert.deepEqual(dueMetricCheckpoints(published,[2],"2026-09-30T10:00:00Z"),[24]);
  assert.deepEqual(dueMetricCheckpoints(published,[2,24],"2026-10-02T10:00:00Z"),[72]);
  assert.deepEqual(dueMetricCheckpoints(published,[2,24,72],"2026-10-03T10:00:00Z"),[]);
});

test("scene signature ignores URL and identifies composition repetition",()=>{
  const a=featureSignature({scene:"cabana",composition:"plano aberto",characters:"casal",action:"vendo TV"});
  const b=featureSignature({scene:"cabana",composition:"plano aberto",characters:"casal",action:"vendo TV",imageUrl:"https://new"});
  assert.equal(a,b);
});
