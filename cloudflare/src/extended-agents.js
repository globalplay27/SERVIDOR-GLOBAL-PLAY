import { getClient } from "./clients.js";
import { reviewImage, visualApproval } from "./visual-review.js";
import { agentCoreState, patchAgentCoreState, recordAgentExecution, normalizeAgentCoreConfig } from "./agent-core.js";

function parseJson(raw, fallback = {}) {
  try {
    const v = JSON.parse(String(raw || ""));
    return v && typeof v === "object" ? v : fallback;
  } catch { return fallback; }
}

async function ledgerRows(env, clientId, limit = 160) {
  const r = await env.DB.prepare(
    `SELECT id,scheduled_for,status,approval_status,caption,error,payload_json,created_at,updated_at
     FROM post_ledger WHERE client_id=?1
     ORDER BY COALESCE(updated_at,created_at) DESC LIMIT ?2`
  ).bind(String(clientId), Math.max(1, Math.min(500, Number(limit || 160)))).all();
  return (r?.results || []).map(row => ({...row, payload:parseJson(row.payload_json,{})}));
}

function words(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").match(/[a-z0-9]{3,}/g) || [];
}
function topTerms(texts, limit=12) {
  const stop=new Set(["para","como","mais","uma","com","sem","que","dos","das","por","seu","sua","isso","esta","este","agora","hoje","aqui","sobre"]);
  const m=new Map();
  for(const text of texts) for(const token of words(text)) if(!stop.has(token)) m.set(token,(m.get(token)||0)+1);
  return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([term,count])=>({term,count}));
}
function clamp(n,min,max){return Math.max(min,Math.min(max,Number(n)||0));}

async function runResearcher(env,client,options){
  const startedAt=new Date().toISOString();
  const [state,ledger]=await Promise.all([agentCoreState(env,client.id),ledgerRows(env,client.id,180)]);
  const radarTerms=Array.isArray(state?.radar?.topTerms)?state.radar.topTerms:[];
  const local=topTerms(ledger.map(x=>x.caption).filter(Boolean),16);
  const opportunities=[...new Map([...radarTerms,...local].map(x=>[String(x.term||""),x])).values()].filter(x=>x.term).slice(0,12);
  const output={source:"nexus-first-party-signals",niche:client.niche||"Outro",opportunities,winningFormats:state?.radar?.winningFormats||[],questionsForContent:state?.odin?.questionsForContent||[],skills:["trend-research","niche-signals","content-opportunities"]};
  await recordAgentExecution(env,client,"PESQUISADOR",{function:"content-opportunity-research",trigger:options.trigger,startedAt,status:"success",model:"first-party-signal-research",quantity:ledger.length,message:opportunities.length+" oportunidade(s) de tema consolidada(s)."});
  await patchAgentCoreState(env,client.id,{pesquisador:output});
  return output;
}

async function runAnalyst(env,client,options){
  const startedAt=new Date().toISOString();
  const [state,ledger]=await Promise.all([agentCoreState(env,client.id),ledgerRows(env,client.id,220)]);
  const published=ledger.filter(x=>x.status==="published").length;
  const failed=ledger.filter(x=>x.status==="failed").length;
  const followerDelta=Number(state?.radar?.followersDelta||0);
  const baseline=Number(state?.auditor?.baseline||0);
  const top=Number(state?.radar?.metrics?.topEngagement||state?.auditor?.topMedia?.engagement||0);
  const ratio=baseline>0?top/baseline:(top>0?1.5:0);
  const viralScore=Math.round(clamp((ratio*35)+(Math.max(0,followerDelta)*2)+(published*1.5)-(failed*6),0,100));
  const potential=viralScore>=70?"alto":viralScore>=40?"medio":"baixo";
  const output={viralScore,potential,published,failed,followerDelta,baseline,topEngagement:top,skills:["performance-analysis","viral-score","funnel-metrics"]};
  await recordAgentExecution(env,client,"ANALISTA",{function:"viral-potential-analysis",trigger:options.trigger,startedAt,status:"success",model:"nexus-performance-score-v1",quantity:ledger.length,message:"Potencial atual: "+potential+" ("+viralScore+"/100)."});
  await patchAgentCoreState(env,client.id,{analista:output});
  return output;
}

