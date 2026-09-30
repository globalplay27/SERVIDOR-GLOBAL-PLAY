import { visualApproval } from "./visual-review.js";
import { mediaFingerprint } from "./media-fingerprint.js";
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
import { runExtendedAgents } from "./extended-agents.js";
import { consultGrowthAI } from "./ai-growth.js";
import { generateOriginalMedia } from "./media-generation.js";
import { isPublishingWindow, publishingGate, sameSaoPauloDay } from "./publishing-policy.js";

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
  const configuredMedia = Array.isArray(current.standardMediaUrls)
    ? current.standardMediaUrls.map(String).map(v => v.trim())
      .filter(v => /^https:\/\//i.test(v)
        && !/\/assets\/ragnar\/nordic-cinema-0[123]\.png(?:[?#]|$)/i.test(v))
      .slice(0, 30)
    : [];
  const isGlobal = String(client?.id || "") === "globalplay-streaming";
  const isRagnar = String(client?.id || "") === "ragnar-one";
  return {
    contentStrategy: isGlobal
      ? "Crescimento orgânico com entretenimento familiar e campanha visual de desenhos 3D até 12/10/2026"
      : isRagnar
        ? "Crescimento orgânico com entretenimento premium e identidade nórdica original"
        : (current.contentStrategy || "Crescimento acelerado de seguidores + engajamento qualificado"),
    targetAudience: isGlobal ? "Famílias e fãs de entretenimento" : isRagnar ? "Adultos fãs de entretenimento e estética nórdica" : (current.targetAudience || "Misto"),
    contentFocus: isGlobal
      ? "Desenhos, filmes, séries e momentos de diversão em família com mensagem simples e visual alegre"
      : isRagnar
        ? "Entretenimento premium em casa, aventura e atmosfera nórdica original com variedade visual"
        : (current.contentFocus || "Conteúdo útil e específico para o público"),
    morningTheme: isGlobal ? "Diversão em família e desenhos" : isRagnar ? "Aventura nórdica original" : (current.morningTheme || "Descoberta e curiosidade"),
    afternoonTheme: isGlobal ? "Escolhas para assistir com a família" : isRagnar ? "Entretenimento premium no sofá" : (current.afternoonTheme || "Conteúdo útil para salvar"),
    eveningTheme: isGlobal ? "Sessão em família, pipoca e entretenimento" : isRagnar ? "Noite de cinema com atmosfera nórdica" : (current.eveningTheme || "Comunidade e opinião"),
    tone: isGlobal ? "Alegre, familiar, simples e direto" : isRagnar ? "Premium, convidativo e direto" : (current.tone || "Firme, direto e profissional"),
    cta: 'Comente "QUERO" para saber mais.',
    followerCta: isGlobal ? "Siga a Global Play para ver as próximas sugestões." : isRagnar ? "Siga a Ragnar One para acompanhar as próximas sagas." : (current.followerCta || "Siga o perfil para não perder as próximas indicações."),
    shareCta: isGlobal ? "Envie para alguém que vai curtir essa sessão em família." : isRagnar ? "Envie para quem também curte esse clima de aventura." : (current.shareCta || "Envie para alguém que também curte esse tipo de conteúdo."),
    hashtags: isGlobal ? "#GlobalPlay #Streaming #Entretenimento #Familia #Desenhos" : isRagnar ? "#RagnarOne #Streaming #Entretenimento #CinemaEmCasa #Nordico" : (current.hashtags || "#Entretenimento #Streaming #Dicas"),
    avoidTopics: "Texto genérico, repetição de criativos, poluição visual, tela vazia, collage/split-screen, promessas irreais e referências protegidas",
    creativeRotation: String(client?.id || "") === "globalplay-streaming"
      ? {
          enabled:true,
          mode:"seasonal-until-2026-10-12",
          seasonalCampaign:{name:"Dia das Crianças",start:"2026-09-27",endInclusive:"2026-10-12",scope:"globalplay-streaming-only",theme:"3d-cartoon-entertainment",after:"performance-adaptive"},
          illustratedTheme:{
            name:"3D cartoon entertainment",
            frequency:"Use as the primary visual theme on every Global Play creative through 2026-10-12 inclusive. From 2026-10-13 return automatically to performance-adaptive rotation.",
            direction:"Original premium 3D cartoon/animated illustration, warm home entertainment environment, one coherent scene, expressive generic characters, filled TV screen with generic entertainment categories, strong Global Play branding and highly legible offer/CTA.",
            avoid:"Do not copy Disney, Pixar or any named studio style; no recognizable copyrighted characters, movie/series frames, team logos, split screens, collages or excessive visual clutter."
          },
          evaluation:["engagement","likes","comments","shares","follower_growth"]
        }
      : null,
    brandSafety: String(client?.id || "") === "ragnar-one"
      ? {
          brandIdentity: "Ragnar One é uma marca própria e independente.",
          visualDirection: "Estética nórdica/viking genérica, original e não associada a qualquer série, filme, ator ou personagem.",
          prohibitedReferences: ["Vikings (série)", "Ragnar Lothbrok", "atores da série", "personagens da série", "logos oficiais", "cenas ou frames da série", "figurinos ou composições reconhecíveis copiados da obra"],
          rule: "Criar somente conteúdo original. Não imitar rosto, personagem, cena, logo, pôster, figurino específico ou material promocional protegido."
        }
      : null,
    growthTargetFollowers: Math.max(1000, Math.min(100000000, Number(current.growthTargetFollowers || 1000000))),
    growthHorizonDays: Math.max(7, Math.min(90, Number(current.growthHorizonDays || 30))),
    standardMediaUrls: configuredMedia
  };
}

async function instagramMediaInsights(mediaId, headers) {
  const metrics = ["reach","views","saved","shares","total_interactions"];
  const out = {};
  for (const metric of metrics) {
    try {
      const url = "https://graph.instagram.com/" + encodeURIComponent(mediaId) + "/insights?metric=" + encodeURIComponent(metric);
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      const payload = await response.json().catch(()=>({}));
      if (!response.ok) continue;
      const row = Array.isArray(payload?.data) ? payload.data[0] : null;
      const value = Array.isArray(row?.values) ? row.values[0]?.value : row?.value;
      const number = Number(value);
      if (Number.isFinite(number)) out[metric] = Math.max(0, number);
    } catch {}
  }
  return out;
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
    const mediaResponse = await fetch(mediaUrl,{headers,signal:AbortSignal.timeout(8000)});
    const mediaPayload = await mediaResponse.json().catch(()=>({}));
    if(!mediaResponse.ok)throw new Error(String(mediaPayload?.error?.message || "instagram_media_"+mediaResponse.status));
    const baseItems = Array.isArray(mediaPayload.data) ? mediaPayload.data.map(item=>({
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
    // The free Worker budget is 50 external subrequests per invocation. Radar
    // and Auditor both call this function in a full cycle, so inspect only
    // three recent media in detail while retaining basic data for all 25.
    const items = await Promise.all(baseItems.map(async (item,index)=>({
      ...item,
      insights: item.id && index < 3 ? await instagramMediaInsights(item.id, headers) : {}
    })));

    let followersCount=0, mediaCount=items.length, username=String(conn?.username||"");
    try {
      const profileUrl="https://graph.instagram.com/"+encodeURIComponent(igUserId)+"?fields="+encodeURIComponent("username,followers_count,media_count");
      const profileResponse=await fetch(profileUrl,{headers,signal:AbortSignal.timeout(8000)});
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

function recommendedTimes(items) {
  // Fully adaptive timing for autonomous accounts: historical engagement decides
  // the posting windows. No configured clock slots are allowed to override RADAR.
  const configured = [];
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
  // Exploration windows are deliberately different from the former 09/12/18
  // schedule. As engagement data accumulates, ranked historical performance wins.
  for(const h of [10,15,21,8,13,19,23]){
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
  const scored=(snapshot.items||[]).map(item=>{
    const insights=item.insights&&typeof item.insights==="object"?item.insights:{};
    const engagement=
      Number(item.likeCount||0)+
      Number(item.commentsCount||0)*2+
      Number(insights.saved||0)*3+
      Number(insights.shares||0)*4+
      Number(insights.total_interactions||0);
    return {...item,engagement};
  }).sort((a,b)=>b.engagement-a.engagement);
  const engagement=scored.map(item=>item.engagement);
  const postTimes=recommendedTimes(snapshot.items);
  const previousFollowers=Math.max(0,Number(state?.radar?.followersCount||0));
  const followersCount=Math.max(0,Number(snapshot.followersCount||previousFollowers||0));
  const followerDelta=followersCount&&previousFollowers?followersCount-previousFollowers:0;

  const leadSummary=await leadHunterSummary(env,client.id).catch(()=>({total:0,hot:0,warm:0,cold:0}));

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

  const aiGrowth=await consultGrowthAI(env,client,{
    metrics:{
      medianEngagement:median(engagement),
      topEngagement:scored[0]?.engagement||0,
      reach:scored.reduce((sum,item)=>sum+Number(item.insights?.reach||0),0),
      views:scored.reduce((sum,item)=>sum+Number(item.insights?.views||0),0),
      saves:scored.reduce((sum,item)=>sum+Number(item.insights?.saved||0),0),
      shares:scored.reduce((sum,item)=>sum+Number(item.insights?.shares||0),0),
      totalInteractions:scored.reduce((sum,item)=>sum+Number(item.insights?.total_interactions||0),0)
    },
    followersCount,
    followersDelta,
    recommendedPostTimes:postTimes,
    topMedia:scored.slice(0,5).map(item=>({
      mediaType:item.mediaType,engagement:item.engagement,
      caption:String(item.caption||"").slice(0,260),
      insights:item.insights||{}
    })),
    recentCaptions:captions.slice(0,10),
    leadSummary,
    profile:{
      contentStrategy:profile.contentStrategy,
      contentFocus:profile.contentFocus,
      tone:profile.tone,
      hashtags:profile.hashtags,
      avoidTopics:profile.avoidTopics,
      creativeRotation:profile.creativeRotation,
      brandSafety:profile.brandSafety
    }
  },state?.aiGrowth||null);

  const output={
    source:snapshot.source,
    scannedAt:new Date().toISOString(),
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
      caption:String(item.caption||"").slice(0,180),
      insights:item.insights||{}
    })),
    mediaCandidates:scored
      .filter(item=>/^https:\/\//i.test(String(item.mediaUrl||"")))
      .map(item=>({id:item.id,mediaUrl:item.mediaUrl,mediaType:item.mediaType,timestamp:item.timestamp,engagement:item.engagement}))
      .slice(0,25),
    winningFormats:winningFormats.slice(0,4),
    metrics:{
      medianEngagement:median(engagement),
      topEngagement:scored[0]?.engagement||0,
      reach:scored.reduce((sum,item)=>sum+Number(item.insights?.reach||0),0),
      views:scored.reduce((sum,item)=>sum+Number(item.insights?.views||0),0),
      saves:scored.reduce((sum,item)=>sum+Number(item.insights?.saved||0),0),
      shares:scored.reduce((sum,item)=>sum+Number(item.insights?.shares||0),0),
      totalInteractions:scored.reduce((sum,item)=>sum+Number(item.insights?.total_interactions||0),0)
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
    aiGrowth,
    skills:["ig-viral","ig-audit","ig-profile","lead-hunter","openai-growth-intelligence"]
  };
  await recordAgentExecution(env,client,"RADAR",{
    function:"growth-30d-scan",trigger:options.trigger,startedAt,
    status:snapshot.error&&!(snapshot.items||[]).length?"warning":"success",
    model:"instagram-api+openai-growth-brain",quantity:(snapshot.items||[]).length+ledger.length,
    message:(snapshot.items||[]).length
      ?"RADAR recalculou ritmo de crescimento, formatos vencedores e horários."
      :"RADAR analisou o histórico local; aguardando mais dados do Instagram.",
    metadata:{
      source:snapshot.source,
      apiError:snapshot.error||"",
      recommendedPostTimes:postTimes,
      topTerms:terms,
      growthCampaign:output.growthCampaign,
      aiModel:aiGrowth?.model||"",
      aiCached:Boolean(aiGrowth?.cached),
      aiError:aiGrowth?.error||""
    }
  });
  await patchAgentCoreState(env,client.id,{radar:output,aiGrowth});
  return output;
}

async function runStrategist(env,client,context,options) {
  const startedAt=new Date().toISOString();
  const profile=postingProfile(client);
  const [ledger,leads,state]=await Promise.all([
    ledgerRows(env,client.id,220),
    leadHunterSummary(env,client.id).catch(()=>({total:0,hot:0,warm:0,cold:0})),
    agentCoreState(env,client.id)
  ]);
  const radar=context.radar||state.radar||{};
  const auditor=context.auditor||state.auditor||{};
  const researcher=state.pesquisador||{};
  const analyst=state.analista||{};
  const growth=state.growth||{};
  const aiGrowth=state.aiGrowth||radar.aiGrowth||{};
  const aiBatch=Array.isArray(aiGrowth.creativeBatch)?aiGrowth.creativeBatch.slice(0,3):[];
  const researchTerms=Array.isArray(aiGrowth.researchOpportunities)&&aiGrowth.researchOpportunities.length
    ? aiGrowth.researchOpportunities.slice(0,8)
    : Array.isArray(researcher.opportunities)
      ? researcher.opportunities.map(item=>String(item?.term||"")).filter(Boolean).slice(0,8)
      : [];
  const themes=aiBatch.length===3
    ? aiBatch.map(item=>String(item?.theme||"")).filter(Boolean).slice(0,3)
    : researchTerms.length
      ? researchTerms.slice(0,3)
      : [profile.morningTheme,profile.afternoonTheme,profile.eveningTheme];
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
      :recommendedTimes([]),
    // The current publisher sends a single image through Instagram Graph.
    // Do not claim a Reel or carousel unless a real media pipeline exists.
    contentMix:{image:100},
    niche:client.niche||"Outro",
    audience:profile.targetAudience,
    objective:profile.contentStrategy,
    tone:profile.tone,
    themes,
    contentFocus:profile.contentFocus,
    cta:profile.cta,
    ctaRotation:[
      profile.cta,
      profile.cta + " " + profile.followerCta,
      profile.cta + " " + profile.shareCta
    ],
    hashtags:profile.hashtags,
    avoidTopics:profile.avoidTopics,
    brandSafety:profile.brandSafety,
    creativeRotation:profile.creativeRotation,
    radarTerms:Array.isArray(radar.topTerms)?radar.topTerms.slice(0,8):[],
    radarDiagnosis:Array.isArray(aiGrowth.diagnosis)&&aiGrowth.diagnosis.length
      ? aiGrowth.diagnosis.slice(0,6)
      : Array.isArray(radar.diagnosis)?radar.diagnosis.slice(0,6):[],
    researchOpportunities:researchTerms,
    strategyChanges:Array.isArray(aiGrowth.strategyChanges)?aiGrowth.strategyChanges.slice(0,6):[],
    aiCreativeBatch:aiBatch,
    analyst:{
      viralScore:Number(analyst.viralScore||0),
      potential:String(analyst.potential||""),
      followerDelta:Number(analyst.followerDelta||0),
      topEngagement:Number(analyst.topEngagement||0)
    },
    auditFeedback:{
      baseline:Number(auditor.baseline||0),
      verdict:String(auditor.verdict||auditor.status||""),
      recommendations:Array.isArray(auditor.recommendations)?auditor.recommendations.slice(0,8):[]
    },
    growthFeedback:{
      scaleMode:String(growth.scaleMode||""),
      experiment:String(growth.experiment||"")
    },
    decisionMode:["explore","test-and-learn","scale-winner"].includes(String(aiGrowth.decisionMode||""))
      ? String(aiGrowth.decisionMode)
      : Number(analyst.viralScore||0)>=70?"scale-winner":Number(analyst.viralScore||0)>=40?"test-and-learn":"explore",
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
    model:aiGrowth?.model?"openai-growth-brain+instagram-signals":"instagram-growth-skills",quantity:1,
    message:options.feedback
      ?"Estratégia ajustada com o desempenho mais recente."
      :"Plano de crescimento de 30 dias atualizado com 3 slots, CTA rotativo e anti-repetição.",
    metadata:{recommendedPostTimes:plan.recommendedPostTimes,leads,growthCampaign:plan.growthCampaign,aiModel:aiGrowth?.model||"",aiCached:Boolean(aiGrowth?.cached),aiDecisionMode:plan.decisionMode}
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
  const state=await agentCoreState(env,client.id);
  const recent=await ledgerRows(env,client.id,Math.max(60,Number(strategy?.antiRepeat?.recentWindow||120)));
  const recentCaptions=recent.map(row=>String(row.caption||"")).filter(Boolean);
  // Anti-repeat is a recent-window guard, not a permanent blacklist.
  // With a finite approved media pool, blacklisting every historical image
  // eventually starves Creator and stops autonomous publishing entirely.
  const recentlyPublished=recent.filter(row=>row.status==="published");
  const usedPublishedMedia=new Set(
    recentlyPublished.slice(0,2)
      .map(row=>mediaKey(row.payload?.imageUrl||row.payload?.publicImageUrl||""))
      .filter(Boolean)
  );
  const queuedUnusedMedia=recent
    .filter(row=>row.status!=="published"
      &&!(client.id==="ragnar-one"&&row.payload?.sourceInstagramMediaId))
    .map(row=>String(row.payload?.imageUrl||row.payload?.publicImageUrl||"").trim())
    .filter(url=>/^https:\/\//i.test(url)
      &&!usedPublishedMedia.has(mediaKey(url))
      &&!/\/assets\/ragnar\/nordic-cinema-0[123]\.png(?:[?#]|$)/i.test(url));
  const configuredMedia=Array.isArray(strategy?.standardMediaUrls)?strategy.standardMediaUrls:[];
  const recentSourceIds=new Set(
    recentlyPublished.slice(0,12)
      .map(row=>String(row.payload?.sourceInstagramMediaId||""))
      .filter(Boolean)
  );
  const instagramCandidates=Array.isArray(state?.radar?.mediaCandidates)
    ? state.radar.mediaCandidates.filter(item=>item?.id&&item?.mediaUrl&&!recentSourceIds.has(String(item.id)))
    : [];
  const mediaPool=[...new Set([...configuredMedia,...queuedUnusedMedia])]
    .filter(url=>/^https:\/\//i.test(String(url))
      &&!usedPublishedMedia.has(mediaKey(url))
      &&!/\/assets\/ragnar\/nordic-cinema-0[123]\.png(?:[?#]|$)/i.test(String(url)));

  const times=(Array.isArray(strategy?.recommendedPostTimes)&&strategy.recommendedPostTimes.length
    ?strategy.recommendedPostTimes
    :recommendedTimes([])).slice(0,3);
  const themes=Array.isArray(strategy?.themes)&&strategy.themes.length
    ?strategy.themes
    :["Descoberta","Utilidade","Comunidade"];
  const ctas=Array.isArray(strategy?.ctaRotation)&&strategy.ctaRotation.length
    ?strategy.ctaRotation
    :[strategy?.cta||'Comente "QUERO" para saber mais'];
  const aiBatch=Array.isArray(strategy?.aiCreativeBatch)?strategy.aiCreativeBatch.slice(0,3):[];
  const created=[];
  const repaired=[];
  const approval=config.autoPublish&&!config.approvalRequired?"approved":"pending";
  const plannedByDay=new Map();
  for(const row of recent){
    if(["published","expired","cancelled"].includes(String(row.status||"")))continue;
    const day=localDay(row.scheduled_for||row.created_at);
    plannedByDay.set(day,(plannedByDay.get(day)||0)+1);
  }

  async function nextMedia(postId,visualBrief="") {
    if(["globalplay-streaming","ragnar-one"].includes(client.id)){
      try{
        const generated=await generateOriginalMedia(env,client,postId,visualBrief,{
          variationSeed:String(postId)+"|"+String(Date.now())
        });
        return {url:generated.url,source:"openai-original-media",sourceInstagramMediaId:""};
      }catch(error){
        return {url:"",source:"media-generation-failed",sourceInstagramMediaId:"",error:String(error?.message||error)};
      }
    }
    const pooled=String(mediaPool.shift()||"");
    if(pooled) return {url:pooled,source:"standard-media-pool",sourceInstagramMediaId:""};
    while(instagramCandidates.length){
      const candidate=instagramCandidates.shift();
      const staged=await stageOwnInstagramImage(env,client.id,postId,candidate.mediaUrl);
      if(staged){
        recentSourceIds.add(String(candidate.id));
        return {url:staged,source:"own-instagram-r2-replenishment",sourceInstagramMediaId:String(candidate.id)};
      }
    }
    return {url:"",source:"awaiting-unique-media",sourceInstagramMediaId:""};
  }

  // Adaptive times may change between cycles. Recover one due post from
  // today's earlier timing plan before allocating media to future slots.
  const dueRecoveries=recent
    .filter(row=>row.status==="ready"
      &&localDay(row.scheduled_for)===localDay()
      &&Date.parse(String(row.scheduled_for||""))<=Date.now()
      &&!String(row.payload?.imageUrl||row.payload?.publicImageUrl||"")
      &&row.approval_status==="approved")
    .sort((a,b)=>Date.parse(a.scheduled_for)-Date.parse(b.scheduled_for));
  for(const pending of dueRecoveries){
    const payload={...pending.payload};
    const blocked=String(payload.blockedDesignerMedia||"");
    const duplicateBlocked=["duplicate_media_blocked","duplicate_media_content_blocked","media_generation_required"].includes(String(pending.error||""));
    const generationAttempts=Math.max(0,Number(payload.mediaGeneration?.attempts||0));
    if(generationAttempts>=3){
      await env.DB.prepare(
        "UPDATE post_ledger SET status='expired',error='media_generation_exhausted',updated_at=CURRENT_TIMESTAMP WHERE id=?1"
      ).bind(pending.id).run();
      continue;
    }
    const safeRecheck=!duplicateBlocked&&client.id!=="ragnar-one"
      &&/^https:\/\//i.test(blocked)
      &&!/\/assets\/ragnar\/nordic-cinema-0[123]\.png(?:[?#]|$)/i.test(blocked)
      &&!payload.blockedDesignerRecoveryAttemptedAt;
    const mediaInfo=safeRecheck
      ?{url:blocked,source:"blocked-media-recheck",sourceInstagramMediaId:""}
      :await nextMedia(pending.id,String(payload.visualBrief||""));
    if(!mediaInfo.url){
      payload.mediaGeneration={status:"requested",attempts:generationAttempts+1,lastError:String(mediaInfo.error||"media_generation_failed").slice(0,120),updatedAt:new Date().toISOString()};
      const exhausted=payload.mediaGeneration.attempts>=3;
      await env.DB.prepare(
        "UPDATE post_ledger SET status=?2,error=?3,payload_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1"
      ).bind(pending.id,exhausted?"expired":"ready",exhausted?"media_generation_exhausted":"media_generation_required",JSON.stringify(payload)).run();
      continue;
    }
    payload.imageUrl=mediaInfo.url;
    payload.sourceInstagramMediaId=mediaInfo.sourceInstagramMediaId||"";
    payload.mediaGeneration={status:"generated",attempts:generationAttempts+(safeRecheck?0:1),lastError:"",updatedAt:new Date().toISOString()};
    payload.intelligence={...(payload.intelligence||{}),mediaSource:mediaInfo.source};
    if(safeRecheck)payload.blockedDesignerRecoveryAttemptedAt=new Date().toISOString();
    payload.qualityGates={copyChief:"pending",designer:"pending"};
    payload.visualReview=null;
    await env.DB.prepare(
      "UPDATE post_ledger SET status='ready',error='',payload_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1"
    ).bind(pending.id,JSON.stringify(payload)).run();
    repaired.push({id:pending.id,scheduledFor:pending.scheduled_for,imageUrl:payload.imageUrl});
    break;
  }

  const publishedTodayRows=recent.filter(row=>row.status==="published"
    &&localDay(row.payload?.publishedAt||row.updated_at||row.scheduled_for||row.created_at)===localDay());
  const publishedTodayCount=publishedTodayRows.length;
  const lastPublishedMs=publishedTodayRows.reduce((latest,row)=>{
    const value=Date.parse(String(row.payload?.publishedAt||row.updated_at||row.scheduled_for||row.created_at||""));
    return Number.isFinite(value)?Math.max(latest,value):latest;
  },0);
  const dailyPublishTarget=Math.max(1,Math.min(3,Number(strategy?.dailySlots||3)));
  const catchUpSpacingReady=publishedTodayCount===0
    || (lastPublishedMs>0&&Date.now()-lastPublishedMs>=90*60*1000);
  const dueValid=recent.some(row=>["ready","scheduled","failed"].includes(row.status)
    &&localDay(row.scheduled_for)===localDay()
    &&Date.parse(String(row.scheduled_for||""))<=Date.now()
    &&row.approval_status==="approved"
    &&row.payload?.qualityGates?.copyChief==="approved"
    &&row.payload?.qualityGates?.designer==="approved"
    &&!usedPublishedMedia.has(mediaKey(row.payload?.imageUrl||row.payload?.publicImageUrl||""))
    &&visualApproval(client.id,row.payload));
  let recoveryPulledForward=false;
  if(["globalplay-streaming","ragnar-one"].includes(client.id)
    &&config.autoPublish&&isPublishingWindow(new Date())
    &&publishedTodayCount<dailyPublishTarget&&catchUpSpacingReady&&!dueValid){
    const future=recent
      .filter(row=>["ready","scheduled"].includes(row.status)
        &&row.approval_status==="approved"
        &&sameSaoPauloDay(row.scheduled_for,new Date())
        &&Date.parse(String(row.scheduled_for||""))>Date.now()
        &&row.payload?.qualityGates?.copyChief==="approved"
        &&row.payload?.qualityGates?.designer==="approved"
        &&!usedPublishedMedia.has(mediaKey(row.payload?.imageUrl||row.payload?.publicImageUrl||""))
        &&visualApproval(client.id,row.payload))
      .sort((a,b)=>Date.parse(a.scheduled_for)-Date.parse(b.scheduled_for))[0];
    if(future){
      const payload={...future.payload,scheduledRecoveryAt:new Date().toISOString(),scheduledRecoveryReason:"daily_target_catch_up"};
      await env.DB.prepare(
        "UPDATE post_ledger SET scheduled_for=?2,payload_json=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1"
      ).bind(future.id,new Date().toISOString(),JSON.stringify(payload)).run();
      recoveryPulledForward=true;
    }
  }

  for(let index=0;index<times.length;index++){
    const time=times[index];
    const scheduledFor=(publishedTodayCount===0&&!recoveryPulledForward&&index===0)
      ?new Date().toISOString()
      :scheduleIso(time,index);
    const day=localDay(scheduledFor);
    const id="agentcore:"+client.id+":"+day+":"+String(time).replace(":","");
    const exists=await env.DB.prepare(
      "SELECT id,status,approval_status,caption,error,payload_json FROM post_ledger WHERE id=?1 LIMIT 1"
    ).bind(id).first();
    if(exists){
      const existingPayload=parseJson(exists.payload_json,{});
      const aiCreative=aiBatch[index]||null;
      const aiCaption=String(aiCreative?.caption||"").trim();
      const shouldRefreshCopy=Boolean(aiCreative&&aiCaption&&exists.status!=="published"
        &&existingPayload.aiCreativeVersion!==String(state?.aiGrowth?.generatedAt||""));
      if(shouldRefreshCopy){
        existingPayload.title=String(aiCreative.theme||existingPayload.title||"Conteúdo").slice(0,160);
        existingPayload.visualBrief=String(aiCreative.visualBrief||"").slice(0,1200);
        existingPayload.aiCreativeVersion=String(state?.aiGrowth?.generatedAt||new Date().toISOString());
        existingPayload.intelligence={
          ...(existingPayload.intelligence||{}),
          source:"openai-growth-brain",
          adaptive:true
        };
        existingPayload.qualityGates={copyChief:"pending",designer:"pending"};
        existingPayload.visualReview=null;
        await env.DB.prepare(
          "UPDATE post_ledger SET caption=?2,status='ready',error='',payload_json=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1"
        ).bind(id,aiCaption.slice(0,2200),JSON.stringify(existingPayload)).run();
      }
      const existingMedia=String(existingPayload.imageUrl||existingPayload.publicImageUrl||"").trim();
      const blockedMedia=String(existingPayload.blockedDesignerMedia||"");
      const canRecheckBlocked=!existingMedia
        &&localDay(scheduledFor)===localDay()
        &&!existingPayload.blockedDesignerRecoveryAttemptedAt
        &&/^https:\/\//i.test(blockedMedia);
      const safeRecheck=client.id!=="ragnar-one"&&canRecheckBlocked
        &&!/\/assets\/ragnar\/nordic-cinema-0[123]\.png(?:[?#]|$)/i.test(blockedMedia);
      const existingGenerationAttempts=Math.max(0,Number(existingPayload.mediaGeneration?.attempts||0));
      const duplicateBlocked=["duplicate_media_blocked","duplicate_media_content_blocked","media_generation_required"].includes(String(exists.error||""));
      const allowBlockedRecheck=safeRecheck&&!duplicateBlocked;
      const replacementInfo=existingMedia||existingGenerationAttempts>=3
        ?{url:"",source:"",sourceInstagramMediaId:""}
        :allowBlockedRecheck
          ?{url:blockedMedia,source:"blocked-media-recheck",sourceInstagramMediaId:""}
          :await nextMedia(id,String(existingPayload.visualBrief||aiCreative?.visualBrief||""));
      const replacement=String(replacementInfo.url||"");
      if(replacement){
        existingPayload.imageUrl=replacement;
        existingPayload.sourceInstagramMediaId=replacementInfo.sourceInstagramMediaId||"";
        existingPayload.retryCount=0;
        existingPayload.mediaGeneration={status:"generated",attempts:existingGenerationAttempts+(allowBlockedRecheck?0:1),lastError:"",updatedAt:new Date().toISOString()};
        existingPayload.recoveredAt=new Date().toISOString();
        existingPayload.recoveryReason="missing_media_repaired_by_creator";
        if(safeRecheck)existingPayload.blockedDesignerRecoveryAttemptedAt=new Date().toISOString();
        existingPayload.intelligence={
          ...(existingPayload.intelligence||{}),
          mediaSource:replacementInfo.source||"standard-media-pool-recovery"
        };
        existingPayload.qualityGates={copyChief:"pending",designer:"pending"};
        await env.DB.prepare(
          `UPDATE post_ledger
           SET status='ready', approval_status=?2, error='', payload_json=?3, updated_at=CURRENT_TIMESTAMP
           WHERE id=?1`
        ).bind(id,approval,JSON.stringify(existingPayload)).run();
        repaired.push({id,scheduledFor,scheduledHour:time,imageUrl:replacement});
        usedPublishedMedia.add(mediaKey(replacement));
      }else if(!existingMedia&&existingGenerationAttempts<3&&replacementInfo.error){
        existingPayload.mediaGeneration={status:"requested",attempts:existingGenerationAttempts+1,lastError:String(replacementInfo.error).slice(0,120),updatedAt:new Date().toISOString()};
        const exhausted=existingPayload.mediaGeneration.attempts>=3;
        existingPayload.qualityGates={...(existingPayload.qualityGates||{}),designer:"pending"};
        existingPayload.visualReview=null;
        await env.DB.prepare(
          "UPDATE post_ledger SET status=?2,error=?3,payload_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1"
        ).bind(id,exhausted?"expired":"ready",exhausted?"media_generation_exhausted":"media_generation_required",JSON.stringify(existingPayload)).run();
      }
      continue;
    }

    if((plannedByDay.get(day)||0)>=dailyPublishTarget)continue;
    const aiCreative=aiBatch[index]||null;
    const theme=String(aiCreative?.theme||themes[index%themes.length]||"Conteúdo");
    const hook=String(aiCreative?.hook||pickUniqueHook(index,day,strategy?.radarTerms||[],recentCaptions)).trim();
    const cta=String(aiCreative?.cta||ctas[index%ctas.length]||strategy?.cta||'Comente "QUERO" para saber mais').trim();
    const tags=String(aiCreative?.hashtags||strategy?.hashtags||"").trim().split(/\s+/).filter(Boolean).slice(0,6).join(" ");
    let caption=String(aiCreative?.caption||"").trim();
    if(!caption){
      caption=[
        hook,
        "",
        theme+". "+String(strategy?.contentFocus||"Conteúdo relevante para o público.")+".",
        "",
        cta,
        tags?"":null,
        tags||null
      ].filter(x=>x!==null).join("\n");
    }
    if(tags&&!caption.includes(tags))caption=(caption+"\n\n"+tags).trim();
    caption=caption.slice(0,2200);

    if(recentCaptions.some(previous=>textSimilarity(caption,previous)>=Number(strategy?.antiRepeat?.captionSimilarityThreshold||0.72))){
      caption=[
        hook,
        "",
        String(aiCreative?.visualBrief||theme),
        "",
        cta,
        tags?"":null,
        tags||null
      ].filter(x=>x!==null).join("\n").slice(0,2200);
    }

    const mediaInfo=await nextMedia(id,String(aiCreative?.visualBrief||""));
    const imageUrl=String(mediaInfo.url||"");
    const payload={
      clientName:client.name||client.id,
      instagram:client.instagram||"",
      imageUrl,
      sourceInstagramMediaId:String(mediaInfo.sourceInstagramMediaId||""),
      mediaGeneration:{status:imageUrl?"generated":"requested",attempts:imageUrl?1:1,lastError:String(mediaInfo.error||"").slice(0,120),updatedAt:new Date().toISOString()},
      title:theme.slice(0,160),
      visualBrief:String(aiCreative?.visualBrief||"").slice(0,1200),
      aiCreativeVersion:String(state?.aiGrowth?.generatedAt||""),
      source:"agent-core:creator-growth-30d",
      model:"instagram-growth-skill-layer",
      retryCount:0,
      creativeFingerprint:normalizeCreativeText([day,index,hook,theme,cta].join("|")).slice(0,240),
      growthCampaign:strategy?.growthCampaign||null,
      intelligence:{
        format:"image",
        skill:"ig-image",
        mediaSource:mediaInfo.source||"awaiting-unique-media",
        strategySource:aiCreative?"openai-growth-brain":"fallback-rules",
        antiRepeat:true,
        visualPolicy:{
          singleScene:true,
          maxScenes:1,
          noSplitScreen:true,
          noCollage:true,
          noMosaic:true,
          noBeforeAfter:true,
          lowVisualClutter:true,
          tvScreenMustBeFilled:true,
          tvScreenContent:"coherent entertainment or streaming content",
          focalSubjectCount:1,
          brandSafety:strategy?.brandSafety||null,
          creativeRotation:strategy?.creativeRotation||null,
          creativeTheme:String(client.id)==="globalplay-streaming"
            ?((localDay()>="2026-09-27"&&localDay()<="2026-10-12")?"3d-cartoon-entertainment":(index%2===0?"3d-cartoon-entertainment":"standard"))
            :"standard"
        }
      },
      qualityGates:{copyChief:"pending",designer:"pending"}
    };
    await env.DB.prepare(
      "INSERT INTO post_ledger(id,client_id,scheduled_for,scheduled_hour,status,approval_status,media_id,caption,image_object_key,error,cost_usd,payload_json,created_at,updated_at) VALUES(?1,?2,?3,?4,'ready',?5,'',?6,'',?7,0,?8,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
    ).bind(id,client.id,scheduledFor,time,approval,caption,imageUrl?"":"media_generation_required",JSON.stringify(payload)).run();

    plannedByDay.set(day,(plannedByDay.get(day)||0)+1);
    created.push({id,scheduledFor,scheduledHour:time,approvalStatus:approval,title:theme,caption,...payload});
    recentCaptions.push(caption);
    if(imageUrl)usedPublishedMedia.add(mediaKey(imageUrl));
  }

  await recordAgentExecution(env,client,"CREATOR",{
    function:"growth-30d-creative-generation",trigger:options.trigger,startedAt,status:"success",
    model:"instagram-growth-skill-layer",quantity:created.length,
    message:created.length||repaired.length
      ?created.length+" pauta(s) criada(s) e "+repaired.length+" postagem(ns) incompleta(s) recuperada(s)."
      :"Agenda já preparada; nenhuma pauta duplicada criada e nenhuma recuperação necessária.",
    metadata:{
      approvalRequired:config.approvalRequired,
      autoPublish:config.autoPublish,
      draftIds:created.map(x=>x.id),
      repairedIds:repaired.map(x=>x.id),
      uniqueMediaAvailable:mediaPool.length
    }
  });
  return {created,repaired};
}

async function runPublisher(env,client,options) {
  const startedAt=new Date().toISOString();
  const config=normalizeAgentCoreConfig(client);
  const rows=await env.DB.prepare(
    `SELECT id,scheduled_for,status,approval_status,caption,payload_json
     FROM post_ledger
     WHERE client_id=?1
       AND status IN ('ready','scheduled','failed')
       AND approval_status='approved'
       AND COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.retryCount'),0) < 3
       AND (scheduled_for IS NULL OR scheduled_for<=?2)
       AND (client_id NOT IN ('globalplay-streaming','ragnar-one')
         OR date(scheduled_for,'-3 hours')=date(?2,'-3 hours'))
       AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.copyChief')='approved'
       AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.qualityGates.designer')='approved'
       AND COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.imageUrl'),'')<>''
     ORDER BY COALESCE(scheduled_for,created_at) ASC LIMIT 20`
  ).bind(client.id,new Date().toISOString()).all();

  const recentPublished=await ledgerRows(env,client.id,150);
  const usedMedia=new Set(
    recentPublished.filter(row=>row.status==="published").slice(0,2)
      .map(row=>mediaKey(row.payload?.imageUrl||row.payload?.publicImageUrl||""))
      .filter(Boolean)
  );
  const usedCaptions=recentPublished.filter(row=>row.status==="published").map(row=>String(row.caption||"")).filter(Boolean);
  const todayPublished=recentPublished.filter(row=>row.status==="published"
    &&localDay(row.payload?.publishedAt||row.updated_at||row.scheduled_for||row.created_at)===localDay());
  let publishedTodayCount=todayPublished.length;
  const lastPublishedAt=todayPublished
    .map(row=>String(row.payload?.publishedAt||row.updated_at||row.scheduled_for||row.created_at||""))
    .filter(Boolean)
    .sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null;

  let published=0,failed=0,awaitingApproval=0,awaitingMedia=0,repairedApproval=0;
  let duplicateMediaBlocked=0,duplicateCaptionBlocked=0;
  const gate=publishingGate({now:new Date(),publishedToday:publishedTodayCount,lastPublishedAt});
  if(!gate.ok){
    await recordAgentExecution(env,client,"PUBLISHER",{
      function:"growth-30d-safe-publish",trigger:options.trigger,startedAt,status:"success",
      model:"anti-repeat+meta-api",quantity:(rows?.results||[]).length,
      message:"0 publicada(s): "+gate.reason+".",
      metadata:{published:0,failed:0,awaitingApproval:0,awaitingMedia:0,repairedApproval:0,duplicateMediaBlocked:0,duplicateCaptionBlocked:0,blockedReason:gate.reason}
    });
    return {published:0,failed:0,awaitingApproval:0,awaitingMedia:0,repairedApproval:0,duplicateMediaBlocked:0,duplicateCaptionBlocked:0,blockedReason:gate.reason};
  }

  for(const row of rows?.results||[]){
    if(published>0||publishedTodayCount>=3)break;
    let approval=String(row.approval_status||"pending");
    const payload=parseJson(row.payload_json,{});
    if(client.id==="ragnar-one"&&(payload.sourceInstagramMediaId
      ||payload.intelligence?.mediaSource==="own-instagram-r2-replenishment")){
      payload.blockedDuplicateMedia=payload.imageUrl||payload.publicImageUrl||"";
      payload.imageUrl="";
      payload.publicImageUrl="";
      payload.qualityGates={...(payload.qualityGates||{}),designer:"pending"};
      await env.DB.prepare(
        "UPDATE post_ledger SET payload_json=?2,error='recycled_instagram_media_blocked',updated_at=CURRENT_TIMESTAMP WHERE id=?1"
      ).bind(row.id,JSON.stringify(payload)).run();
      duplicateMediaBlocked+=1;
      awaitingMedia+=1;
      continue;
    }

    // Mandatory quality gates. Autonomous publishing must never bypass the
    // reviewers just because autoPublish is enabled.
    const quality=payload.qualityGates&&typeof payload.qualityGates==="object"?payload.qualityGates:{};
    if(quality.copyChief!=="approved"||quality.designer!=="approved"||!visualApproval(client.id,payload)){
      await env.DB.prepare(
        "UPDATE post_ledger SET error='quality_gate_pending',updated_at=CURRENT_TIMESTAMP WHERE id=?1"
      ).bind(row.id).run();
      awaitingApproval+=1;
      continue;
    }

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
      payload.publicImageUrl="";
      payload.visualReview=null;
      payload.mediaGeneration={...(payload.mediaGeneration||{}),status:"requested",updatedAt:new Date().toISOString()};
      payload.qualityGates={...(payload.qualityGates||{}),designer:"pending"};
      await env.DB.prepare(
        "UPDATE post_ledger SET payload_json=?2,error='media_generation_required',updated_at=CURRENT_TIMESTAMP WHERE id=?1"
      ).bind(row.id,JSON.stringify(payload)).run();
      duplicateMediaBlocked+=1;
      awaitingMedia+=1;
      continue;
    }

    if(client.id==="ragnar-one"){
      const fingerprint=await mediaFingerprint(env,imageUrl);
      if(!fingerprint){
        await env.DB.prepare(
          "UPDATE post_ledger SET error='media_fingerprint_unavailable',updated_at=CURRENT_TIMESTAMP WHERE id=?1"
        ).bind(row.id).run();
        awaitingMedia+=1;
        continue;
      }
      let repeated=false;
      for(const prior of recentPublished.filter(item=>item.status==="published").slice(0,2)){
        const priorUrl=prior.payload?.imageUrl||prior.payload?.publicImageUrl||"";
        const priorHash=prior.payload?.mediaFingerprint||await mediaFingerprint(env,priorUrl);
        if(priorHash===fingerprint){repeated=true;break;}
      }
      if(repeated){
        payload.blockedDuplicateMedia=imageUrl;
        payload.imageUrl="";
        payload.qualityGates={...(payload.qualityGates||{}),designer:"pending"};
        payload.visualReview=null;
        payload.mediaGeneration={...(payload.mediaGeneration||{}),status:"requested",updatedAt:new Date().toISOString()};
        await env.DB.prepare(
          "UPDATE post_ledger SET payload_json=?2,error='media_generation_required',updated_at=CURRENT_TIMESTAMP WHERE id=?1"
        ).bind(row.id,JSON.stringify(payload)).run();
        duplicateMediaBlocked+=1;
        awaitingMedia+=1;
        continue;
      }
      payload.mediaFingerprint=fingerprint;
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
      publishedTodayCount+=1;
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
    engagement:
      Number(item.likeCount||0)+
      Number(item.commentsCount||0)*2+
      Number(item.insights?.saved||0)*3+
      Number(item.insights?.shares||0)*4+
      Number(item.insights?.total_interactions||0),
    insights:item.insights||{},
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
    insightTotals:{
      reach:engagements.reduce((sum,item)=>sum+Number(item.insights?.reach||0),0),
      views:engagements.reduce((sum,item)=>sum+Number(item.insights?.views||0),0),
      saves:engagements.reduce((sum,item)=>sum+Number(item.insights?.saved||0),0),
      shares:engagements.reduce((sum,item)=>sum+Number(item.insights?.shares||0),0),
      totalInteractions:engagements.reduce((sum,item)=>sum+Number(item.insights?.total_interactions||0),0)
    },
    growthCampaign:state?.radar?.growthCampaign||null,
    feedback:top
      ?"Reaproveitar estrutura, ângulo e formato dos vencedores sem copiar mídia ou legenda."
      :"Continuar coletando dados e testando ganchos distintos.",
    skills:["ig-human","ig-audit","growth-loop"]
  };
  const hasCurrentData=(snapshot.items||[]).length>0;
  const priorRadarAt=Date.parse(String(state?.radar?.scannedAt||state?.updatedAt||""));
  const hasRecentRadar=Number.isFinite(priorRadarAt)&&(Date.now()-priorRadarAt)<=6*60*60*1000&&Number(state?.radar?.scannedMedia||0)>0;
  await recordAgentExecution(env,client,"AUDITOR",{
    function:"growth-30d-performance-review",trigger:options.trigger,startedAt,
    status:(!hasCurrentData&&!hasRecentRadar&&snapshot.error)?"warning":"success",
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

    // Research and analysis must happen before strategy/creation so their findings
    // can alter the next content decision in the same autonomous cycle.
    if(requested==="all"){
      const research=await runExtendedAgents(env,client.id,{...options,agent:"pesquisador",phase:"pre-strategy"});
      Object.assign(result.agents,research);
      const analysis=await runExtendedAgents(env,client.id,{...options,agent:"analista",phase:"pre-strategy"});
      Object.assign(result.agents,analysis);
    }

    if(run("estrategista")&&config.modules.estrategista)result.agents.estrategista=strategy=await runStrategist(env,client,{radar,auditor},options);
    if(run("creator")&&config.modules.creator)result.agents.creator=await runCreator(env,client,strategy,options);

    // Quality agents must review drafts BEFORE Publisher. Previously the extended
    // agents ran after publishing, so COPY CHIEF and DESIGNER could only report
    // problems after a post was already sent to Instagram.
    // Publisher must never run before the mandatory quality gates.
    // This applies both to the full autonomous cycle and to the frequent
    // publisher-sweep, which requests only the publisher module.
    if(requested==="all"){
      const qualityAgent=requested;
      const prePublish=await runExtendedAgents(env,client.id,{
        ...options,
        agent:qualityAgent,
        phase:"pre-publish"
      });
      Object.assign(result.agents,prePublish);
    }

    if(run("publisher")&&config.modules.publisher)result.agents.publisher=await runPublisher(env,client,options);
    if(run("auditor")&&config.modules.auditor){
      result.agents.auditor=auditor=await runAuditor(env,client,options);
    }
    if(requested==="all"&&config.modules.growth){
      const growth=await runExtendedAgents(env,client.id,{...options,agent:"growth",phase:"feedback"});
      Object.assign(result.agents,growth);
    }
    if(requested==="all"&&config.modules.estrategista){
      result.agents.estrategistaFeedback=await runStrategist(env,client,{radar,auditor},{...options,feedback:true});
    }
    if(run("odin")&&config.modules.odin)result.agents.odin=await runOdin(env,client,options);
    if(requested==="all"&&config.modules.suporte){
      const support=await runExtendedAgents(env,client.id,{...options,agent:"suporte",phase:"post-cycle"});
      Object.assign(result.agents,support);
    }
    if(requested!=="all"){
      const extended=await runExtendedAgents(env,client.id,options);
      Object.assign(result.agents,extended);
    }
    const now=new Date().toISOString();
    await patchAgentCoreState(env,client.id,{lastCycleAt:now,nextCycleAt:new Date(Date.now()+config.cycleMinutes*60000).toISOString(),lastCycleStatus:"success",lastCycleError:""});
    return result;
  }catch(error){
    await patchAgentCoreState(env,client.id,{lastCycleAt:new Date().toISOString(),lastCycleStatus:"failed",lastCycleError:String(error?.message||error).slice(0,500)});
    throw error;
  }
}
