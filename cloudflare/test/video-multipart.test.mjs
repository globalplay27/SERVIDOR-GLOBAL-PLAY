import test from 'node:test';
import assert from 'node:assert/strict';
import {handleGitHubVideoRenderCallback} from '../src/github-video-render.js';

test('multipart render uploads remain client scoped and require sequential complete parts',async()=>{
  let settings={githubRenderToken:'secret',renderUpload:{key:'videos/client-a/clips/clip_test.mp4',clipId:'clip_test',uploadId:'upload'}};
  const calls=[];
  const env={DB:{prepare(){return{bind(){return{first:async()=>({settings_json:JSON.stringify(settings),result_json:'{}',source_object_key:'source'}),run:async()=>({})};}}}},MEDIA:{resumeMultipartUpload(key,id){calls.push({key,id});return{uploadPart:async number=>({partNumber:number,etag:'etag'}),complete:async()=>({}),abort:async()=>({})};}}};
  async function invoke(path,method,body,extra={}) {
    const url=new URL('https://nexus.example/api/internal/video-render/upload/'+path);
    const request=new Request(url,{method,body,headers:{'x-nexus-job-id':'job','x-nexus-client-id':'client-a','x-nexus-callback-token':'secret',...extra}});
    return handleGitHubVideoRenderCallback(request,env,url);
  }
  assert.equal((await invoke('part?part=1','PUT','abc',{'content-length':'3'})).status,200);
  assert.deepEqual(calls,[{key:'videos/client-a/clips/clip_test.mp4',id:'upload'}]);
  calls.length=0;settings.renderUpload.key='videos/client-b/clips/clip_test.mp4';
  assert.equal((await invoke('part?part=1','PUT','abc',{'content-length':'3'})).status,400);assert.equal(calls.length,0);
  settings.renderUpload.key='videos/client-a/clips/clip_test.mp4';
  assert.equal((await invoke('complete','POST',JSON.stringify({parts:[{partNumber:2,etag:'etag'}]}))).status,400);assert.equal(calls.length,0);
  assert.equal((await invoke('part?part=1','PUT','abc',{'content-length':String(100*1024*1024)})).status,400);
});