async function runCopyChief(env,client,options){
  const startedAt=new Date().toISOString();
  const rows=(await ledgerRows(env,client.id,120)).filter(x=>["ready","scheduled"].includes(String(x.status||""))).slice(0,20);
  let strong=0,needsWork=0;
  const reviews=[];
  for(const row of rows){
    const c=String(row.caption||""); const hasCta=/quero|comente|siga|salva|envie|compartilh/i.test(c); const first=c.split(/\n/)[0].trim(); const hookStrong=first.length>=18&&first.length<=140; const ok=hasCta&&hookStrong&&c.length<=2200; ok?strong++:needsWork++;
    const payload=row.payload&&typeof row.payload==="object"?row.payload:{}; payload.qualityGates={...(payload.qualityGates||{}),copyChief:ok?"approved":"rejected",copyChiefAt:new Date().toISOString()};
    await env.DB.prepare("UPDATE post_ledger SET payload_json=?2,error=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1").bind(row.id,JSON.stringify(payload),ok?"":"copy_quality_rejected").run();
    reviews.push({id:row.id,ok,hasCta,hookStrong,length:c.length});
  }
  const output={reviewed:rows.length,strong,needsWork,reviews,skills:["hook-review","cta-review","caption-quality"]};
  await recordAgentExecution(env,client,"COPY CHIEF",{function:"caption-quality-gate",trigger:options.trigger,startedAt,status:needsWork?"warning":"success",model:"copy-quality-rules",quantity:rows.length,message:strong+" copy(s) fortes; "+needsWork+" precisam ajuste."});
  await patchAgentCoreState(env,client.id,{copyChief:output});
  return output;
}

