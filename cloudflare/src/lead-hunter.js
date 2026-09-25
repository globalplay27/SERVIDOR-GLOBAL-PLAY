import { getClient } from "./clients.js";
import { resolveInstagramCredentials } from "./instagram-credentials.js";
import { openAIResponses } from "./openai.js";
import { ensureLeadSchema, leadsForClient, leadHunterSummary, upsertLead } from "./leads.js";
import { recordAgentExecution } from "./agent-core.js";

function parseJson(raw, fallback = {}) {
  try {
    const value = JSON.parse(String(raw || ""));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function defaultConfig(client) {
  const niche = String(client?.niche || "streaming").trim();
  return {
    enabled: true,
    autoRun: true,
    metaComments: true,
    publicTargets: false,
    aiQualification: true,
    scanIntervalMinutes: 30,
    lookbackDays: 14,
    maxResultsPerRun: 150,
    minScore: 25,
    targets: [],
    intentTerms: [
      "quero","teste","testar","preço","preco","valor","assinar","comprar","plano","interesse",
      "como funciona","link","manda","me chama","onde","indica","recomenda","recomendação","recomendacao",
      "vale a pena","qual","como","tem","funciona"
    ],
    nicheTerms: [niche].filter(Boolean)
  };
}

export async function leadHunterConfig(env, client) {
  const row = await env.DB.prepare(
    "SELECT value_json FROM nexus_state WHERE namespace = 'lead-hunter' AND item_key = 'config' AND client_id = ?1 LIMIT 1"
  ).bind(client.id).first();
  const base = defaultConfig(client);
  const stored = row ? parseJson(row.value_json, {}) : {};
  return {
    ...base,
    ...stored,
    enabled: stored.enabled === undefined ? base.enabled : stored.enabled !== false,
    autoRun: stored.autoRun === undefined ? base.autoRun : stored.autoRun !== false,
    metaComments: stored.metaComments === undefined ? base.metaComments : stored.metaComments !== false,
    publicTargets: stored.publicTargets === true,
    aiQualification: stored.aiQualification === undefined ? base.aiQualification : stored.aiQualification !== false,
    scanIntervalMinutes: Math.max(15, Math.min(1440, Number(stored.scanIntervalMinutes || base.scanIntervalMinutes))),
    lookbackDays: Math.max(1, Math.min(30, Number(stored.lookbackDays || base.lookbackDays))),
    maxResultsPerRun: Math.max(10, Math.min(250, Number(stored.maxResultsPerRun || base.maxResultsPerRun))),
    minScore: Math.max(10, Math.min(90, Number(stored.minScore || base.minScore))),
    targets: Array.isArray(stored.targets) ? stored.targets.map(String).filter(Boolean).slice(0,20) : base.targets,
    intentTerms: Array.isArray(stored.intentTerms) ? stored.intentTerms.map(String).filter(Boolean).slice(0,40) : base.intentTerms,
    nicheTerms: Array.isArray(stored.nicheTerms) ? stored.nicheTerms.map(String).filter(Boolean).slice(0,30) : base.nicheTerms
  };
}

export async function saveLeadHunterConfig(env, client, patch = {}) {
  const current = await leadHunterConfig(env, client);
  const next = {
    ...current,
    enabled: patch.enabled === undefined ? current.enabled : Boolean(patch.enabled),
    autoRun: patch.autoRun === undefined ? current.autoRun : Boolean(patch.autoRun),
    metaComments: patch.metaComments === undefined ? current.metaComments : Boolean(patch.metaComments),
    publicTargets: patch.publicTargets === undefined ? current.publicTargets : Boolean(patch.publicTargets),
    aiQualification: patch.aiQualification === undefined ? current.aiQualification : Boolean(patch.aiQualification),
    scanIntervalMinutes: Math.max(15, Math.min(1440, Number(patch.scanIntervalMinutes ?? current.scanIntervalMinutes))),
    lookbackDays: Math.max(1, Math.min(30, Number(patch.lookbackDays ?? current.lookbackDays))),
    maxResultsPerRun: Math.max(10, Math.min(250, Number(patch.maxResultsPerRun ?? current.maxResultsPerRun))),
    minScore: Math.max(10, Math.min(90, Number(patch.minScore ?? current.minScore))),
    targets: Array.isArray(patch.targets) ? patch.targets.map(String).map(v=>v.trim()).filter(Boolean).slice(0,20) : current.targets,
    intentTerms: Array.isArray(patch.intentTerms) ? patch.intentTerms.map(String).map(v=>v.trim()).filter(Boolean).slice(0,40) : current.intentTerms,
    nicheTerms: Array.isArray(patch.nicheTerms) ? patch.nicheTerms.map(String).map(v=>v.trim()).filter(Boolean).slice(0,30) : current.nicheTerms,
    updatedAt: new Date().toISOString()
  };
  await env.DB.prepare(
    "INSERT INTO nexus_state(namespace,item_key,client_id,value_json,updated_at) VALUES('lead-hunter','config',?1,?2,CURRENT_TIMESTAMP) ON CONFLICT(namespace,item_key,client_id) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP"
  ).bind(client.id, JSON.stringify(next)).run();
  return next;
}

async function collectMetaComments(env, client, config) {
  const conn = await resolveInstagramCredentials(env, client.id);
  const token = String(conn?.accessToken || "");
  const igUserId = String(conn?.igUserId || "").trim();
  if (!token || !igUserId) return { items: [], error: "instagram_not_connected", source: "meta-comments" };

  const headers = { authorization:"Bearer "+token, accept:"application/json", "user-agent":"NEXUS-LeadHunter-Cloudflare/1.0" };
  const mediaUrl = "https://graph.instagram.com/" + encodeURIComponent(igUserId) + "/media?fields=" + encodeURIComponent("id,permalink,timestamp") + "&limit=12";
  const mediaResponse = await fetch(mediaUrl, { headers });
  const mediaPayload = await mediaResponse.json().catch(()=>({}));
  if (!mediaResponse.ok) return { items:[], error:String(mediaPayload?.error?.message || "instagram_media_"+mediaResponse.status), source:"meta-comments" };

  const cutoff = Date.now() - config.lookbackDays * 86400000;
  const ownUsername = String(conn?.username || conn?.label || client.instagram || "").replace(/^@/,"").toLowerCase();
  const items = [];
  const errors = [];

  for (const media of Array.isArray(mediaPayload.data) ? mediaPayload.data : []) {
    if (items.length >= config.maxResultsPerRun) break;
    const mediaTime = media.timestamp ? new Date(media.timestamp).getTime() : Date.now();
    if (Number.isFinite(mediaTime) && mediaTime < cutoff) continue;

    const commentsUrl = "https://graph.instagram.com/" + encodeURIComponent(String(media.id)) + "/comments?fields=" + encodeURIComponent("id,text,username,timestamp") + "&limit=50";
    try {
      const response = await fetch(commentsUrl, { headers });
      const payload = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(String(payload?.error?.message || "comments_"+response.status));
      for (const comment of Array.isArray(payload.data) ? payload.data : []) {
        if (items.length >= config.maxResultsPerRun) break;
        const username = String(comment.username || "").replace(/^@/,"").trim();
        const message = String(comment.text || "").replace(/\s+/g," ").trim();
        if (!username || !message || username.toLowerCase() === ownUsername) continue;
        items.push({
          externalId:String(comment.id || ""),
          instagramUsername:username,
          instagramUserId:"",
          message:message.slice(0,700),
          source:"meta-comment",
          sourceUrl:String(media.permalink || ""),
          createdAt:comment.timestamp || media.timestamp || new Date().toISOString()
        });
      }
    } catch (error) {
      errors.push(String(error?.message || error).slice(0,180));
    }
  }
  return { items, errors, source:"meta-comments" };
}

function localQualification(candidate, config) {
  const message = String(candidate.message || "").trim();
  const low = message.toLowerCase();
  let score = 12;
  let intent = "interação";

  if (/\bquero\b/.test(low)) { score += 55; intent = "QUERO"; }
  if (/\b(teste|testar)\b/.test(low)) { score += 26; if(intent==="interação") intent="teste"; }
  if (/\b(pre[cç]o|valor|plano|quanto|assinar|comprar)\b/.test(low)) { score += 30; if(intent==="interação") intent="compra/preço"; }
  if (/\b(link|manda|me chama|onde|indica|recomenda|recomendação|recomendacao|vale a pena)\b/.test(low)) {
    score += 18;
    if(intent==="interação") intent="curiosidade/recomendação";
  }
  if (/\b(como|qual|funciona|tem)\b/.test(low)) {
    score += 10;
    if(intent==="interação") intent="dúvida";
  }
  if (/\?/.test(message)) score += 12;

  const intentMatches = (config.intentTerms || []).filter(term => term && low.includes(String(term).toLowerCase()));
  score += Math.min(28, intentMatches.length * 7);
  const nicheMatches = (config.nicheTerms || []).filter(term => {
    const clean = String(term || "").trim().toLowerCase();
    return clean.length >= 3 && low.includes(clean);
  });
  score += Math.min(16, nicheMatches.length * 4);
  if (candidate.source === "meta-comment") score += 8;

  score = Math.max(0, Math.min(100, score));
  const temperature = score >= 68 ? "hot" : score >= 38 ? "warm" : "cold";
  const needsHuman = temperature==="hot" || (/\?/.test(message) && score>=38);
  return { ...candidate, score, temperature, intent, needsHuman };
}

function responseText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (typeof part?.text === "string") return part.text;
    }
  }
  return "";
}

