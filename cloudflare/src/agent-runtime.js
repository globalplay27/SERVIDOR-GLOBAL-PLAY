import { getClient } from "./clients.js";
import { decryptSecret } from "./secrets.js";
import { publishInstagramImage } from "./publisher.js";
import {
  AGENT_CORE_MODULES,
  normalizeAgentCoreConfig,
  agentCoreState,
  patchAgentCoreState,
  recordAgentExecution
} from "./agent-core.js";
import { leadsForClient, leadHunterSummary } from "./leads.js";

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function median(values = []) {
  const nums = values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function topTerms(texts = [], limit = 10) {
  const stop = new Set(["para","como","mais","uma","com","sem","que","dos","das","por","seu","sua","nos","nas","isso","este","esta","voce","você","hoje","agora","aqui","sobre","muito","the","and"]);
  const counts = new Map();
  for (const text of texts) {
    for (const token of String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").match(/[a-z0-9]{3,}/g) || []) {
      if (stop.has(token)) continue;
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([term,count])=>({term,count}));
}

function postingProfile(client) {
  const current = client?.config?.postingProfile && typeof client.config.postingProfile === "object"
    ? client.config.postingProfile : {};
  return {
    contentStrategy: current.contentStrategy || "Crescimento de seguidores + engajamento qualificado",
    targetAudience: current.targetAudience || "Misto",
    contentFocus: current.contentFocus || "Conteúdo útil, entretenimento, descoberta e motivo claro para seguir",
    morningTheme: current.morningTheme || "Descoberta, curiosidade e gancho compartilhável",
    afternoonTheme: current.afternoonTheme || "Conteúdo útil, entretenimento e valor para salvar",
    eveningTheme: current.eveningTheme || "Comunidade, opinião e motivo para acompanhar o perfil",
    tone: current.tone || "Firme, direto e profissional",
    cta: current.cta || 'Comente "QUERO" para saber mais',
    hashtags: current.hashtags || "#Entretenimento #Streaming #FilmesESeries #Dicas",
    avoidTopics: current.avoidTopics || "Venda agressiva, promessas irreais e poluição visual"
  };
}

async function metaConnection(env, clientId) {
  const row = await env.DB.prepare(
    "SELECT payload_json FROM connections WHERE client_id = ?1 AND provider = 'meta' LIMIT 1"
  ).bind(clientId).first();
  return row ? parseJson(row.payload_json, {}) : null;
}

async function instagramSnapshot(env, client) {
  const conn = await metaConnection(env, client.id);
  const token = conn?.accessToken ? await decryptSecret(env, conn.accessToken).catch(()=>"") : "";
  const igUserId = String(conn?.igUserId || "").trim();
  if (!token || !igUserId) {
    return { source:"local", items:[], followersCount:0, mediaCount:0, error:"instagram_not_connected" };
  }

  const headers = { authorization:"Bearer "+token, accept:"application/json", "user-agent":"NEXUS-AgentCore-Cloudflare/1.0" };
  try {
    const mediaUrl = "https://graph.instagram.com/" + encodeURIComponent(igUserId) + "/media?fields=" + encodeURIComponent("id,caption,timestamp,media_type,like_count,comments_count,permalink") + "&limit=25";
    const mediaResponse = await fetch(mediaUrl,{headers});
    const mediaPayload = await mediaResponse.json().catch(()=>({}));
    if(!mediaResponse.ok)throw new Error(String(mediaPayload?.error?.message || "instagram_media_"+mediaResponse.status));
    const items = Array.isArray(mediaPayload.data) ? mediaPayload.data.map(item=>({
      id:String(item.id||""),
      caption:String(item.caption||"").slice(0,2200),
      timestamp:item.timestamp||null,
      mediaType:String(item.media_type||""),
      likeCount:Math.max(0,Number(item.like_count||0)),
      commentsCount:Math.max(0,Number(item.comments_count||0)),
      permalink:String(item.permalink||"")
    })) : [];

    let followersCount=0, mediaCount=items.length, username=String(conn?.username||"");
    try {
      const profileUrl="https://graph.instagram.com/"+encodeURIComponent(igUserId)+"?fields="+encodeURIComponent("username,followers_count,media_count");
      const profileResponse=await fetch(profileUrl,{headers});
      const profile=await profileResponse.json().catch(()=>({}));
      if(profileResponse.ok){
        followersCount=Math.max(0,Number(profile.followers_count||0));
        mediaCount=Math.max(0,Number(profile.media_count||items.length));
        username=String(profile.username||username);
      }
    } catch {}

    return { source:"instagram-api",items,followersCount,mediaCount,username };
  } catch(error) {
    return { source:"instagram-api",items:[],followersCount:0,mediaCount:0,error:String(error?.message||error).slice(0,300) };
  }
}

async function ledgerRows(env, clientId, limit = 100) {
  const result=await env.DB.prepare(
    "SELECT id,client_id,scheduled_for,scheduled_hour,status,approval_status,media_id,caption,image_object_key,error,cost_usd,payload_json,created_at,updated_at FROM post_ledger WHERE client_id=?1 ORDER BY COALESCE(scheduled_for,created_at) DESC LIMIT ?2"
  ).bind(clientId,Math.max(1,Math.min(500,Number(limit||100)))).all();
  return (result?.results||[]).map(row=>({
    ...row,
    payload:parseJson(row.payload_json,{})
  }));
}

function recommendedTimes(items, fallback) {
  const scores=new Map();
  for(const item of items||[]){
    if(!item.timestamp)continue;
    const date=new Date(item.timestamp);
    if(!Number.isFinite(date.getTime()))continue;
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",hour:"2-digit",hourCycle:"h23"}).formatToParts(date);
    const hour=Number(parts.find(p=>p.type==="hour")?.value);
    if(!Number.isInteger(hour)||hour<6||hour>23)continue;
    const score=Number(item.likeCount||0)+Number(item.commentsCount||0)*2;
    if(!scores.has(hour))scores.set(hour,[]);
    scores.get(hour).push(score);
  }
  const ranked=[...scores.entries()].map(([hour,values])=>({hour,score:median(values)})).sort((a,b)=>b.score-a.score);
  const chosen=[];
  for(const row of ranked){
    if(chosen.length>=3)break;
    if(chosen.every(h=>Math.abs(h-row.hour)>=4))chosen.push(row.hour);
  }
  for(const raw of fallback||["09:00","14:00","20:00"]){
    if(chosen.length>=3)break;
    const h=Number(String(raw).slice(0,2));
    if(Number.isInteger(h)&&chosen.every(x=>Math.abs(x-h)>=4))chosen.push(h);
  }
  for(const h of [9,14,20,8,13,18,22]){
    if(chosen.length>=3)break;
    if(chosen.every(x=>Math.abs(x-h)>=4))chosen.push(h);
  }
  return chosen.slice(0,3).sort((a,b)=>a-b).map(h=>String(h).padStart(2,"0")+":00");
}

function localDay(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(value instanceof Date?value:new Date(value));
}

function scheduleIso(time,index=0) {
  const clean=/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time||""))?String(time):"09:00";
  const today=localDay();
  let date=new Date(today+"T"+clean+":00-03:00");
  const minimum=Date.now()+Math.max(0,index)*60000;
  if(!Number.isFinite(date.getTime())||date.getTime()<=minimum)date=new Date(date.getTime()+86400000);
  return date.toISOString();
}

