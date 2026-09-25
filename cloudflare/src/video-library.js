function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

async function folders(env, clientId) {
  const result=await env.DB.prepare(
    "SELECT id,name,created_at,updated_at FROM video_folders WHERE client_id=?1 ORDER BY name COLLATE NOCASE"
  ).bind(clientId).all();
  return [{id:"default",name:"Meus vídeos",system:true},...(result?.results||[]).map(row=>({
    id:row.id,name:row.name,createdAt:row.created_at||null,updatedAt:row.updated_at||null
  }))];
}

export async function createVideoFolder(env, clientId, name) {
  const clean=String(name||"").trim().slice(0,80);
  if(!clean)throw new Error("folder_name_required");
  const id="fld_"+crypto.randomUUID().replace(/-/g,"").slice(0,14);
  await env.DB.prepare(
    "INSERT INTO video_folders(id,client_id,name,created_at,updated_at) VALUES(?1,?2,?3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
  ).bind(id,clientId,clean).run();
  return {folder:{id,name:clean},folders:await folders(env,clientId)};
}

export async function renameVideoFolder(env, clientId, folderId, name) {
  if(folderId==="default")throw new Error("default_folder_locked");
  const clean=String(name||"").trim().slice(0,80);
  if(!clean)throw new Error("folder_name_required");
  const result=await env.DB.prepare(
    "UPDATE video_folders SET name=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2"
  ).bind(folderId,clientId,clean).run();
  if(!Number(result?.meta?.changes||0))throw new Error("folder_not_found");
  return {folder:{id:folderId,name:clean},folders:await folders(env,clientId)};
}

export async function deleteVideoFolder(env, clientId, folderId) {
  if(folderId==="default")throw new Error("default_folder_locked");
  const existing=await env.DB.prepare("SELECT id FROM video_folders WHERE id=?1 AND client_id=?2 LIMIT 1").bind(folderId,clientId).first();
  if(!existing)throw new Error("folder_not_found");

  const jobs=await env.DB.prepare("SELECT id,settings_json FROM video_jobs WHERE client_id=?1").bind(clientId).all();
  for(const row of jobs?.results||[]){
    const settings=parseJson(row.settings_json,{});
    if(String(settings.folderId||"default")!==folderId)continue;
    settings.folderId="default";
    await env.DB.prepare("UPDATE video_jobs SET settings_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1")
      .bind(row.id,JSON.stringify(settings)).run();
  }
  await env.DB.prepare("DELETE FROM video_folders WHERE id=?1 AND client_id=?2").bind(folderId,clientId).run();
  return {folders:await folders(env,clientId)};
}

async function videoJob(env, clientId, jobId) {
  return env.DB.prepare(
    "SELECT id,client_id,source_object_key,status,settings_json,result_json,created_at,updated_at FROM video_jobs WHERE id=?1 AND client_id=?2 LIMIT 1"
  ).bind(jobId,clientId).first();
}

function normalizeLogoPatch(settings, patch) {
  if(Object.prototype.hasOwnProperty.call(patch,"logoEnabled"))settings.logoEnabled=Boolean(patch.logoEnabled);
  if(Object.prototype.hasOwnProperty.call(patch,"logoObjectKey"))settings.logoObjectKey=String(patch.logoObjectKey||"").slice(0,500);
  if(Object.prototype.hasOwnProperty.call(patch,"logoProcessedObjectKey"))settings.logoProcessedObjectKey=String(patch.logoProcessedObjectKey||"").slice(0,500);
  if(Object.prototype.hasOwnProperty.call(patch,"logoBackgroundRemoved"))settings.logoBackgroundRemoved=Boolean(patch.logoBackgroundRemoved);
  if(Object.prototype.hasOwnProperty.call(patch,"logoAutoRemoveBackground"))settings.logoAutoRemoveBackground=patch.logoAutoRemoveBackground!==false;
  if(Object.prototype.hasOwnProperty.call(patch,"logoPosition")){
    const position=String(patch.logoPosition||"top-right");
    settings.logoPosition=["top-left","top-right","bottom-left","bottom-right","center"].includes(position)?position:"top-right";
  }
  if(Object.prototype.hasOwnProperty.call(patch,"logoScale")){
    const scale=Number(patch.logoScale||0.18);
    settings.logoScale=Math.min(0.45,Math.max(0.05,Number.isFinite(scale)?scale:0.18));
  }
  if(Object.prototype.hasOwnProperty.call(patch,"logoOpacity")){
    const opacity=Number(patch.logoOpacity??1);
    settings.logoOpacity=Math.min(1,Math.max(0.15,Number.isFinite(opacity)?opacity:1));
  }
}