async function qualifyWithAI(env, client, candidates, config) {
  if (!config.aiQualification || !candidates.length) return candidates;
  const sample = candidates.slice(0,30).map((item,index)=>({index,username:item.instagramUsername,message:item.message,localScore:item.score,localIntent:item.intent}));
  const prompt = [
    "Você é ODIN, qualificador de leads do NEXUS AI.",
    "Analise comentários do Instagram para intenção comercial, curiosidade e sinais que podem virar seguidores ou conteúdo.",
    "Retorne SOMENTE JSON válido no formato {\"items\":[{\"index\":0,\"score\":0,\"intent\":\"...\",\"needsHuman\":false}]}",
    "Score 0-100. QUERO, preço, teste, compra, pedido de link, recomendação e perguntas úteis devem receber prioridade.",
    "Não incentive spam nem contato frio; priorize respostas a interações recebidas.",
    "Nicho: " + String(client.niche || ""),
    JSON.stringify(sample)
  ].join("\n");
  try {
    const result = await openAIResponses(env, client.id, { model:"gpt-5.6-luna", input:prompt });
    let raw = responseText(result).trim().replace(/^\x60\x60\x60(?:json)?/i,"").replace(/\x60\x60\x60$/,"").trim();
    const parsed = JSON.parse(raw);
    const byIndex = new Map((Array.isArray(parsed?.items)?parsed.items:[]).map(item=>[Number(item.index),item]));
    return candidates.map((item,index)=>{
      const ai=byIndex.get(index);
      if(!ai)return item;
      const score=Math.max(item.score,Math.max(0,Math.min(100,Number(ai.score||0))));
      return {...item,score,temperature:score>=70?"hot":score>=45?"warm":"cold",intent:String(ai.intent||item.intent||"interação").slice(0,300),needsHuman:ai.needsHuman===true||item.needsHuman};
    });
  } catch {
    return candidates;
  }
}