async function runRadar(env, client, options) {
  const startedAt=new Date().toISOString();
  const [snapshot,ledger,state]=await Promise.all([
    instagramSnapshot(env,client),
    ledgerRows(env,client.id,50),
    agentCoreState(env,client.id)
  ]);
  const captions=[...(snapshot.items||[]).map(x=>x.caption),...ledger.map(x=>x.caption||"")].filter(Boolean);
  const terms=topTerms(captions,10);
  const engagement=(snapshot.items||[]).map(item=>Number(item.likeCount||0)+Number(item.commentsCount||0)*2);
  const postTimes=recommendedTimes(snapshot.items,client.config?.postTimes||["09:00","14:00","20:00"]);
  const previousFollowers=Math.max(0,Number(state?.radar?.followersCount||0));
  const followersCount=Math.max(0,Number(snapshot.followersCount||previousFollowers||0));
  const output={
    source:snapshot.source,
    scannedMedia:(snapshot.items||[]).length,
    followersCount,
    previousFollowersCount:previousFollowers,
    followersDelta:followersCount&&previousFollowers?followersCount-previousFollowers:null,
    topTerms:terms,
    metrics:{medianEngagement:median(engagement)},
    recommendedPostTimes:postTimes,
    diagnosis:snapshot.error?["Instagram sem dados completos nesta rodada."]:["Usar os melhores horários e reaproveitar mecanismos dos conteúdos acima da mediana sem copiar o criativo."],
    skills:["ig-viral","ig-audit","ig-profile","lead-hunter"]
  };
  await recordAgentExecution(env,client,"RADAR",{
    function:"trend-profile-scan",trigger:options.trigger,startedAt,
    status:snapshot.error&&!(snapshot.items||[]).length?"warning":"success",
    model:"instagram-api+local-rules",quantity:(snapshot.items||[]).length+ledger.length,
    message:(snapshot.items||[]).length?"RADAR analisou o histórico real da conta e recalculou horários.":"RADAR analisou o histórico local; aguardando mais dados do Instagram.",
    metadata:{source:snapshot.source,apiError:snapshot.error||"",recommendedPostTimes:postTimes,topTerms:terms}
  });
  await patchAgentCoreState(env,client.id,{radar:output});
  return output;
}

