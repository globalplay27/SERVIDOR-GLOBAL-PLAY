import test from "node:test";
import assert from "node:assert/strict";
import {commercialContentPolicy,commercialCopyAllowed,commercialPromptGuard,hasResellerOffer} from "../src/content-policy.js";

test("Global Play and Ragnar are end-customer only",()=>{
  for(const id of ["globalplay-streaming","ragnar-one"]){
    const p=commercialContentPolicy(id);
    assert.equal(p.audience,"cliente-final");
    assert.equal(p.resellerOffersAllowed,false);
    assert.match(commercialPromptGuard(id),/sell only to end customers/i);
    assert.match(commercialPromptGuard(id),/never borrow or infer pricing/i);
  }
});

test("reseller offers are blocked for commercial accounts",()=>{
  for(const text of ["Plano ADM 599","ULTRA 199","MASTER 44,90","revenda com 10 créditos"]){
    assert.equal(hasResellerOffer(text),true);
    assert.equal(commercialCopyAllowed("globalplay-streaming",text),false);
    assert.equal(commercialCopyAllowed("ragnar-one",text),false);
  }
  assert.equal(commercialCopyAllowed("globalplay-streaming",'Comente "QUERO" para saber mais.'),true);
});