async function persistQualified(env, client, candidates, config) {
  let newLeads=0, updatedLeads=0, ignored=0;
  for(const candidate of candidates){
    if(candidate.score < config.minScore){ignored+=1;continue;}
    const username=String(candidate.instagramUsername||"").toLowerCase();
    const existing=username ? await env.DB.prepare(
      "SELECT id,evidence_count FROM leads WHERE client_id=?1 AND lower(instagram_username)=?2 LIMIT 1"
    ).bind(client.id,username).first() : null;
    const id=existing?.id || client.id+":"+(candidate.externalId||username||crypto.randomUUID());
    await upsertLead(env,client,{
      id,
      instagramUsername:candidate.instagramUsername,
      instagramUserId:candidate.instagramUserId,
      temperature:candidate.temperature,
      score:candidate.score,
      stage:"new",
      intent:candidate.intent,
      needsHuman:candidate.needsHuman,
      lastMessage:candidate.message,
      lastContactAt:candidate.createdAt,
      source:candidate.source,
      sourceUrl:candidate.sourceUrl,
      evidenceCount:Math.max(1,Number(existing?.evidence_count||0)+1),
      sources:[candidate.source]
    });
    if(existing)updatedLeads+=1;else newLeads+=1;
  }
  return {newLeads,updatedLeads,ignored};
}