export async function patchVideoJob(env, clientId, jobId, patch={}) {
  const row=await videoJob(env,clientId,jobId);
  if(!row)throw new Error("video_not_found");
  const settings=parseJson(row.settings_json,{});
  const result=parseJson(row.result_json,{});

  if(Object.prototype.hasOwnProperty.call(patch,"displayName")){
    const name=String(patch.displayName||"").trim().slice(0,120);
    if(!name)throw new Error("video_name_required");
    settings.displayName=name;
  }
  if(Object.prototype.hasOwnProperty.call(patch,"folderId")){
    const folderId=String(patch.folderId||"default");
    if(folderId!=="default"){
      const folder=await env.DB.prepare("SELECT id FROM video_folders WHERE id=?1 AND client_id=?2 LIMIT 1").bind(folderId,clientId).first();
      if(!folder)throw new Error("folder_not_found");
    }
    settings.folderId=folderId;
  }

  const allowed=["contentTitle","goal","clipDuration","requestedClips","outputFormat","autoSubtitles","subtitleSize","subtitleColor","subtitleWeight","subtitleBg","endText","endContact"];
  for(const key of allowed){
    if(Object.prototype.hasOwnProperty.call(patch,key))settings[key]=patch[key];
  }
  normalizeLogoPatch(settings,patch);

  await env.DB.prepare("UPDATE video_jobs SET settings_json=?3,result_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND client_id=?2")
    .bind(jobId,clientId,JSON.stringify(settings),JSON.stringify(result)).run();
  return {id:jobId,settings,result};
}

export async function deleteVideoJob(env, clientId, jobId) {
  const row=await videoJob(env,clientId,jobId);
  if(!row)throw new Error("video_not_found");

  const clipRows=await env.DB.prepare(
    "SELECT source_object_key,output_object_key FROM video_clips WHERE job_id=?1 AND client_id=?2"
  ).bind(jobId,clientId).all();
  const prefix="videos/"+String(clientId)+"/";
  const mediaKeys=[row.source_object_key,...(clipRows?.results||[]).flatMap(item=>[
    item.source_object_key,
    item.output_object_key
  ])]
    .map(value=>String(value||""))
    .filter(value=>value.startsWith(prefix)&&!value.includes(".."));
  const uniqueMediaKeys=[...new Set(mediaKeys)];

  await env.DB.prepare("DELETE FROM video_clips WHERE job_id=?1 AND client_id=?2").bind(jobId,clientId).run();
  await env.DB.prepare("DELETE FROM video_jobs WHERE id=?1 AND client_id=?2").bind(jobId,clientId).run();

  if(env.MEDIA&&uniqueMediaKeys.length){
    await env.MEDIA.delete(uniqueMediaKeys).catch(()=>{});
  }
  return {deleted:true,id:jobId};
}

async function clipRow(env, clientId, jobId, clipId) {
  return env.DB.prepare(
    "SELECT id,job_id,client_id,status,approval_status,publish_status,scheduled_for,settings_json,result_json,source_object_key,output_object_key FROM video_clips WHERE id=?1 AND job_id=?2 AND client_id=?3 LIMIT 1"
  ).bind(clipId,jobId,clientId).first();
}

