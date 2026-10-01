function safeId(value){
  return String(value||"").replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80);
}
function parseJson(text,fallback=null){try{return JSON.parse(String(text||""));}catch{return fallback;}}
async function readJson(env,key,fallback){
  if(!env.MEDIA)return fallback;
  const obj=await env.MEDIA.get(key);
  if(!obj)return fallback;
  try{return JSON.parse(await obj.text());}catch{return fallback;}
}
async function writeJson(env,key,value){
  if(!env.MEDIA)throw new Error("r2_unavailable");
  await env.MEDIA.put(key,JSON.stringify(value),{httpMetadata:{contentType:"application/json",cacheControl:"no-store"}});
}
function directivesKey(clientId){return "master-workspace/"+safeId(clientId)+"/directives.json";}
function campaignPrefix(clientId){return "master-workspace/"+safeId(clientId)+"/campaigns/";}
function campaignKey(clientId,id){return campaignPrefix(clientId)+safeId(id)+".json";}
function publicUrl(env,key){
  const base=String(env.PUBLIC_BASE_URL||"").replace(/\/+$/,"");
  return base?base+"/media/"+key:"";
}
export async function listDirectives(env,clientId){
  const rows=await readJson(env,directivesKey(clientId),[]);
  return Array.isArray(rows)?rows.slice(0,80):[];
}
export async function addDirective(env,clientId,body={}){
  const text=String(body.text||"").trim().slice(0,4000);
  if(!text)throw new Error("directive_text_required");
  const appliesTo=Array.isArray(body.appliesTo)?body.appliesTo.map(x=>String(x).toLowerCase()).filter(Boolean).slice(0,13):["all"];
  const now=new Date().toISOString();
  const author=String(body.author||"MASTER").trim().toUpperCase()==="CLIENT"?"CLIENT":"MASTER";
  const item={id:crypto.randomUUID(),text,appliesTo:appliesTo.length?appliesTo:["all"],createdAt:now,effectiveAt:now,status:"active",author};
  const rows=await listDirectives(env,clientId);
  rows.unshift(item);
  await writeJson(env,directivesKey(clientId),rows.slice(0,80));
  return item;
}
export async function listCampaigns(env,clientId){
  if(!env.MEDIA)return [];
  const listed=await env.MEDIA.list({prefix:campaignPrefix(clientId),limit:80});
  const rows=[];
  for(const obj of listed.objects||[]){
    if(!obj.key.endsWith(".json"))continue;
    const value=await readJson(env,obj.key,null);
    if(value)rows.push(value);
  }
  return rows.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))).slice(0,50);
}
export async function createCampaign(env,clientId,{title,brief,startDate,file}={}){
  if(!env.MEDIA)throw new Error("r2_unavailable");
  const id=crypto.randomUUID();
  const createdAt=new Date().toISOString();
  const start=String(startDate||"").trim()||createdAt.slice(0,10);
  let assetUrl="",assetKey="",assetName="";
  if(file&&typeof file.arrayBuffer==="function"&&Number(file.size||0)>0){
    if(Number(file.size)>12*1024*1024)throw new Error("creative_too_large");
    const type=String(file.type||"application/octet-stream");
    if(!/^image\/(jpeg|png|webp)$/i.test(type))throw new Error("creative_type_not_allowed");
    const ext=type.includes("png")?"png":type.includes("webp")?"webp":"jpg";
    assetKey="master-workspace/"+safeId(clientId)+"/assets/"+id+"."+ext;
    await env.MEDIA.put(assetKey,await file.arrayBuffer(),{
      httpMetadata:{contentType:type,cacheControl:"public, max-age=31536000, immutable"},
      customMetadata:{clientId:String(clientId),campaignId:id,kind:"master-campaign-reference"}
    });
    assetUrl=publicUrl(env,assetKey);assetName=String(file.name||"creative."+ext).slice(0,180);
  }
  const campaign={
    id,clientId:String(clientId),title:String(title||"Campanha de 7 dias").trim().slice(0,160),
    brief:String(brief||"").trim().slice(0,5000),startDate:start,durationDays:7,
    status:"active",distributionStatus:"distributed",creativeStatus:"received",
    assetUrl,assetKey,assetName,createdAt,updatedAt:createdAt,
    workflow:["received","in_production","approved_or_adjust","scheduled","published"]
  };
  await writeJson(env,campaignKey(clientId,id),campaign);
  return campaign;
}
export async function updateCampaign(env,clientId,id,patch={}){
  const key=campaignKey(clientId,id);
  const current=await readJson(env,key,null);
  if(!current)throw new Error("campaign_not_found");
  const allowedStatus=new Set(["draft","active","paused","completed"]);
  const allowedCreative=new Set(["received","in_production","approved","adjust","scheduled","published"]);
  const next={...current,updatedAt:new Date().toISOString()};
  if(allowedStatus.has(String(patch.status||"")))next.status=String(patch.status);
  if(allowedCreative.has(String(patch.creativeStatus||"")))next.creativeStatus=String(patch.creativeStatus);
  if(patch.brief!==undefined)next.brief=String(patch.brief||"").slice(0,5000);
  await writeJson(env,key,next);
  return next;
}
export async function masterWorkspace(env,clientId){
  const [directives,campaigns]=await Promise.all([listDirectives(env,clientId),listCampaigns(env,clientId)]);
  return {ok:true,clientId:String(clientId),directives,campaigns};
}
export function filterMasterGuidance(guidance={},agent="all"){
  const target=String(agent||"all").toLowerCase();
  const directives=Array.isArray(guidance?.directives)?guidance.directives:[];
  const campaigns=Array.isArray(guidance?.campaigns)?guidance.campaigns:[];
  const normalized=directives.filter(item=>{
    const applies=Array.isArray(item?.appliesTo)&&item.appliesTo.length?item.appliesTo:["all"];
    return applies.map(x=>String(x).toLowerCase()).some(x=>x==="all"||x===target);
  });
  return {directives:normalized,campaigns};
}

export async function activeMasterGuidance(env,clientId){
  const [directives,campaigns]=await Promise.all([listDirectives(env,clientId),listCampaigns(env,clientId)]);
  const activeDirectives=directives.filter(x=>x.status==="active").slice(0,12);
  const activeCampaigns=campaigns.filter(x=>x.status==="active").slice(0,4);
  return {
    directives:activeDirectives.map(x=>({text:x.text,appliesTo:x.appliesTo,createdAt:x.createdAt})),
    campaigns:activeCampaigns.map(x=>({
      id:x.id,title:x.title,brief:x.brief,startDate:x.startDate,durationDays:x.durationDays,
      assetUrl:x.assetUrl||"",creativeStatus:x.creativeStatus||"received"
    }))
  };
}
