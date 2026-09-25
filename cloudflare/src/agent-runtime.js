import { getClient } from "./clients.js";
import { resolveInstagramCredentials } from "./instagram-credentials.js";
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

function normalizeCreativeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textSimilarity(a, b) {
  const left = new Set(normalizeCreativeText(a).split(" ").filter(token => token.length >= 3));
  const right = new Set(normalizeCreativeText(b).split(" ").filter(token => token.length >= 3));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function mediaKey(value) {
  return String(value || "").trim().replace(/[?#].*$/, "");
}

function pickUniqueHook(index, day, terms = [], recentCaptions = []) {
  const subject = String(terms?.[0]?.term || "streaming").trim() || "streaming";
  const bank = [
    "Se você gosta de " + subject + ", presta atenção nisso.",
    "Quase ninguém fala desse detalhe sobre " + subject + ".",
    "Salva isso antes que você esqueça.",
    "Isso pode mudar o que você escolhe para assistir hoje.",
    "Você escolheria qual opção?",
    "Olha isso antes de continuar rolando.",
    "Tem um detalhe aqui que vale compartilhar.",
    "Esse é o tipo de dica que muita gente procura e pouca gente salva."
  ];
  const seed = [...String(day || "")].reduce((sum, ch) => sum + ch.charCodeAt(0), index * 17);
  for (let offset = 0; offset < bank.length; offset++) {
    const hook = bank[(seed + index + offset) % bank.length];
    if (recentCaptions.every(caption => textSimilarity(hook, caption) < 0.55)) return hook;
  }
  return bank[(seed + index) % bank.length];
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
    contentStrategy: current.contentStrategy || "Crescimento acelerado de seguidores + engajamento qualificado",
    targetAudience: current.targetAudience || "Misto",
    contentFocus: current.contentFocus || "Descoberta, entretenimento, utilidade e motivo claro para seguir o perfil",
    morningTheme: current.morningTheme || "Descoberta, curiosidade e gancho compartilhável",
    afternoonTheme: current.afternoonTheme || "Conteúdo útil, entretenimento e valor para salvar",
    eveningTheme: current.eveningTheme || "Comunidade, opinião e motivo para acompanhar o perfil",
    tone: current.tone || "Firme, direto e profissional",
    cta: current.cta || 'Comente "QUERO" para saber mais',
    followerCta: current.followerCta || "Siga o perfil para não perder as próximas indicações.",
    shareCta: current.shareCta || "Envie para alguém que também curte esse tipo de conteúdo.",
    hashtags: current.hashtags || "#Entretenimento #Streaming #FilmesESeries #Dicas",
    avoidTopics: current.avoidTopics || "Venda agressiva, promessas irreais, poluição visual e repetição de criativos",
    growthTargetFollowers: Math.max(1000, Math.min(100000000, Number(current.growthTargetFollowers || 1000000))),
    growthHorizonDays: Math.max(7, Math.min(90, Number(current.growthHorizonDays || 30))),
    standardMediaUrls: Array.isArray(current.standardMediaUrls)
      ? current.standardMediaUrls.map(String).map(v => v.trim()).filter(v => /^https:\/\//i.test(v)).slice(0, 30)
      : []
  };
}

async function instagramSnapshot(env, client) {
  const conn = await resolveInstagramCredentials(env, client.id);
  const token = String(conn?.accessToken || "");
  const igUserId = String(conn?.igUserId || "").trim();
  if (!token || !igUserId) {
    return { source:"local", items:[], followersCount:0, mediaCount:0, error:"instagram_not_connected" };
  }

  const headers = { authorization:"Bearer "+token, accept:"application/json", "user-agent":"NEXUS-AgentCore-Cloudflare/1.0" };
  try {
    const mediaUrl = "https://graph.instagram.com/" + encodeURIComponent(igUserId) + "/media?fields=" + encodeURIComponent("id,caption,timestamp,media_type,like_count,comments_count,permalink,media_url,thumbnail_url") + "&limit=25";
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
      permalink:String(item.permalink||""),
      mediaUrl:String(
        String(item.media_type||"").toUpperCase()==="VIDEO"
          ? (item.thumbnail_url||item.media_url||"")
          : (item.media_url||item.thumbnail_url||"")
      )
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
  const profile=postingProfile(client);
  const [snapshot,ledger,state]=await Promise.all([
    instagramSnapshot(env,client),
    ledgerRows(env,client.id,80),
    agentCoreState(env,client.id)
  ]);
  const captions=[...(snapshot.items||[]).map(x=>x.caption),...ledger.map(x=>x.caption||"")].filter(Boolean);
  const terms=topTerms(captions,12);
  const scored=(snapshot.items||[]).map(item=>({
    ...item,
    engagement:Number(item.likeCount||0)+Number(item.commentsCount||0)*2
  })).sort((a,b)=>b.engagement-a.engagement);
  const engagement=scored.map(item=>item.engagement);
  const postTimes=recommendedTimes(snapshot.items,client.config?.postTimes||["09:00","14:00","20:00"]);
  const previousFollowers=Math.max(0,Number(state?.radar?.followersCount||0));
  const followersCount=Math.max(0,Number(snapshot.followersCount||previousFollowers||0));
  const followerDelta=followersCount&&previousFollowers?followersCount-previousFollowers:0;

  const campaignStartedAt=String(state?.radar?.growthCampaign?.startedAt||startedAt);
  const campaignStartMs=new Date(campaignStartedAt).getTime();
  const elapsedDays=Number.isFinite(campaignStartMs)?Math.max(0,Math.floor((Date.now()-campaignStartMs)/86400000)):0;
  const remainingDays=Math.max(1,profile.growthHorizonDays-elapsedDays);
  const followersNeeded=Math.max(0,profile.growthTargetFollowers-followersCount);
  const dailyFollowersNeeded=Math.ceil(followersNeeded/remainingDays);

  const formatTotals=new Map();
  for(const item of scored){
    const key=String(item.mediaType||"UNKNOWN").toUpperCase();
    const current=formatTotals.get(key)||{format:key,count:0,engagement:0};
    current.count+=1;
    current.engagement+=item.engagement;
    formatTotals.set(key,current);
  }
  const winningFormats=[...formatTotals.values()]
    .map(row=>({...row,averageEngagement:row.count?row.engagement/row.count:0}))
    .sort((a,b)=>b.averageEngagement-a.averageEngagement);

  const output={
    source:snapshot.source,
    scannedMedia:(snapshot.items||[]).length,
    followersCount,
    previousFollowersCount:previousFollowers,
    followersDelta:followerDelta,
    topTerms:terms,
    topMedia:scored.slice(0,5).map(item=>({
      id:item.id,
      mediaType:item.mediaType,
      engagement:item.engagement,
      permalink:item.permalink,
      caption:String(item.caption||"").slice(0,180)
    })),
    winningFormats:winningFormats.slice(0,4),
    metrics:{
      medianEngagement:median(engagement),
      topEngagement:scored[0]?.engagement||0
    },
    growthCampaign:{
      targetFollowers:profile.growthTargetFollowers,
      horizonDays:profile.growthHorizonDays,
      startedAt:campaignStartedAt,
      elapsedDays,
      remainingDays,
      followersNeeded,
      dailyFollowersNeeded,
      lastCycleFollowerDelta:followerDelta
    },
    recommendedPostTimes:postTimes,
    diagnosis:snapshot.error
      ? ["Instagram sem dados completos nesta rodada; manter coleta e não repetir criativos."]
      : [
          "Campanha de crescimento em 30 dias ativa com 3 publicações diárias e horários adaptativos.",
          "Repetição de mídia e legenda recente deve ser bloqueada.",
          "Reaproveitar o mecanismo dos conteúdos vencedores sem reutilizar o mesmo criativo."
        ],
    skills:["ig-viral","ig-audit","ig-profile","lead-hunter"]
  };
  await recordAgentExecution(env,client,"RADAR",{
    function:"growth-30d-scan",trigger:options.trigger,startedAt,
    status:snapshot.error&&!(snapshot.items||[]).length?"warning":"success",
    model:"instagram-api+growth-rules",quantity:(snapshot.items||[]).length+ledger.length,
    message:(snapshot.items||[]).length
      ?"RADAR recalculou ritmo de crescimento, formatos vencedores e horários."
      :"RADAR analisou o histórico local; aguardando mais dados do Instagram.",
    metadata:{
      source:snapshot.source,
      apiError:snapshot.error||"",
      recommendedPostTimes:postTimes,
      topTerms:terms,
      growthCampaign:output.growthCampaign
    }
  });
  await patchAgentCoreState(env,client.id,{radar:output});
  return output;
}

async function runStrategist(env,client,context,options) {
  const startedAt=new Date().toISOString();
  const profile=postingProfile(client);
  const ledger=await ledgerRows(env,client.id,220);
  const leads=await leadHunterSummary(env,client.id).catch(()=>({total:0,hot:0,warm:0,cold:0}));
  const radar=context.radar||{};
  const themes=[profile.morningTheme,profile.afternoonTheme,profile.eveningTheme];
  const plan={
    primaryKpi:"followers",
    secondaryKpis:["shares","saves","profile_visits","reach","comments"],
    growthMode:"aggressive-organic-30d",
    growthCampaign:radar.growthCampaign||{
      targetFollowers:profile.growthTargetFollowers,
      horizonDays:profile.growthHorizonDays
    },
    dailySlots:3,
    adaptiveTiming:true,
    recommendedPostTimes:Array.isArray(radar.recommendedPostTimes)&&radar.recommendedPostTimes.length===3
      ?radar.recommendedPostTimes
      :(client.config?.postTimes||["09:00","14:00","20:00"]).slice(0,3),
    contentMix:{reels:80,carousel:15,static:5},
    niche:client.niche||"Outro",
    audience:profile.targetAudience,
    objective:profile.contentStrategy,
    tone:profile.tone,
    themes,
    contentFocus:profile.contentFocus,
    cta:profile.cta,
    ctaRotation:[profile.followerCta,profile.shareCta,profile.cta],
    hashtags:profile.hashtags,
    avoidTopics:profile.avoidTopics,
    radarTerms:Array.isArray(radar.topTerms)?radar.topTerms.slice(0,8):[],
    radarDiagnosis:Array.isArray(radar.diagnosis)?radar.diagnosis.slice(0,6):[],
    standardMediaUrls:profile.standardMediaUrls,
    antiRepeat:{
      media:true,
      captionSimilarityThreshold:0.72,
      recentWindow:120
    },
    experiments:{
      hookAngles:["curiosidade","utilidade","comunidade"],
      rotateCta:true,
      rotateFormat:true,
      learnFromTop5:true
    },
    metrics:{
      published:ledger.filter(x=>x.status==="published").length,
      failed:ledger.filter(x=>x.status==="failed").length,
      pending:ledger.filter(x=>["pending","correction_requested"].includes(x.approval_status)).length,
      leads
    }
  };
  await recordAgentExecution(env,client,"ESTRATEGISTA",{
    function:options.feedback?"growth-feedback-loop":"growth-30d-plan",trigger:options.trigger,startedAt,status:"success",
    model:"instagram-growth-skills",quantity:1,
    message:options.feedback
      ?"Estratégia ajustada com o desempenho mais recente."
      :"Plano de crescimento de 30 dias atualizado com 3 slots, CTA rotativo e anti-repetição.",
    metadata:{recommendedPostTimes:plan.recommendedPostTimes,leads,growthCampaign:plan.growthCampaign}
  });
  await patchAgentCoreState(env,client.id,{strategy:plan});
  return plan;
}

async function stageOwnInstagramImage(env, clientId, postId, sourceUrl) {
  const url=String(sourceUrl||"").trim();
  if(!env.MEDIA||!/^https:\/\//i.test(url))return "";
  try{
    const response=await fetch(url,{
      headers:{accept:"image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.2","user-agent":"NEXUS-AgentCore-Cloudflare/1.1"},
      signal:AbortSignal.timeout(8000)
    });
    if(!response.ok||!response.body)return "";
    const type=String(response.headers.get("content-type")||"").toLowerCase().split(";")[0].trim();
    if(!type.startsWith("image/"))return "";
    const size=Number(response.headers.get("content-length")||0);
    if(size>10*1024*1024)return "";
    const ext=type.includes("png")?"png":type.includes("webp")?"webp":"jpg";
    const key="posts/"+String(clientId)+"/"+String(postId)+"/auto-"+crypto.randomUUID()+"."+ext;
    const object=await env.MEDIA.put(key,response.body,{
      httpMetadata:{contentType:type||"image/jpeg",cacheControl:"public, max-age=31536000, immutable"},
      customMetadata:{clientId:String(clientId),postId:String(postId),kind:"reused-own-instagram-media"}
    });
    if(!object)return "";
    const origin=String(env.PUBLIC_BASE_URL||"").replace(/\/+$/,"");
    return origin?origin+"/media/"+key:"";
  }catch{
    return "";
  }
}

async function runCreator(env,client,strategy,options) {
  const startedAt=new Date().toISOString();
  const config=normalizeAgentCoreConfig(client);
  const recent=await ledgerRows(env,client.id,Math.max(60,Number(strategy?.antiRepeat?.recentWindow||120)));
  const recentCaptions=recent.map(row=>String(row.caption||"")).filter(Boolean);
  const usedPublishedMedia=new Set(
    recent.filter(row=>row.status==="published")
      .map(row=>mediaKey(row.payload?.imageUrl||row.payload?.publicImageUrl||""))
      .filter(Boolean)
  );
  const queuedUnusedMedia=recent
    .filter(row=>row.status!=="published")
    .map(row=>String(row.payload?.imageUrl||row.payload?.publicImageUrl||"").trim())
    .filter(url=>/^https:\/\//i.test(url)&&!usedPublishedMedia.has(mediaKey(url)));
  const configuredMedia=Array.isArray(strategy?.standardMediaUrls)?strategy.standardMediaUrls:[];
  const mediaPool=[...new Set([...configuredMedia,...queuedUnusedMedia])]
    .filter(url=>/^https:\/\//i.test(String(url))&&!usedPublishedMedia.has(mediaKey(url)));

  const times=(Array.isArray(strategy?.recommendedPostTimes)&&strategy.recommendedPostTimes.length
    ?strategy.recommendedPostTimes
    :(client.config?.postTimes||["09:00","14:00","20:00"])).slice(0,3);
  const themes=Array.isArray(strategy?.themes)&&strategy.themes.length
    ?strategy.themes
    :["Descoberta","Utilidade","Comunidade"];
  const ctas=Array.isArray(strategy?.ctaRotation)&&strategy.ctaRotation.length
    ?strategy.ctaRotation
    :[strategy?.cta||'Comente "QUERO" para saber mais'];
  const created=[];

  for(let index=0;index<times.length;index++){
    const time=times[index];
    const scheduledFor=scheduleIso(time,index);
    const day=localDay(scheduledFor);
    const id="agentcore:"+client.id+":"+day+":"+String(time).replace(":","");
    const exists=await env.DB.prepare("SELECT id FROM post_ledger WHERE id=?1 LIMIT 1").bind(id).first();
    if(exists)continue;

    const theme=String(themes[index%themes.length]||"Conteúdo");
    const hook=pickUniqueHook(index,day,strategy?.radarTerms||[],recentCaptions);
    const cta=String(ctas[index%ctas.length]||strategy?.cta||'Comente "QUERO" para saber mais');
    const tags=String(strategy?.hashtags||"").trim().split(/\s+/).filter(Boolean).slice(0,5).join(" ");
    let caption=[
      hook,
      "",
      theme+". "+String(strategy?.contentFocus||"Conteúdo relevante para o público.")+".",
      "",
      cta,
      tags?"":null,
      tags||null
    ].filter(x=>x!==null).join("\n").slice(0,2200);

    if(recentCaptions.some(previous=>textSimilarity(caption,previous)>=Number(strategy?.antiRepeat?.captionSimilarityThreshold||0.72))){
      caption=[
        hook,
        "",
        "Ângulo "+(index+1)+": "+theme+". "+String(strategy?.contentFocus||"Conteúdo relevante para o público.")+".",
        "",
        cta,
        tags?"":null,
        tags||null
      ].filter(x=>x!==null).join("\n").slice(0,2200);
    }

    const approval=config.autoPublish&&!config.approvalRequired?"approved":"pending";
    const imageUrl=String(mediaPool.shift()||"");
    const payload={
      clientName:client.name||client.id,
      instagram:client.instagram||"",
      imageUrl,
      title:theme.slice(0,160),
      source:"agent-core:creator-growth-30d",
      model:"instagram-growth-skill-layer",
      retryCount:0,
      creativeFingerprint:normalizeCreativeText([day,index,hook,theme,cta].join("|")).slice(0,240),
      growthCampaign:strategy?.growthCampaign||null,
      intelligence:{
        format:index===0?"reel":index===1?"carousel":"story",
        skill:index===0?"ig-reel":index===1?"ig-carousel":"ig-story",
        mediaSource:imageUrl?"standard-media-pool":"awaiting-unique-media",
        antiRepeat:true
      }
    };
    await env.DB.prepare(
      "INSERT INTO post_ledger(id,client_id,scheduled_for,scheduled_hour,status,approval_status,media_id,caption,image_object_key,error,cost_usd,payload_json,created_at,updated_at) VALUES(?1,?2,?3,?4,'ready',?5,'',?6,'','',0,?7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
    ).bind(id,client.id,scheduledFor,time,approval,caption,JSON.stringify(payload)).run();

    created.push({id,scheduledFor,scheduledHour:time,approvalStatus:approval,title:theme,caption,...payload});
    recentCaptions.push(caption);
    if(imageUrl)usedPublishedMedia.add(mediaKey(imageUrl));
  }

  await recordAgentExecution(env,client,"CREATOR",{
    function:"growth-30d-creative-generation",trigger:options.trigger,startedAt,status:"success",
    model:"instagram-growth-skill-layer",quantity:created.length,
    message:created.length
      ?created.length+" pauta(s) únicas criadas com CTA e gancho rotativos."
      :"Agenda já preparada; nenhuma pauta duplicada criada.",
    metadata:{
      approvalRequired:config.approvalRequired,
      autoPublish:config.autoPublish,
      draftIds:created.map(x=>x.id),
      uniqueMediaAvailable:mediaPool.length
    }
  });
  return created;
}

async function runPublisher(env,client,options) {
  const startedAt=new Date().toISOString();
  const config=normalizeAgentCoreConfig(client);
  const rows=await env.DB.prepare(
    "SELECT id,scheduled_for,status,approval_status,caption,payload_json FROM post_ledger WHERE client_id=?1 AND status IN ('ready','scheduled','failed') AND (scheduled_for IS NULL OR scheduled_for<=?2) ORDER BY COALESCE(scheduled_for,created_at) ASC LIMIT 8"
  ).bind(client.id,new Date().toISOString()).all();

  const recentPublished=await ledgerRows(env,client.id,150);
  const usedMedia=new Set(
    recentPublished.filter(row=>row.status==="published")
      .map(row=>mediaKey(row.payload?.imageUrl||row.payload?.publicImageUrl||""))
      .filter(Boolean)
  );
  const usedCaptions=recentPublished.filter(row=>row.status==="published").map(row=>String(row.caption||"")).filter(Boolean);

  let published=0,failed=0,awaitingApproval=0,awaitingMedia=0,repairedApproval=0;
  let duplicateMediaBlocked=0,duplicateCaptionBlocked=0;

  for(const row of rows?.results||[]){
    let approval=String(row.approval_status||"pending");
    const payload=parseJson(row.payload_json,{});

    if(approval!=="approved"&&config.autoPublish&&!config.approvalRequired){
      await env.DB.prepare(
        "UPDATE post_ledger SET approval_status='approved',updated_at=CURRENT_TIMESTAMP WHERE id=?1"
      ).bind(row.id).run();
      approval="approved";
      repairedApproval+=1;
    }

    if(approval!=="approved"){
      awaitingApproval+=1;
      continue;
    }

    let imageUrl=String(payload.imageUrl||payload.publicImageUrl||"").trim();
    if(!imageUrl){
      await env.DB.prepare(
        "UPDATE post_ledger SET error='unique_media_required',updated_at=CURRENT_TIMESTAMP WHERE id=?1"
      ).bind(row.id).run();
      awaitingMedia+=1;
      continue;
    }

    const key=mediaKey(imageUrl);
    if(key&&usedMedia.has(key)){
      payload.blockedDuplicateMedia=imageUrl;
      payload.imageUrl="";
      await env.DB.prepare(
        "UPDATE post_ledger SET payload_json=?2,error='duplicate_media_blocked',updated_at=CURRENT_TIMESTAMP WHERE id=?1"
      ).bind(row.id,JSON.stringify(payload)).run();
      duplicateMediaBlocked+=1;
      awaitingMedia+=1;
      continue;
    }

    const caption=String(row.caption||"");
    if(usedCaptions.some(previous=>textSimilarity(previous,caption)>=0.92)){
      await env.DB.prepare(
        "UPDATE post_ledger SET error='duplicate_caption_blocked',updated_at=CURRENT_TIMESTAMP WHERE id=?1"
      ).bind(row.id).run();
      duplicateCaptionBlocked+=1;
      continue;
    }

    try{
      await env.DB.prepare("UPDATE post_ledger SET status='publishing',error='',updated_at=CURRENT_TIMESTAMP WHERE id=?1").bind(row.id).run();
      const result=await publishInstagramImage(env,client.id,imageUrl,caption);
      payload.permalink=result.permalink||"";
      payload.publishedAt=new Date().toISOString();
      payload.containerId=result.containerId||"";
      payload.retryCount=0;
      payload.antiRepeatVerifiedAt=new Date().toISOString();
      await env.DB.prepare("UPDATE post_ledger SET status='published',media_id=?2,error='',payload_json=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1")
        .bind(row.id,String(result.mediaId||""),JSON.stringify(payload)).run();
      published+=1;
      if(key)usedMedia.add(key);
      usedCaptions.push(caption);
    }catch(error){
      payload.retryCount=Math.max(0,Number(payload.retryCount||0))+1;
      payload.lastPublishAttemptAt=new Date().toISOString();
      await env.DB.prepare("UPDATE post_ledger SET status='failed',error=?2,payload_json=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1")
        .bind(row.id,String(error?.message||error).slice(0,900),JSON.stringify(payload)).run();
      failed+=1;
    }
  }

  const warning=failed||duplicateMediaBlocked||duplicateCaptionBlocked;
  await recordAgentExecution(env,client,"PUBLISHER",{
    function:"growth-30d-safe-publish",trigger:options.trigger,startedAt,status:warning?"warning":"success",
    model:"anti-repeat+meta-api",quantity:(rows?.results||[]).length,
    message:published+" publicada(s), "+awaitingApproval+" aguardando aprovação, "+awaitingMedia+" aguardando mídia única, "+failed+" falha(s).",
    metadata:{
      published,failed,awaitingApproval,awaitingMedia,repairedApproval,
      duplicateMediaBlocked,duplicateCaptionBlocked
    }
  });
  return {published,failed,awaitingApproval,awaitingMedia,repairedApproval,duplicateMediaBlocked,duplicateCaptionBlocked};
}

async function runAuditor(env,client,options) {
  const startedAt=new Date().toISOString();
  const [snapshot,ledger,state]=await Promise.all([
    instagramSnapshot(env,client),
    ledgerRows(env,client.id,140),
    agentCoreState(env,client.id)
  ]);
  const engagements=(snapshot.items||[]).map(item=>({
    id:item.id,
    caption:item.caption,
    mediaType:item.mediaType,
    engagement:Number(item.likeCount||0)+Number(item.commentsCount||0)*2,
    permalink:item.permalink
  }));
  const baseline=median(engagements.map(x=>x.engagement));
  const ranked=[...engagements].sort((a,b)=>b.engagement-a.engagement);
  const top=ranked[0]||null;
  const published=ledger.filter(x=>x.status==="published").length;
  const failed=ledger.filter(x=>x.status==="failed").length;
  const duplicateBlocks=ledger.filter(x=>["duplicate_media_blocked","duplicate_caption_blocked"].includes(String(x.error||""))).length;
  const output={
    source:snapshot.source,
    baseline,
    topMedia:top,
    top5:ranked.slice(0,5),
    published,
    failed,
    duplicateBlocks,
    growthCampaign:state?.radar?.growthCampaign||null,
    feedback:top
      ?"Reaproveitar estrutura, ângulo e formato dos vencedores sem copiar mídia ou legenda."
      :"Continuar coletando dados e testando ganchos distintos.",
    skills:["ig-human","ig-audit","growth-loop"]
  };
  await recordAgentExecution(env,client,"AUDITOR",{
    function:"growth-30d-performance-review",trigger:options.trigger,startedAt,
    status:snapshot.error&&!(snapshot.items||[]).length?"warning":"success",
    model:"instagram-skills+growth-audit",quantity:(snapshot.items||[]).length||ledger.length,
    message:"AUDITOR comparou desempenho, duplicidade e ritmo da campanha de crescimento.",
    metadata:{
      source:snapshot.source,
      published,
      failed,
      duplicateBlocks,
      apiError:snapshot.error||"",
      growthCampaign:output.growthCampaign
    }
  });
  await patchAgentCoreState(env,client.id,{auditor:output});
  return output;
}

async function runOdin(env,client,options) {
  const startedAt=new Date().toISOString();
  const [summary,leads,state]=await Promise.all([
    leadHunterSummary(env,client.id).catch(()=>({total:0,hot:0,warm:0,cold:0,needsHuman:0})),
    leadsForClient(env,client.id,300).catch(()=>[]),
    agentCoreState(env,client.id)
  ]);
  const ranked=[...leads].sort((a,b)=>Number(b.score||0)-Number(a.score||0));
  const priority=ranked.filter(lead=>
    lead.temperature==="hot"||
    lead.needsHuman||
    String(lead.intent||"").toUpperCase()==="QUERO"||
    Number(lead.score||0)>=55
  ).slice(0,40);
  const questions=ranked.filter(lead=>String(lead.lastMessage||"").includes("?")).slice(0,20);
  const growthOpportunities=ranked.filter(lead=>
    Number(lead.score||0)>=35||
    String(lead.lastMessage||"").includes("?")
  ).slice(0,60);

  const output={
    source:"cloudflare-d1",
    summary,
    priority,
    questionsForContent:questions,
    growthOpportunities,
    growthCampaign:state?.radar?.growthCampaign||null,
    responsePolicy:{
      mode:"inbound-only",
      unsolicitedDm:false,
      prioritize:["QUERO","pergunta","preço","como funciona","recomendação"]
    },
    skills:["ig-comment","ig-reply","ig-dm","lead-scoring","growth-signals"]
  };
  await recordAgentExecution(env,client,"ODIN",{
    function:"growth-30d-inbound-triage",trigger:options.trigger,startedAt,status:"success",
    model:"instagram-growth-signals",quantity:Number(summary.total||leads.length||0),
    message:priority.length
      ?priority.length+" interação(ões) prioritárias e "+questions.length+" pergunta(s) viraram sinais de conteúdo."
      :"Interações classificadas; nenhuma prioridade imediata.",
    metadata:{
      summary,
      priorityCount:priority.length,
      questionCount:questions.length,
      growthOpportunityCount:growthOpportunities.length,
      growthCampaign:output.growthCampaign
    }
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
