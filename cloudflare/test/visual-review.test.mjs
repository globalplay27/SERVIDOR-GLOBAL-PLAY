import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reviewImage, visualApproval } from '../src/visual-review.js';
const client={id:'globalplay-streaming',name:'Global Play'};
const url='https://example.com/image.png';
const verdict={singleScene:true,noCollage:true,tvFilled:true,legibleText:true,brandCorrect:true,originalGenericVisual:true,reason:'Cena única, TV preenchida.'};
const response=v=>({output:[{content:[{type:'output_text',text:JSON.stringify(v)}]}]});

test('sends actual image and approves complete visual verdict',async()=>{
  const result=await reviewImage({},client,url,null,async(env,id,payload)=>{
    assert.equal(id,client.id);
    assert.equal(payload.input[0].content[0].image_url,url);
    return response(verdict);
  });
  assert.equal(result.status,'approved');
});
test('rejects blank TV, collage and incomplete output',async()=>{
  for(const field of ['tvFilled','noCollage','brandCorrect']){
    assert.equal((await reviewImage({},client,url,null,async()=>response({...verdict,[field]:false}))).status,'rejected');
  }
  assert.equal((await reviewImage({},client,url,null,async()=>response({approved:true}))).status,'unavailable');
});
test('cached verdict avoids billing and changed image requires new inspection',async()=>{
  let calls=0;
  const request=async()=>{calls++;return response(verdict);};
  const first=await reviewImage({},client,url,null,request);
  await reviewImage({},client,url,first,request);
  assert.equal(calls,1);
  await reviewImage({},client,url+'?new',first,request);
  assert.equal(calls,2);
});
test('provider failure fails closed, backs off and stops after three attempts',async()=>{
  let calls=0;
  const fail=async()=>{calls++;throw new Error('quota');};
  let result=await reviewImage({},client,url,null,fail);
  assert.equal(result.status,'unavailable');
  await reviewImage({},client,url,result,fail);
  assert.equal(calls,1);
  for(let i=0;i<4;i++)result=await reviewImage({},client,url,{...result,retryAt:'2000-01-01'},fail);
  assert.equal(calls,3);
});
test('missing media never invokes provider',async()=>{
  const result=await reviewImage({},client,'',null,()=>{throw new Error('unexpected call');});
  assert.equal(result.reason,'missing_image');
  assert.equal(result.status,'rejected');
});

test('Global Play and Ragnar require matching real visual review',async()=>{
  assert.equal(visualApproval(client.id,{qualityGates:{designer:'approved'}}),false);
  const review=await reviewImage({},client,url,null,async()=>response(verdict));
  assert.equal(visualApproval(client.id,{imageUrl:url,visualReview:review}),true);
  assert.equal(visualApproval(client.id,{imageUrl:url+'new',visualReview:review}),false);
  assert.equal(visualApproval('ragnar-one',{}),false);
  const ragnar={id:'ragnar-one',name:'Ragnar One'};
  const ragnarReview=await reviewImage({},ragnar,url,null,async()=>response(verdict));
  assert.equal(visualApproval('ragnar-one',{imageUrl:url,visualReview:ragnarReview}),true);
});

test('only the inspected Ragnar artwork bytes receive pinned approval without spending tokens',async()=>{
  const ragnar={id:'ragnar-one',name:'Ragnar One'};
  const artwork='https://servidor-nexus.diamantehinode2015.workers.dev/assets/ragnar/saga-sofa-20260928.jpg';
  const bytes=await readFile(new URL('../../public/assets/ragnar/saga-sofa-20260928.jpg',import.meta.url));
  const neverUseProvider=()=>{throw new Error('unexpected paid review');};
  const approved=await reviewImage({},ragnar,artwork,
    {version:'visual-review-v2',media:artwork,status:'unavailable',retryAt:'2099-01-01'},
    neverUseProvider,async()=>new Response(bytes,{status:200}));
  assert.equal(approved.status,'approved');
  assert.equal(approved.method,'inspected-pinned-owner-artwork');
  assert.equal(visualApproval(ragnar.id,{imageUrl:artwork,visualReview:approved}),true);
  const changed=await reviewImage({},ragnar,artwork,null,neverUseProvider,
    async()=>new Response(new Uint8Array([1,2,3]),{status:200}));
  assert.equal(changed.status,'unavailable');
  assert.equal(changed.reason,'pinned_asset_mismatch');
  const replacedAfterApproval=await reviewImage({},ragnar,artwork,approved,neverUseProvider,
    async()=>new Response(new Uint8Array([1,2,3]),{status:200}));
  assert.equal(replacedAfterApproval.status,'unavailable');
});