async function runDesigner(env,client,options){
  const startedAt=new Date().toISOString();
  const now=Date.now();
  const rows=(await ledgerRows(env,client.id,120))
    .filter(row=>{
      const status=String(row.status||"");
      const retryCount=Math.max(0,Number(row.payload?.retryCount||0));
      const updatedMs=Date.parse(String(row.updated_at||row.created_at||""));
      const fresh=!Number.isFinite(updatedMs)||(now-updatedMs)<=72*60*60*1000;
      if(status==="ready"||status==="scheduled")return fresh;
      if(status==="failed")return fresh&&retryCount<3;
      return false;
    })
    .sort((a,b)=>{
      const priority=row=>{
        const due=Date.parse(String(row.scheduled_for||""));
        const media=String(row.payload?.imageUrl||row.payload?.publicImageUrl||"");
        const localDate=ms=>new Date(ms-3*60*60*1000).toISOString().slice(0,10);
        if(media && Number.isFinite(due) && due<=now && localDate(due)===localDate(now))return 0;
        if(media && Number.isFinite(due) && due>now)return 1;
        return 2;
      };
      return priority(a)-priority(b)
        || Date.parse(String(a.scheduled_for||a.created_at||""))
         - Date.parse(String(b.scheduled_for||b.created_at||""));
    })
    .slice(0,30);
  let ready=0,missing=0,repairQueued=0;
  const checks=[];
  let visualCalls=0;
  for(const row of rows){
    const payload=row.payload&&typeof row.payload==="object"?row.payload:{};
    payload.intelligence=payload.intelligence&&typeof payload.intelligence==="object"?payload.intelligence:{};
    const source=String(payload.source||"");
    const existingPolicy=payload.intelligence.visualPolicy&&typeof payload.intelligence.visualPolicy==="object"
      ? payload.intelligence.visualPolicy : {};
    if(source.startsWith("agent-core:")){
      payload.intelligence.visualPolicy={
        singleScene:existingPolicy.singleScene!==false,
        maxScenes:1,
        noSplitScreen:existingPolicy.noSplitScreen!==false,
        noCollage:existingPolicy.noCollage!==false,
        noMosaic:existingPolicy.noMosaic!==false,
        noBeforeAfter:existingPolicy.noBeforeAfter!==false,
        lowVisualClutter:existingPolicy.lowVisualClutter!==false,
        tvScreenMustBeFilled:existingPolicy.tvScreenMustBeFilled!==false,
        focalSubjectCount:1,
        ...existingPolicy
      };
    }
    const media=String(payload.imageUrl||payload.publicImageUrl||"").trim();
    const mediaReady=/^https:\/\//i.test(media);
    const invalidLegacyMedia=client.id==="ragnar-one"
      &&/\/assets\/ragnar\/nordic-cinema-0[123]\.png(?:[?#]|$)/i.test(media);
    if(invalidLegacyMedia)payload.blockedDesignerRecoveryAttemptedAt=new Date().toISOString();
    const policy=payload.intelligence.visualPolicy||{};
    const singleScene=policy.singleScene===true;
    const noSplitScreen=policy.noSplitScreen===true;
    const noCollage=policy.noCollage===true;
    const tvFilled=policy.tvScreenMustBeFilled!==false;
    let ok=mediaReady&&!invalidLegacyMedia&&singleScene&&noSplitScreen&&noCollage&&tvFilled;

    if(["globalplay-streaming","ragnar-one"].includes(client.id)&&!invalidLegacyMedia){
      const prior=payload.visualReview;
      const cached=prior?.version==="visual-review-v2"&&prior.media===media;
      const settled=cached&&(["approved","rejected"].includes(prior.status)||Number(prior.attempts)>=3||Date.parse(prior.retryAt)>Date.now());
      const diagnosticRetry=cached&&prior?.status==="unavailable"
        &&prior.reason==="visual_review_unavailable"
        &&!prior.diagnosticRetry;
      // Legacy generic failures may have exhausted all three attempts before
      // transport errors were classified. Allow one bounded diagnostic retry.
      if(mediaReady&&(!settled||diagnosticRetry)&&visualCalls>=1)continue;
      if(settled||visualCalls<1){
        if((!settled||diagnosticRetry)&&mediaReady)visualCalls++;
        payload.visualReview=await reviewImage(
          env,client,media,
          diagnosticRetry?{...prior,attempts:0,retryAt:"2000-01-01"}:prior
        );
        if(diagnosticRetry)payload.visualReview={...payload.visualReview,diagnosticRetry:true};
      }
      if(mediaReady&&payload.visualReview?.status==="unavailable"){
        payload.qualityGates={...(payload.qualityGates||{}),designer:"pending"};
        await env.DB.prepare(
          "UPDATE post_ledger SET payload_json=?2,error='visual_review_unavailable',updated_at=CURRENT_TIMESTAMP WHERE id=?1"
        ).bind(row.id,JSON.stringify(payload)).run();
        missing++;
        checks.push({id:row.id,mediaReady,ok:false,reason:"visual_review_unavailable"});
        continue;
      }
      ok=mediaReady&&visualApproval(client.id,payload);
    }

    if(ok){
      ready++;
      payload.qualityGates={...(payload.qualityGates||{}),designer:"approved",designerAt:new Date().toISOString()};
      await env.DB.prepare(
        "UPDATE post_ledger SET payload_json=?2,error='',updated_at=CURRENT_TIMESTAMP WHERE id=?1"
      ).bind(row.id,JSON.stringify(payload)).run();
    }else{
      missing++;
      repairQueued++;
      payload.blockedDesignerMedia=media||payload.blockedDesignerMedia||"";
      payload.blockedDesignerReviewStatus=payload.visualReview?.status||"unknown";
      payload.imageUrl="";
      payload.publicImageUrl="";
      payload.visualReview=null;
      payload.repairRequestedAt=new Date().toISOString();
      payload.repairReason="designer_requested_media_replacement";
      payload.intelligence={
        ...(payload.intelligence||{}),
        mediaSource:"awaiting-designer-replacement"
      };
      payload.qualityGates={...(payload.qualityGates||{}),designer:"pending",designerAt:new Date().toISOString()};
      await env.DB.prepare(
        "UPDATE post_ledger SET status='ready',payload_json=?2,error='designer_replacement_queued',updated_at=CURRENT_TIMESTAMP WHERE id=?1"
      ).bind(row.id,JSON.stringify(payload)).run();
    }

    checks.push({
      id:row.id,mediaReady,singleScene,noSplitScreen,noCollage,tvFilled,ok,
      repairQueued:!ok,
      visualReview:payload.visualReview?.status||null,
      reason:payload.visualReview?.reason||payload.repairReason||null,
      format:payload.intelligence?.format||"unknown"
    });
  }
  const output={checked:rows.length,ready,missing,repairQueued,checks,skills:["visual-direction","creative-consistency","media-readiness"]};
  await recordAgentExecution(env,client,"DESIGNER",{
    function:"visual-readiness-gate",
    trigger:options.trigger,
    startedAt,
    status:"success",
    model:"visual-readiness-rules+self-healing",
    quantity:rows.length,
    message:ready+" criativo(s) prontos; "+repairQueued+" substituicao(oes) de midia enfileirada(s) automaticamente.",
    metadata:{ready,repairQueued}
  });
  await patchAgentCoreState(env,client.id,{designer:output});
  return output;
}

async function runVideo(env,client,options){
  const startedAt=new Date().toISOString();
  const rows=await ledgerRows(env,client.id,140);
  const videoItems=rows.filter(row=>["reel","story","video"].includes(String(row.payload?.intelligence?.format||"").toLowerCase()));
  const output={candidates:videoItems.length,priorities:videoItems.slice(0,12).map(row=>({id:row.id,format:row.payload?.intelligence?.format||"video",status:row.status})),playbook:{hookSeconds:3,vertical:"9:16",priority:"retencao-compartilhamento",avoidRepeat:true},skills:["reel-structure","video-adaptation","short-form"]};
  await recordAgentExecution(env,client,"VIDEO",{function:"short-form-video-readiness",trigger:options.trigger,startedAt,status:"success",model:"short-form-rules",quantity:videoItems.length,message:videoItems.length+" pauta(s) de video priorizada(s)."});
  await patchAgentCoreState(env,client.id,{video:output});
  return output;
}

async function runGrowth(env,client,options){
  const startedAt=new Date().toISOString();
  const state=await agentCoreState(env,client.id);
  const score=Number(state?.analista?.viralScore||0);
  const experiment=score>=70?"Escalar formato vencedor com variacao de gancho e criativo.":score>=40?"Executar teste A/B de gancho, CTA e horario.":"Explorar novos temas e formatos antes de escalar.";
  const output={viralScore:score,experiment,scaleMode:score>=70?"scale":score>=40?"test":"explore",skills:["growth-experiments","scale-winners","follower-velocity"]};
  await recordAgentExecution(env,client,"GROWTH",{function:"growth-experiment-loop",trigger:options.trigger,startedAt,status:"success",model:"growth-loop-v1",quantity:1,message:experiment});
  await patchAgentCoreState(env,client.id,{growth:output});
  return output;
}

async function runSupport(env,client,options){
  const startedAt=new Date().toISOString();
  const [state,ledger,tickets]=await Promise.all([
    agentCoreState(env,client.id),
    ledgerRows(env,client.id,120),
    env.DB.prepare("SELECT id,status,subject,created_at FROM support_tickets WHERE client_id=?1 ORDER BY created_at DESC LIMIT 50").bind(client.id).all().catch(()=>({results:[]}))
  ]);
  const now=Date.now();
  const transientErrors=new Set([
    "quality_gate_pending",
    "visual_quality_rejected",
    "copy_quality_rejected",
    "unique_media_required",
    "duplicate_media_blocked",
    "duplicate_caption_blocked"
  ]);
  const postErrors=ledger.filter(row=>{
    const error=String(row.error||"").trim();
    if(!error)return false;
    const retryCount=Math.max(0,Number(row.payload?.retryCount||0));
    const updatedMs=Date.parse(String(row.updated_at||row.created_at||""));
    const fresh=!Number.isFinite(updatedMs)||(now-updatedMs)<=24*60*60*1000;
    if(!fresh)return false;
    if(transientErrors.has(error)&&retryCount<3)return false;
    return String(row.status||"")==="failed"&&retryCount>=3;
  }).slice(0,20);
  const openTickets=(tickets?.results||[]).filter(row=>String(row.status||"open")!=="closed");
  const lastCycleError=String(state?.lastCycleStatus||"")==="failed"?String(state?.lastCycleError||""):"";
  const issues=postErrors.length+openTickets.length+(lastCycleError?1:0);
  const output={issues,postErrors:postErrors.map(row=>({id:row.id,error:String(row.error||"").slice(0,240)})),openTickets,lastCycleError,skills:["operational-health","integration-issues","incident-triage"]};
  await recordAgentExecution(env,client,"SUPORTE",{function:"operational-health-check",trigger:options.trigger,startedAt,status:issues?"warning":"success",model:"ops-health-rules",quantity:issues,message:issues?issues+" pendencia(s) operacional(is) real(is) detectada(s).":"Nenhuma pendencia operacional critica detectada."});
  await patchAgentCoreState(env,client.id,{suporte:output});
  return output;
}

export async function runExtendedAgents(env,clientId,options={}){
  const client=await getClient(env,clientId); if(!client)throw new Error("client_not_found");
  const config=normalizeAgentCoreConfig(client);
  const requested=String(options.agent||"all").toLowerCase();
  const phase=String(options.phase||"");
  const run=id=>requested==="all"||requested===id;
  const out={};

  // Full-cycle phase routing prevents duplicate work and ensures that decisions
  // flow forward: research -> strategy -> creation -> quality -> publish -> feedback.
  if(phase==="pre-publish"&&requested==="all"){
    if(config.modules["copy-chief"])out["copy-chief"]=await runCopyChief(env,client,options);
    if(config.modules.designer)out.designer=await runDesigner(env,client,options);
    if(config.modules.video)out.video=await runVideo(env,client,options);
    return out;
  }

  if(run("pesquisador")&&config.modules.pesquisador)out.pesquisador=await runResearcher(env,client,options);
  if(run("analista")&&config.modules.analista)out.analista=await runAnalyst(env,client,options);
  if(run("copy-chief")&&config.modules["copy-chief"])out["copy-chief"]=await runCopyChief(env,client,options);
  if(run("designer")&&config.modules.designer)out.designer=await runDesigner(env,client,options);
  if(run("video")&&config.modules.video)out.video=await runVideo(env,client,options);
  if(run("growth")&&config.modules.growth)out.growth=await runGrowth(env,client,options);
  if(run("suporte")&&config.modules.suporte)out.suporte=await runSupport(env,client,options);
  return out;
}
