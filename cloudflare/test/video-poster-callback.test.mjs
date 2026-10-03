import test from 'node:test';
import assert from 'node:assert/strict';
import { handleGitHubVideoRenderCallback } from '../src/github-video-render.js';

function setup(posterUrl, token='render-token') {
  const reads=[];
  const env={
    DB: { prepare() { return { bind() { return {
      async first() { return { settings_json: JSON.stringify({posterUrl, githubRenderToken:'render-token'}) }; }
    }; } }; } },
    MEDIA:{async get(key){reads.push(key);return {body:'poster-bytes',size:12,writeHttpMetadata(headers){headers.set('content-type','image/jpeg');}};}}
  };
  const url=new URL('https://nexus.example/api/internal/video-render/poster');
  const request=new Request(url,{headers:{'x-nexus-job-id':'job','x-nexus-client-id':'client-a','x-nexus-callback-token':token}});
  return {env,url,request,reads};
}

test('job-authenticated renderer can read its customer private poster without portal cookies',async()=>{
  const s=setup('https://nexus.example/media/library/client-a/poster.jpg');
  const response=await handleGitHubVideoRenderCallback(s.request,s.env,s.url);
  assert.equal(response.status,200);
  assert.equal(await response.text(),'poster-bytes');
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(s.reads,['library/client-a/poster.jpg']);
});

test('poster callback rejects another customer, encoded traversal and invalid job token',async()=>{
  for(const value of ['https://nexus.example/media/library/client-b/poster.jpg','https://nexus.example/media/library/client-a/%2e%2e%2fclient-b/poster.jpg']){
    const s=setup(value);
    assert.equal((await handleGitHubVideoRenderCallback(s.request,s.env,s.url)).status,404);
    assert.deepEqual(s.reads,[]);
  }
  const s=setup('https://nexus.example/media/library/client-a/poster.jpg','wrong');
  assert.equal((await handleGitHubVideoRenderCallback(s.request,s.env,s.url)).status,401);
  assert.deepEqual(s.reads,[]);
});