function clipView(row) {
  if(!row)return null;
  return {
    id:row.id,
    jobId:row.job_id,
    clientId:row.client_id,
    status:row.status||"pending",
    approvalStatus:row.approval_status||"pending",
    publishStatus:row.publish_status||"draft",
    scheduledFor:row.scheduled_for||null,
    sourceObjectKey:row.source_object_key||"",
    outputObjectKey:row.output_object_key||"",
    ...parseJson(row.settings_json,{}),
    ...parseJson(row.result_json,{})
  };
}

export async function setClipApproval(env, clientId, jobId, clipId, status) {
  const row=await clipRow(env,clientId,jobId,clipId);
  if(!row)throw new Error("clip_not_found");
  const clean=["approved","rejected","pending"].includes(String(status))?String(status):"pending";
  await env.DB.prepare("UPDATE video_clips SET approval_status=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND job_id=?2 AND client_id=?3")
    .bind(clipId,jobId,clientId,clean).run();
  return clipView({...row,approval_status:clean});
}

export async function adjustClip(env, clientId, jobId, clipId, patch={}) {
  const row=await clipRow(env,clientId,jobId,clipId);
  if(!row)throw new Error("clip_not_found");
  const settings=parseJson(row.settings_json,{});
  const result=parseJson(row.result_json,{});
  for(const key of ["start","end","title","caption","endText","endContact"]){
    if(Object.prototype.hasOwnProperty.call(patch,key)){
      const value=patch[key];
      if(key==="start"||key==="end")settings[key]=Math.max(0,Number(value||0));
      else settings[key]=String(value||"").slice(0,key==="caption"?2200:160);
    }
  }
  normalizeLogoPatch(settings,patch);
  await env.DB.prepare("UPDATE video_clips SET settings_json=?4,result_json=?5,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND job_id=?2 AND client_id=?3")
    .bind(clipId,jobId,clientId,JSON.stringify(settings),JSON.stringify(result)).run();
  return clipView({...row,settings_json:JSON.stringify(settings),result_json:JSON.stringify(result)});
}

export async function selectClip(env, clientId, jobId, clipId, selected) {
  const row=await clipRow(env,clientId,jobId,clipId);
  if(!row)throw new Error("clip_not_found");
  const settings=parseJson(row.settings_json,{});
  settings.selectedForSchedule=Boolean(selected);
  await env.DB.prepare("UPDATE video_clips SET settings_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND job_id=?2 AND client_id=?3")
    .bind(clipId,jobId,clientId,JSON.stringify(settings)).run();
  return clipView({...row,settings_json:JSON.stringify(settings)});
}

export async function scheduleClip(env, clientId, jobId, clipId, scheduledFor, caption="") {
  const row=await clipRow(env,clientId,jobId,clipId);
  if(!row)throw new Error("clip_not_found");
  const date=new Date(scheduledFor);
  if(!Number.isFinite(date.getTime()))throw new Error("invalid_schedule");
  const settings=parseJson(row.settings_json,{});
  if(String(caption||"").trim())settings.caption=String(caption).slice(0,2200);
  settings.selectedForSchedule=false;
  await env.DB.prepare(
    "UPDATE video_clips SET publish_status='scheduled',scheduled_for=?4,settings_json=?5,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND job_id=?2 AND client_id=?3"
  ).bind(clipId,jobId,clientId,date.toISOString(),JSON.stringify(settings)).run();
  return clipView({...row,publish_status:"scheduled",scheduled_for:date.toISOString(),settings_json:JSON.stringify(settings)});
}

export async function bulkScheduleClips(env, clientId, items=[]) {
  let scheduled=0,failed=0;
  for(const item of Array.isArray(items)?items.slice(0,100):[]){
    try{
      await scheduleClip(env,clientId,String(item.jobId||""),String(item.clipId||""),item.scheduledFor,item.caption||"");
      scheduled+=1;
    }catch{failed+=1;}
  }
  return {scheduled,failed};
}
