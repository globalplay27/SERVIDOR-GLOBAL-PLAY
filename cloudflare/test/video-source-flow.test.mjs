import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedVideoSource, isMp4Header } from '../src/video-source.js';
import { startYouTubeVideoIngest, startGitHubVideoRender, handleGitHubVideoRenderCallback } from '../src/github-video-render.js';

function fixture() {
  const row = { id: 'job', client_id: 'client-a', source_object_key: '', status: 'importing', settings_json: JSON.stringify({sourceUrl:'https://www.youtube.com/watch?v=htlUwNs2AjQ',ingestCallbackToken:'ingest-secret'}), result_json:'{}' };
  const updates=[];
  const objects=new Map();
  const env={ NEXUS_DOWNLOADER_URL:'https://downloader.test', GITHUB_ACTIONS_TOKEN:'fixture-only', DB:{prepare(sql){return{bind(...args){return{first:async()=>({...row}),run:async()=>{
    updates.push({sql,args});
    if(sql.includes("source_object_key=?3")){row.source_object_key=args[2];row.status='awaiting_configuration';row.settings_json=args[3];row.result_json=args[4];}
    else if(sql.includes("settings_json=?3")){row.settings_json=args[2];if(args[3])row.result_json=args[3];}
    if(sql.includes("SET status='failed'"))row.status='failed';
    if(sql.includes("SET status='cutting'"))row.status='cutting';
    return {meta:{changes:1}};
  }};}}}}, MEDIA:{head:async key=>objects.get(key)||null,put:async(key,body,options)=>{
    const bytes=await new Response(body).arrayBuffer();const obj={size:bytes.byteLength,...options};objects.set(key,obj);return obj;
  }}};
  return {row,env,updates,objects};
}

test('source confirmation rejects missing, wrong-client, empty and incomplete objects', async()=>{
  const f=fixture();
  await assert.rejects(confirmedVideoSource(f.env,'client-a','library/client-b/video.mp4'),/video_source_missing/);
  await assert.rejects(confirmedVideoSource(f.env,'client-a','library/client-a/video.mp4'),/video_source_missing/);
  f.objects.set('library/client-a/video.mp4',{size:0,httpMetadata:{contentType:'video/mp4'}});
  await assert.rejects(confirmedVideoSource(f.env,'client-a','library/client-a/video.mp4'),/video_source_missing/);
  f.objects.set('library/client-a/video.mp4',{size:8,httpMetadata:{contentType:'video/mp4'}});
  await assert.rejects(confirmedVideoSource(f.env,'client-a','library/client-a/video.mp4',9),/video_source_size_mismatch/);
  assert.equal((await confirmedVideoSource(f.env,'client-a','library/client-a/video.mp4',8)).size,8);
  assert.equal(isMp4Header(new TextEncoder().encode('xxxxftypisom')),true);
  assert.equal(isMp4Header(new TextEncoder().encode('<html>error</html>')),false);
});

test('network timeout and rejected acknowledgements persist ingestion failure instead of ten percent forever',async()=>{
  const original=globalThis.fetch;
  try{
    for(const fail of [async()=>{throw new DOMException('timeout','TimeoutError');},async()=>Response.json({ok:true})]){
      const f=fixture();globalThis.fetch=fail;
      await assert.rejects(startYouTubeVideoIngest(f.env,'client-a','job'),/youtube_ingest_dispatch_(timeout|failed)/);
      assert.equal(f.row.status,'failed');assert.equal(JSON.parse(f.row.result_json).progress,0);
      assert.equal(JSON.parse(f.row.settings_json).ingestCallbackToken,undefined);
    }
  }finally{globalThis.fetch=original;}
});

test('render never dispatches if the database key has no confirmed R2 object',async()=>{
  const f=fixture();f.row.status='awaiting_configuration';f.row.source_object_key='library/client-a/missing.mp4';
  await assert.rejects(startGitHubVideoRender(f.env,'client-a','job'),/video_source_missing/);
  assert.equal(f.updates.length,0);
});

test('ingest upload confirms R2 and unlocks configuration without starting a render',async()=>{
  const f=fixture();const url=new URL('https://nexus.test/api/internal/video-ingest/upload');
  const request=new Request(url,{method:'PUT',body:'xxxxftypisom',headers:{'content-length':'12','content-type':'video/mp4','x-nexus-client-id':'client-a','x-nexus-job-id':'job','x-nexus-callback-token':'ingest-secret'}});
  const response=await handleGitHubVideoRenderCallback(request,f.env,url);
  assert.equal(response.status,201);assert.equal(f.row.status,'awaiting_configuration');
  assert.equal((await f.env.MEDIA.head(f.row.source_object_key)).size,12);
  assert.equal(f.updates.some(x=>x.sql.includes("status='cutting'")),false);
});

test('a renderer transport failure is stored as failure and can be retried',async()=>{
  const f=fixture();f.row.status='awaiting_configuration';f.row.source_object_key='library/client-a/video.mp4';
  f.objects.set(f.row.source_object_key,{size:12,httpMetadata:{contentType:'video/mp4'}});
  const original=globalThis.fetch;globalThis.fetch=async()=>{throw new TypeError('fetch failed');};
  try{await assert.rejects(startGitHubVideoRender(f.env,'client-a','job'),/github_render_dispatch_transport_failed/);assert.equal(f.row.status,'failed');}
  finally{globalThis.fetch=original;}
});