async function runStrategist(env,client,context,options) {
  const startedAt=new Date().toISOString();
  const profile=postingProfile(client);
  const ledger=await ledgerRows(env,client.id,200);
  const leads=await leadHunterSummary(env,client.id).catch(()=>({total:0,hot:0,warm:0,cold:0}));
  const radar=context.radar||{};
  const themes=[profile.morningTheme,profile.afternoonTheme,profile.eveningTheme];
  const plan={
    primaryKpi:"followers",
    secondaryKpis:["shares","saves","profile_visits","reach"],
    growthMode:"growth",
    recommendedPostTimes:Array.isArray(radar.recommendedPostTimes)&&radar.recommendedPostTimes.length===3?radar.recommendedPostTimes:(client.config?.postTimes||["09:00","14:00","20:00"]).slice(0,3),
    contentMix:{reels:90,carousel:8,static:2},
    niche:client.niche||"Outro",
    audience:profile.targetAudience,
    objective:profile.contentStrategy,
    tone:profile.tone,
    themes,
    contentFocus:profile.contentFocus,
    cta:profile.cta,
    hashtags:profile.hashtags,
    avoidTopics:profile.avoidTopics,
    radarTerms:Array.isArray(radar.topTerms)?radar.topTerms.slice(0,5):[],
    radarDiagnosis:Array.isArray(radar.diagnosis)?radar.diagnosis.slice(0,5):[],
    metrics:{
      published:ledger.filter(x=>x.status==="published").length,
      failed:ledger.filter(x=>x.status==="failed").length,
      pending:ledger.filter(x=>["pending","correction_requested"].includes(x.approval_status)).length,
      leads
    }
  };
  await recordAgentExecution(env,client,"ESTRATEGISTA",{
    function:options.feedback?"feedback-loop":"content-plan",trigger:options.trigger,startedAt,status:"success",
    model:"instagram-skills",quantity:1,
    message:options.feedback?"Estratégia atualizada após Auditor.":"Plano editorial atualizado com Radar, leads, horários e nicho.",
    metadata:{recommendedPostTimes:plan.recommendedPostTimes,leads}
  });
  await patchAgentCoreState(env,client.id,{strategy:plan});
  return plan;
}

async function runCreator(env,client,strategy,options) {
  const startedAt=new Date().toISOString();
  const config=normalizeAgentCoreConfig(client);
  const times=(Array.isArray(strategy?.recommendedPostTimes)&&strategy.recommendedPostTimes.length?strategy.recommendedPostTimes:(client.config?.postTimes||["09:00","14:00","20:00"])).slice(0,3);
  const themes=Array.isArray(strategy?.themes)&&strategy.themes.length?strategy.themes:["Descoberta","Utilidade","Comunidade"];
  const created=[];
  for(let index=0;index<times.length;index++){
    const time=times[index];
    const scheduledFor=scheduleIso(time,index);
    const day=localDay(scheduledFor);
    const id="agentcore:"+client.id+":"+day+":"+String(time).replace(":","");
    const exists=await env.DB.prepare("SELECT id FROM post_ledger WHERE id=?1 LIMIT 1").bind(id).first();
    if(exists)continue;
    const theme=String(themes[index%themes.length]||"Conteúdo");
    const hook=index===0?"Você provavelmente ainda não viu isso hoje.":index===1?"Salva isso porque você vai querer lembrar depois.":"Qual desses você escolheria hoje?";
    const tags=String(strategy?.hashtags||"").trim().split(/\s+/).filter(Boolean).slice(0,5).join(" ");
    const caption=[hook,"",theme+". "+String(strategy?.contentFocus||"Conteúdo relevante para o público.")+".","",String(strategy?.cta||'Comente "QUERO" para saber mais'),tags?"":null,tags||null].filter(x=>x!==null).join("\n").slice(0,2200);
    const approval=config.autoPublish&&!config.approvalRequired?"approved":"pending";
    const payload={
      clientName:client.name||client.id,
      instagram:client.instagram||"",
      imageUrl:"",
      title:theme.slice(0,160),
      source:"agent-core:creator",
      model:"instagram-skill-layer",
      retryCount:0,
      intelligence:{format:index===0?"reel":index===1?"carousel":"story",skill:index===0?"ig-reel":index===1?"ig-carousel":"ig-story"}
    };
    await env.DB.prepare(
      "INSERT INTO post_ledger(id,client_id,scheduled_for,scheduled_hour,status,approval_status,media_id,caption,image_object_key,error,cost_usd,payload_json,created_at,updated_at) VALUES(?1,?2,?3,?4,'ready',?5,'',?6,'','',0,?7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
    ).bind(id,client.id,scheduledFor,time,approval,caption,JSON.stringify(payload)).run();
    created.push({id,scheduledFor,scheduledHour:time,approvalStatus:approval,title:theme,caption,...payload});
  }
  await recordAgentExecution(env,client,"CREATOR",{
    function:"multi-format-draft-generation",trigger:options.trigger,startedAt,status:"success",
    model:"instagram-skill-layer",quantity:created.length,
    message:created.length?created.length+" pauta(s) criadas para os melhores horários.":"Agenda já preparada; nenhuma pauta duplicada criada.",
    metadata:{approvalRequired:config.approvalRequired,autoPublish:config.autoPublish,draftIds:created.map(x=>x.id)}
  });
  return created;
}

