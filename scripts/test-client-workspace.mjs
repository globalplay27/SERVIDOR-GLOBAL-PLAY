import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { handlePortalApi } from '../cloudflare/src/portal.js';
import { createPortalSession } from '../cloudflare/src/auth.js';
import { handleGitHubVideoRenderCallback } from '../cloudflare/src/github-video-render.js';
import { runAgentCoreCycle } from '../cloudflare/src/agent-runtime.js';
import { processDueJobs } from '../cloudflare/src/executor.js';
import { enqueue } from '../cloudflare/src/scheduler.js';

const db = new DatabaseSync(':memory:');
for (const name of (await readdir(new URL('../cloudflare/migrations/',import.meta.url))).sort()) db.exec(await readFile(new URL('../cloudflare/migrations/'+name,import.meta.url),'utf8'));
const objects = new Map();
const DB={prepare(sql){return{bind(...args){const parameters=Object.fromEntries(args.map((value,i)=>['?'+(i+1),value??null]));return{
  first:async()=>db.prepare(sql).get(parameters)||null,
  all:async()=>({results:db.prepare(sql).all(parameters)}),
  run:async()=>{const result=db.prepare(sql).run(parameters);return{meta:{changes:Number(result.changes)}};}
};},first:async()=>db.prepare(sql).get()||null,all:async()=>({results:db.prepare(sql).all()}),run:async()=>{const r=db.prepare(sql).run();return{meta:{changes:Number(r.changes)}};}};}};
function object(key, bytes, options) { return {key,size:bytes.length,uploaded:new Date().toISOString(),...options,body:new Blob([bytes]).stream(),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),text:async()=>bytes.toString(),writeHttpMetadata(headers){for(const [k,v] of Object.entries(options.httpMetadata||{}))headers.set(k==='contentType'?'content-type':'cache-control',v);}}; }
const MEDIA={
  async put(key,body,options={}){const bytes=Buffer.from(await new Response(body).arrayBuffer());objects.set(key,{bytes,options});return object(key,bytes,options);},
  async head(key){const x=objects.get(key);return x?object(key,x.bytes,x.options):null;},
  async get(key){return this.head(key);},
  async list({prefix,limit=100}){return{objects:[...objects.entries()].filter(([key])=>key.startsWith(prefix)).slice(0,limit).map(([key,x])=>object(key,x.bytes,x.options))};},
  async delete(key){objects.delete(key);}
};
const env={DB,MEDIA,NEXUS_SECRET_KEY:'local-e2e-only',GITHUB_ACTIONS_TOKEN:'fixture-only',PUBLIC_BASE_URL:'https://nexus.test',CLOUDFLARE_AUTOMATION_ACTIVE:'true',NEXUS_OPENAI_DAILY_TOKEN_LIMIT:'0'};
db.prepare("INSERT INTO clients(id,name,instagram,status,config_json) VALUES('e2e-client','E2E client','@e2e','online',?1)").run({'?1':JSON.stringify({agentCore:{autoPublish:false,approvalRequired:true},postingProfile:{standardMediaUrls:[]}})});
const session=await createPortalSession(env,'e2e-client');
const nativeFetch=globalThis.fetch;
const backgroundTasks=[];
const server=createServer(async(req,res)=>{try{
  const bytes=[];for await(const chunk of req)bytes.push(chunk);
  const url=new URL(req.url,'http://127.0.0.1:'+server.address().port);
  const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(bytes)}:{})});
  const result=await handleGitHubVideoRenderCallback(request,env,url)||await handlePortalApi(request,env,url,{waitUntil(task){backgroundTasks.push(task);}});
  res.writeHead(result?.status||404,Object.fromEntries(result?.headers||[]));res.end(result?Buffer.from(await result.arrayBuffer()):'not_found');
}catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const evidence=[];
async function call(path,options={}){const r=await nativeFetch(base+path,{...options,headers:{'x-nexus-session':session.token,...options.headers}});const d=await r.json();return{status:r.status,data:d};}
try{
  const source=await readFile(process.env.NEXUS_E2E_SOURCE);
  globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https://api.github.com/'))return new Response(null,{status:204});throw new Error('external_network_disabled_in_fixture');};
  const form=new FormData();form.append('file',new Blob([source],{type:'video/mp4'}),'test.mp4');form.append('purpose','publish');
  let r=await call('/api/portal/media',{method:'POST',body:form});assert.equal(r.status,202,JSON.stringify(r.data));const jobId=r.data.videoJobId;
  let jobs=(await call('/api/portal/videos')).data.jobs;const job=jobs.find(x=>x.id===jobId);assert.equal(job.sourceReady,true);assert.equal(job.status,'cutting');
  assert.equal((await MEDIA.head(job.sourceObjectKey)).size,source.length);evidence.push({test:'MP4 HTTP multipart → API → R2 emulator → automatic render dispatch',result:'PASS',bytes:source.length});
  const row=db.prepare('SELECT * FROM video_jobs WHERE id=?1').get({'?1':jobId});const token=JSON.parse(row.settings_json).githubRenderToken;
  const rendered=await readFile(process.env.NEXUS_E2E_RESULT);
  let result=await nativeFetch(base+'/api/internal/video-render/upload',{method:'PUT',body:rendered,headers:{'content-type':'video/mp4','content-length':String(rendered.length),'x-nexus-job-id':jobId,'x-nexus-client-id':'e2e-client','x-nexus-callback-token':token}});assert.equal(result.status,201,await result.clone().text());
  jobs=(await call('/api/portal/videos')).data.jobs;const ready=jobs.find(x=>x.id===jobId);assert.equal(ready.status,'ready');
  result=await nativeFetch(base+ready.clips[0].previewUrl,{headers:{'x-nexus-session':session.token}});assert.equal(result.status,200);
  assert.equal(createHash('sha256').update(Buffer.from(await result.arrayBuffer())).digest('hex'),createHash('sha256').update(rendered).digest('hex'));evidence.push({test:'confirmed source → dispatch fixture → real FFmpeg output → R2 emulator → authenticated download',result:'PASS',bytes:rendered.length});
  result=await nativeFetch(base+ready.clips[0].previewUrl);assert.equal(result.status,401);evidence.push({test:'Unauthenticated result access',result:'PASS (401)'});
  const bad=new FormData();bad.append('file',new Blob(['<html>error</html>'],{type:'video/mp4'}),'invalid.mp4');bad.append('purpose','publish');r=await call('/api/portal/media',{method:'POST',body:bad});assert.equal(r.status,415);evidence.push({test:'Fake MP4 rejected',result:'PASS (415)'});
  const campaign=new FormData();campaign.append('title','E2E validation');campaign.append('brief','Fixture: validar leitura e escrita por cliente.');r=await call('/api/portal/campaigns',{method:'POST',body:campaign});assert.equal(r.status,201);
  r=await call('/api/portal/workspace');assert.equal(r.data.campaigns[0].title,'E2E validation');assert.equal(r.data.campaigns[0].clientId,'e2e-client');evidence.push({test:'Campaign R2 write/read scoped to client',result:'PASS'});
  db.prepare("INSERT INTO post_ledger(id,client_id,status,approval_status,payload_json) VALUES('post-e2e','e2e-client','ready','pending','{\"status\":\"published\",\"id\":\"wrong\"}')").run();
  r=await call('/api/portal/posts');assert.equal(r.data.posts[0].id,'post-e2e');assert.equal(r.data.posts[0].status,'ready');
  for(const decision of ['approved','rejected']){r=await call('/api/portal/posts/post-e2e/decision',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision})});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal((await call('/api/portal/posts')).data.posts[0].approvalStatus,decision);}
  evidence.push({test:'Post database status authoritative and approval/rejection round trip',result:'PASS'});
  const cycle=await runAgentCoreCycle(env,'e2e-client',{trigger:'manual',agent:'all'});assert.equal(cycle.ok,true);
  r=await call('/api/portal/agent-core');assert.equal(new Set(r.data.executions.map(x=>x.agent)).size,13);assert.equal(r.data.state.lastCycleStatus,'success');assert.equal(r.data.state.radar.source,'local');
  evidence.push({test:'Complete 13-agent cycle records activity (no live Instagram credentials)',result:'PASS',agents:13,radarSource:r.data.state.radar.source});
  db.exec("INSERT INTO clients(id,name,status,config_json) VALUES('other-client','Other client','online','{}')");
  await enqueue(env,'other-client','agent-core-cycle',new Date(Date.now()-60000),{agent:'all'});
  r=await call('/api/portal/agent-core/run',{method:'POST'});assert.equal(r.status,202);
  await Promise.all(backgroundTasks);
  assert.equal(db.prepare("SELECT status FROM scheduled_jobs WHERE client_id='other-client'").get().status,'scheduled');
  assert.equal((await call('/api/portal/agent-core')).data.cycle.status,'completed');
  evidence.push({test:'Manual cycle executes current client despite older jobs from another client',result:'PASS'});
  console.log(JSON.stringify(evidence,null,2));
}finally{globalThis.fetch=nativeFetch;server.close();db.close();}
