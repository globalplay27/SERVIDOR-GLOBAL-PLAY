import test from "node:test";
import assert from "node:assert/strict";
import { localQualification } from "../src/lead-hunter.js";

const config={
  minScore:25,
  intentTerms:["quero","preço","preco","valor","assinar","comprar","teste","como funciona","link"],
  nicheTerms:["streaming"]
};

test("QUERO is classified hot without needing AI",()=>{
  const out=localQualification({message:"QUERO saber como assinar",source:"meta-comment"},config);
  assert.equal(out.temperature,"hot");
  assert.equal(out.intent,"QUERO");
  assert.equal(out.needsHuman,true);
});

test("price intent is at least warm and prioritized",()=>{
  const out=localQualification({message:"qual o preço do plano?",source:"meta-comment"},config);
  assert.ok(["warm","hot"].includes(out.temperature));
  assert.equal(out.intent,"compra/preço");
  assert.equal(out.needsHuman,true);
});

test("generic reaction stays cold",()=>{
  const out=localQualification({message:"legal",source:"meta-comment"},config);
  assert.equal(out.temperature,"cold");
  assert.equal(out.needsHuman,false);
});