async function runPublisher(env,client,options) {
  const startedAt=new Date().toISOString();
  const rows=await env.DB.prepare(
    "SELECT id,scheduled_for,status,approval_status,caption,payload_json FROM post_ledger WHERE client_id=?1 AND status IN ('ready','scheduled','failed') AND (scheduled_for IS NULL OR scheduled_for<=?2) ORDER BY COALESCE(scheduled_for,created_at) ASC LIMIT 8"
  ).bind(client.id,new Date().toISOString()).all();
  let published=0,failed=0,awaitingApproval=0,awaitingMedia=0;
  for(const row of rows?.results||[]){
    if(String(row.approval_status)!=="approved"){awaitingApproval+=1;continue;}
    const payload=parseJson(row.payload_json,{});
    const imageUrl=String(payload.imageUrl||payload.publicImageUrl||"");
    if(!imageUrl){awaitingMedia+=1;continue;}
    try{
      await env.DB.prepare("UPDATE post_ledger SET status='publishing',error='',updated_at=CURRENT_TIMESTAMP WHERE id=?1").bind(row.id).run();
      const result=await publishInstagramImage(env,client.id,imageUrl,String(row.caption||""));
      payload.permalink=result.permalink||"";
      payload.publishedAt=new Date().toISOString();
      payload.containerId=result.containerId||"";
      payload.retryCount=0;
      await env.DB.prepare("UPDATE post_ledger SET status='published',media_id=?2,error='',payload_json=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1")
        .bind(row.id,String(result.mediaId||""),JSON.stringify(payload)).run();
      published+=1;
    }catch(error){
      payload.retryCount=Math.max(0,Number(payload.retryCount||0))+1;
      payload.lastPublishAttemptAt=new Date().toISOString();
      await env.DB.prepare("UPDATE post_ledger SET status='failed',error=?2,payload_json=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1")
        .bind(row.id,String(error?.message||error).slice(0,900),JSON.stringify(payload)).run();
      failed+=1;
    }
  }
  await recordAgentExecution(env,client,"PUBLISHER",{
    function:"queue-sweep",trigger:options.trigger,startedAt,status:failed?"warning":"success",
    model:"local-rules+meta-api",quantity:(rows?.results||[]).length,
    message:published+" publicada(s), "+awaitingApproval+" aguardando aprovação, "+awaitingMedia+" aguardando mídia, "+failed+" falha(s).",
    metadata:{published,failed,awaitingApproval,awaitingMedia}
  });
  return {published,failed,awaitingApproval,awaitingMedia};
}

