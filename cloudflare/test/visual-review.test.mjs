import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewImage, visualApproval, VISUAL_REVIEW_POLICY } from '../src/visual-review.js';

const client={id:'globalplay-streaming',name:'Global Play'};
const url='https://example.com/image.png';
const verdict={
  singleScene:true,noCollage:true,legibleText:true,brandCorrect:true,
  originalGenericVisual:true,screenContentCoherent:true,
  scrollStopPower:82,emotion:78,brandFit:90,freshness:84,qualityScore:86,
  reason:'Cena forte, clara e diferente.'
};
const response=v=>({output:[{content:[{type:'output_text',text:JSON.stringify(v)}]}]});

test('approves only a strong positive visual score',async()=>{
  const strong=await reviewImage({},client,url,null,async(env,id,payload)=>{
    assert.equal(id,client.id);
    assert.equal(payload.nexusPurpose,'visual-review');
    assert.equal(payload.input[0].content[0].image_url,url);
    return response(verdict);
  });
  assert.equal(strong.status,'approved');
  assert.equal(strong.qualityScore,86);
  const weak=await reviewImage({},client,url+'?weak',null,async()=>response({...verdict,qualityScore:55}));
  assert.equal(weak.status,'rejected');
});

test('Ragnar is not forced into a TV-centered composition',async()=>{
  const ragnar={id:'ragnar-one',name:'Ragnar One'};
  let instructions='';
  const result=await reviewImage({},ragnar,url,null,async(env,id,payload)=>{
    instructions=payload.instructions;
    return response(verdict);
  });
  assert.match(instructions,/A television is NOT required/);
  assert.match(instructions,/Penalize a repeated man-on-sofa composition/);
  assert.equal(result.status,'approved');
});

test('cached verdict avoids billing and changed image requires a new inspection',async()=>{
  let calls=0;
  const request=async()=>{calls++;return response(verdict);};
  const first=await reviewImage({},client,url,null,request);
  await reviewImage({},client,url,first,request);
  assert.equal(calls,1);
  await reviewImage({},client,url+'?new',first,request);
  assert.equal(calls,2);
});

test('provider failure uses backoff and never exceeds three attempts',async()=>{
  let calls=0;
  const fail=async()=>{calls++;throw new Error('network failed');};
  let result=await reviewImage({},client,url,null,fail);
  assert.equal(result.status,'unavailable');
  assert.equal(result.attempts,1);
  result=await reviewImage({},client,url,{...result,retryAt:'2000-01-01'},fail);
  result=await reviewImage({},client,url,{...result,retryAt:'2000-01-01'},fail);
  assert.equal(result.attempts,VISUAL_REVIEW_POLICY.maxAttempts);
  const before=calls;
  const stopped=await reviewImage({},client,url,{...result,retryAt:'2000-01-01'},fail);
  assert.equal(stopped.attempts,3);
  assert.equal(calls,before);
});

test('visual approval requires matching v3 review and minimum score',async()=>{
  const review=await reviewImage({},client,url,null,async()=>response(verdict));
  assert.equal(visualApproval(client.id,{imageUrl:url,visualReview:review}),true);
  assert.equal(visualApproval(client.id,{imageUrl:url+'new',visualReview:review}),false);
  assert.equal(visualApproval(client.id,{imageUrl:url,visualReview:{...review,qualityScore:50}}),false);
});