export async function leadHunterView(env, client) {
  await ensureLeadSchema(env);
  const [config,summary,leads]=await Promise.all([
    leadHunterConfig(env,client),
    leadHunterSummary(env,client.id),
    leadsForClient(env,client.id,100)
  ]);
  return {config,summary,leads};
}

export async function runLeadHunter(env, clientId, options = {}) {
  await ensureLeadSchema(env);
  const client=await getClient(env,clientId);
  if(!client)throw new Error("client_not_found");
  const config=await leadHunterConfig(env,client);
  if(!config.enabled)return {ok:false,skipped:"disabled",view:await leadHunterView(env,client)};

  const startedAt=new Date().toISOString();
  const errors=[];
  const sources={};
  let raw=[];

  if(config.metaComments){
    const meta=await collectMetaComments(env,client,config);
    raw.push(...(meta.items||[]));
    sources.metaComments=(meta.items||[]).length;
    if(meta.error)errors.push("Meta: "+meta.error);
    for(const err of meta.errors||[])errors.push("Meta: "+err);
  }
  if(config.publicTargets && config.targets.length){
    errors.push("Public targets ainda não executados pelo Worker; comentários da própria conta estão ativos.");
    sources.publicTargets=0;
  }

  const unique=[],seen=new Set();
  for(const item of raw){
    const key=String(item.externalId||(item.instagramUsername+"|"+item.message)).toLowerCase();
    if(!key||seen.has(key))continue;
    seen.add(key);unique.push(item);
  }
  raw=unique.slice(0,config.maxResultsPerRun);
  let qualified=raw.map(item=>localQualification(item,config));
  qualified=await qualifyWithAI(env,client,qualified,config);
  const merge=await persistQualified(env,client,qualified,config);

  const finishedAt=new Date().toISOString();
  const status=errors.length&&!raw.length?"warning":"success";
  const runId="lh_"+crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO lead_hunter_runs(id,client_id,status,started_at,finished_at,analyzed,new_leads,updated_leads,ignored,model,cost_usd,payload_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,0,?11,CURRENT_TIMESTAMP)"
  ).bind(runId,client.id,status,startedAt,finishedAt,raw.length,merge.newLeads,merge.updatedLeads,merge.ignored,config.aiQualification?"local+openai":"local-intent-engine",JSON.stringify({sources,errors:errors.slice(0,20),trigger:String(options.trigger||"manual")})).run();

  await recordAgentExecution(env,client,"RADAR",{
    function:"nexus-lead-hunter",trigger:options.trigger||"manual",startedAt,status,
    model:config.aiQualification?"local+openai":"local-intent-engine",quantity:raw.length,
    message:raw.length?"Lead Hunter analisou "+raw.length+" interação(ões).":"Lead Hunter executou a coleta; nenhuma nova interação utilizável foi encontrada.",
    metadata:{sources,newLeads:merge.newLeads,updatedLeads:merge.updatedLeads,ignored:merge.ignored,errors:errors.slice(0,5)}
  });
  await recordAgentExecution(env,client,"ODIN",{
    function:"lead-qualification",trigger:options.trigger||"manual",startedAt,status,
    model:config.aiQualification?"gpt-5.6-luna+rules":"local-rules",quantity:merge.newLeads+merge.updatedLeads,
    message:merge.newLeads+" novo(s) lead(s), "+merge.updatedLeads+" atualizado(s).",
    metadata:{newLeads:merge.newLeads,updatedLeads:merge.updatedLeads,ignored:merge.ignored}
  });

  const view=await leadHunterView(env,client);
  return {ok:true,run:{id:runId,clientId:client.id,status,startedAt,finishedAt,analyzed:raw.length,newLeads:merge.newLeads,updatedLeads:merge.updatedLeads,ignored:merge.ignored,sources,errors},view};
}

export async function discardLead(env, clientId, leadId) {
  await ensureLeadSchema(env);
  await env.DB.prepare("DELETE FROM leads WHERE id=?1 AND client_id=?2").bind(String(leadId),String(clientId)).run();
  const client=await getClient(env,clientId);
  if(!client)throw new Error("client_not_found");
  return leadHunterView(env,client);
}