async function runAuditor(env,client,options) {
  const startedAt=new Date().toISOString();
  const [snapshot,ledger]=await Promise.all([instagramSnapshot(env,client),ledgerRows(env,client.id,100)]);
  const engagements=(snapshot.items||[]).map(item=>({id:item.id,caption:item.caption,mediaType:item.mediaType,engagement:Number(item.likeCount||0)+Number(item.commentsCount||0)*2,permalink:item.permalink}));
  const baseline=median(engagements.map(x=>x.engagement));
  const top=[...engagements].sort((a,b)=>b.engagement-a.engagement)[0]||null;
  const output={
    source:snapshot.source,
    baseline,
    topMedia:top,
    published:ledger.filter(x=>x.status==="published").length,
    failed:ledger.filter(x=>x.status==="failed").length,
    feedback:top?"Reaproveitar o mecanismo do conteúdo acima da mediana sem copiar texto ou visual.":"Continuar coletando dados e testando ganchos e formatos.",
    skills:["ig-human","ig-audit"]
  };
  await recordAgentExecution(env,client,"AUDITOR",{
    function:"performance-human-review",trigger:options.trigger,startedAt,
    status:snapshot.error&&!(snapshot.items||[]).length?"warning":"success",
    model:"instagram-skills+instagram-api",quantity:(snapshot.items||[]).length||ledger.length,
    message:"AUDITOR comparou o desempenho recente com a mediana da própria conta.",
    metadata:{source:snapshot.source,published:output.published,failed:output.failed,apiError:snapshot.error||""}
  });
  await patchAgentCoreState(env,client.id,{auditor:output});
  return output;
}

async function runOdin(env,client,options) {
  const startedAt=new Date().toISOString();
  const [summary,leads]=await Promise.all([
    leadHunterSummary(env,client.id).catch(()=>({total:0,hot:0,warm:0,cold:0,needsHuman:0})),
    leadsForClient(env,client.id,200).catch(()=>[])
  ]);
  const hot=leads.filter(lead=>lead.temperature==="hot"||lead.needsHuman||String(lead.intent||"").toUpperCase()==="QUERO").slice(0,30);
  const questions=leads.filter(lead=>String(lead.lastMessage||"").includes("?")).slice(0,10);
  const output={source:"cloudflare-d1",summary,priority:hot,questionsForContent:questions,skills:["ig-comment","ig-reply","ig-dm","lead-scoring"]};
  await recordAgentExecution(env,client,"ODIN",{
    function:"lead-comment-dm-triage",trigger:options.trigger,startedAt,status:"success",
    model:"instagram-skills",quantity:Number(summary.total||leads.length||0),
    message:hot.length?hot.length+" contato(s) priorizados para atendimento.":"Interações classificadas; nenhuma prioridade comercial imediata.",
    metadata:{summary,questionCount:questions.length}
  });
  await patchAgentCoreState(env,client.id,{odin:output});
  return output;
}

export async function runAgentCoreCycle(env, clientId, options = {}) {
  const client=await getClient(env,clientId);
  if(!client)throw new Error("client_not_found");
  const config=normalizeAgentCoreConfig(client);
  const requested=String(options.agent||"all").toLowerCase();
  if(requested!=="all"&&!AGENT_CORE_MODULES.some(item=>item.id===requested))throw new Error("invalid_agent");
  if(!config.enabled&&options.trigger!=="manual")return {ok:false,skipped:"agent_core_disabled"};

  const result={ok:true,clientId,trigger:options.trigger||"manual",agents:{}};
  const state=await agentCoreState(env,client.id);
  let radar=state.radar||{},strategy=state.strategy||{},auditor=state.auditor||{};
  const run=id=>requested==="all"||requested===id;

  try{
    if(run("radar")&&config.modules.radar)result.agents.radar=radar=await runRadar(env,client,options);
    if(run("estrategista")&&config.modules.estrategista)result.agents.estrategista=strategy=await runStrategist(env,client,{radar,auditor},options);
    if(run("creator")&&config.modules.creator)result.agents.creator=await runCreator(env,client,strategy,options);
    if(run("publisher")&&config.modules.publisher)result.agents.publisher=await runPublisher(env,client,options);
    if(run("auditor")&&config.modules.auditor){
      result.agents.auditor=auditor=await runAuditor(env,client,options);
      if(requested==="all"&&config.modules.estrategista)result.agents.estrategistaFeedback=await runStrategist(env,client,{radar,auditor},{...options,feedback:true});
    }
    if(run("odin")&&config.modules.odin)result.agents.odin=await runOdin(env,client,options);
    const now=new Date().toISOString();
    await patchAgentCoreState(env,client.id,{lastCycleAt:now,nextCycleAt:new Date(Date.now()+config.cycleMinutes*60000).toISOString(),lastCycleStatus:"success",lastCycleError:""});
    return result;
  }catch(error){
    await patchAgentCoreState(env,client.id,{lastCycleAt:new Date().toISOString(),lastCycleStatus:"failed",lastCycleError:String(error?.message||error).slice(0,500)});
    throw error;
  }
}
