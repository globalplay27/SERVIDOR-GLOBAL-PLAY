import test from "node:test";
import assert from "node:assert/strict";
import {buildVisualPrompt,generateOriginalMedia,overlayCopy} from "../src/media-generation.js";

test("Global Play prompt requires original family cartoon and excludes protected styles",()=>{
  const p=buildVisualPrompt({id:"globalplay-streaming"},"família escolhendo o que assistir","a");
  assert.match(p,/ORIGINAL family-friendly 3D animated\/cartoon/);
  assert.match(p,/Do not imitate Disney, Pixar/);
  assert.match(p,/Avoid lonely sad men/);
});

test("Ragnar stays contemporary with no Nordic or Viking identity",()=>{
  const p=buildVisualPrompt({id:"ragnar-one"},"noite de streaming em casa","b");
  assert.match(p,/ordinary streaming entertainment in a modern home/i);
  assert.match(p,/clean, contemporary commercial streaming aesthetic/i);
  assert.match(p,/Do not use Viking, Nordic, medieval, longship, shield, fjord/i);
  assert.match(p,/Avoid repeating the same person sitting on a sofa/i);
});

test("generated image is stored in R2 and returns public URL",async()=>{
  let stored=null;
  const env={
    PUBLIC_BASE_URL:"https://example.workers.dev",
    MEDIA:{async put(key,bytes,meta){stored={key,bytes,meta};}}
  };
  const request=async()=>({output:[{type:"image_generation_call",result:btoa("PNGDATA")}]});
  const out=await generateOriginalMedia(env,{id:"globalplay-streaming"},"post-1","brief",{request,variationSeed:"x"});
  assert.match(out.url,/\/media\/posts\/globalplay-streaming\/post-1\/generated-/);
  assert.equal(new TextDecoder().decode(stored.bytes),"PNGDATA");
  assert.equal(stored.meta.httpMetadata.contentType,"image/jpeg");
  assert.equal(out.fingerprint.length,64);
});


test("deterministic overlay copy keeps brand and CTA out of the image model",()=>{
  assert.deepEqual(overlayCopy({id:"globalplay-streaming"},"Noite em família"),{
    brand:"GLOBAL PLAY",title:"Noite em família",cta:"DIGITE QUERO"
  });
  assert.equal(overlayCopy({id:"ragnar-one"},"Saga da noite").brand,"RAGNAR ONE");
});
