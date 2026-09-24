const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let sessionAuth=null,currentClient=null;

function nextPostTime(times=[]){if(!Array.isArray(times)||!times.length)return"—";const parts=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());const now=Number(parts.find(p=>p.type==="hour")?.value||0)*60+Number(parts.find(p=>p.type==="minute")?.value||0);const sorted=times.map(v=>{const[h,m]=String(v).split(":").map(Number);return{v,m:h*60+m}}).filter(x=>Number.isFinite(x.m)).sort((a,b)=>a.m-b.m);return sorted.find(x=>x.m>now)?.v||sorted[0]?.v||"—";}
function showView(name){$("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===name));["overview","posts","capture","leads","videos","trailers","posting","support","setup"].forEach(v=>{const el=$("#view-"+v);if(el)el.hidden=v!==name;});if(name==="support")loadSupportTickets();if(name==="posts")loadClientPosts();if(name==="capture")loadLeadHunter();if(name==="leads")loadClientLeads();if(name==="videos"){ensureBulkVideoScheduler();loadVideoJobs();}if(name==="overview"){loadAgentTeam();loadTokenUsage();}}
function onboardingKeys(){return["github","railway","openai","facebook","instagram","metaApp","creativeProfile","supportRequested"];}
function setupPercent(){const o=currentClient?.onboarding||{};const keys=onboardingKeys();return Math.round(keys.filter(k=>o[k]).length/keys.length*100);}
function renderOnboarding(){
  const o=currentClient?.onboarding||{},pct=setupPercent();$("#setup-progress").textContent=pct+"%";$("#setup-banner").hidden=true;const hero=document.querySelector(".setup-hero-card");if(hero)hero.hidden=true;
  $$(".wizard-step").forEach(card=>{const key=card.dataset.step,done=Boolean(o[key]);card.classList.toggle("done",done);const state=card.querySelector(".step-state");if(state)state.textContent=done?"Concluído":"Pendente";});
  $("#mode-new").classList.toggle("selected",(currentClient?.setupMode||"ready")==="new");$("#mode-ready").classList.toggle("selected",(currentClient?.setupMode||"ready")==="ready");
}
function renderConnections(connections={}){
  const labels={github:"github-connection",railway:"railway-connection",openai:"openai-connection"};
  for(const [provider,id] of Object.entries(labels)){
    const item=connections[provider]||{};
    const el=$("#"+id);
    if(!el)continue;
    if(item.direct){
      el.textContent="Conectado diretamente"+(item.label?" · "+item.label:"");
      el.className="provider-line connected";
    }else if(item.connected){
      el.textContent="Configuração existente no agente";
      el.className="provider-line legacy";
    }else{
      el.textContent="Não conectado diretamente";
      el.className="provider-line";
    }
  }
}

async function loadAgentTeam(){
  const root=$("#client-agent-team");
  if(!root||!currentClient)return;
  try{
    const r=await fetch("/api/portal/agent-core",{credentials:"same-origin",headers:sessionAuth?{"x-nexus-session":sessionAuth}:{}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||"agent_core_unavailable");
    const modules=Array.isArray(d.modules)?d.modules:[];
    const states=d.state?.modules||{};
    root.innerHTML=modules.map(module=>{
      const state=states[module.id]||{};
      const status=String(state.status||"idle");
      const label=status==="success"?"ATIVO":status==="warning"?"ATENÇÃO":status==="failed"?"FALHA":status==="blocked"?"BLOQUEADO":"AGUARDANDO";
      const skills=(module.skills||[]).join(" · ");
      return '<article class="client-agent-worker '+escapeSupport(status)+'">'
        +'<div><strong>'+escapeSupport(module.name||module.id)+'</strong><span>'+escapeSupport(skills||"operação NEXUS")+'</span></div>'
        +'<b>'+label+'</b><small>'+escapeSupport(state.message||"Pronto para o próximo ciclo.")+'</small>'
        +'</article>';
    }).join("")||'<div class="post-client-empty"><strong>Equipe pronta</strong><span>Nenhuma execução registrada ainda.</span></div>';
  }catch{
    root.innerHTML='<div class="post-client-empty"><strong>Equipe indisponível</strong><span>Não foi possível sincronizar os agentes agora.</span></div>';
  }
}

function renderClient(c){
  currentClient=c;
  renderConnections(c.connections||{});
  const online=c.status==="online";
  const coreState=$("#core-agent-state");
  if(coreState)coreState.textContent=online?"Operacional":"Configurando";
  $("#client-name").textContent=c.name;
  $("#client-meta").textContent=(c.niche||"Outro")+" · ambiente exclusivo";
  $("#next-post").textContent=nextPostTime(c.postTimes);
  $("#instagram-card").textContent=c.instagram||"Aguardando conexão";
  const aiCard=$("#ai-mode-card"),aiDetail=$("#ai-mode-detail");
  if(aiCard)aiCard.textContent=c.id==="ragnar-one"?"CONTA PRÓPRIA":"NEXUS";
  if(aiDetail)aiDetail.textContent=c.id==="ragnar-one"
    ?"conta OpenAI própria · separada do NEXUS"
    :"IA gerenciada pelo NEXUS";
  $("#overview-agent-status").textContent=online?"ONLINE":"CONFIGURANDO";
  $("#niche").textContent=c.niche||"Outro";
  $("#agent-status").textContent=online?"Online":"Em configuração";
  $("#post-times").textContent=(c.postTimes||[]).join(" · ")||"—";
  const igButton=$("#instagram-connect"),igStatus=$("#instagram-connect-status");
  if(igButton){
    const connected=Boolean(c.instagram);
    igButton.disabled=connected;
    igButton.textContent=connected?"Instagram conectado":"Conectar Instagram";
    igButton.classList.toggle("connected",connected);
  }
  if(igStatus)igStatus.textContent=c.instagram?c.instagram+" autorizado":"";
  populateAgentProfile(c);
  renderOnboarding();
}

let pendingProfileLogo=null;
let removeProfileLogo=false;
function setField(id,value){const el=$(id);if(el)el.value=value??"";}
function profileInitials(value){return String(value||"NX").trim().split(/\s+/).filter(Boolean).map(v=>v[0]).join("").slice(0,2).toUpperCase()||"NX";}
function updateAgentProfilePreview(){
  const primary=$("#profile-primary")?.value||"#22c55e";
  const secondary=$("#profile-secondary")?.value||"#050807";
  const preview=$("#agent-profile-preview");
  if(preview){
    preview.style.setProperty("--profile-primary",primary);
    preview.style.setProperty("--profile-secondary",secondary);
  }
  if($("#profile-primary-text"))$("#profile-primary-text").textContent=primary;
  if($("#profile-secondary-text"))$("#profile-secondary-text").textContent=secondary;
  const brand=$("#profile-brand-name")?.value||currentClient?.name||"Sua marca";
  const agent=$("#profile-agent-name")?.value||"Agente NEXUS";
  const niche=$("#profile-niche")?.value||"Seu segmento";
  const cta=$("#profile-cta")?.value||"Sua chamada aparecerá aqui";
  if($("#profile-preview-brand"))$("#profile-preview-brand").textContent=brand;
  if($("#profile-preview-agent"))$("#profile-preview-agent").textContent=agent;
  if($("#profile-preview-niche"))$("#profile-preview-niche").textContent=niche.toUpperCase();
  if($("#profile-preview-cta"))$("#profile-preview-cta").textContent=cta;
  if($("#profile-preview-initials"))$("#profile-preview-initials").textContent=profileInitials(brand);
}
function showStoredProfileLogo(url){
  const preview=$("#profile-preview-logo"),stage=$("#profile-logo-stage-image"),initials=$("#profile-preview-initials"),placeholder=$("#profile-logo-stage-placeholder");
  if(url){
    if(preview){preview.src=url;preview.hidden=false;}
    if(stage){stage.src=url;stage.hidden=false;}
    if(initials)initials.hidden=true;
    if(placeholder)placeholder.hidden=true;
  }else{
    if(preview){preview.removeAttribute("src");preview.hidden=true;}
    if(stage){stage.removeAttribute("src");stage.hidden=true;}
    if(initials)initials.hidden=false;
    if(placeholder)placeholder.hidden=false;
  }
}
function populateAgentProfile(c){
  const p=c.agentProfile||{};
  setField("#profile-agent-name",p.agentName||"");
  setField("#profile-brand-name",p.brandName||c.name||"");
  setField("#profile-niche",p.niche||c.niche||"");
  setField("#profile-audience",p.audience||"");
  setField("#profile-goal",p.goal||"Vender mais");
  setField("#profile-region",p.region||"");
  setField("#profile-offer",p.offer||"");
  setField("#profile-services",p.services||"");
  setField("#profile-differentials",p.differentials||"");
  setField("#profile-tone",p.tone||"");
  setField("#profile-cta",p.cta||"");
  setField("#profile-avoid",p.avoidTopics||"");
  setField("#profile-notes",p.notes||"");
  setField("#profile-whatsapp",p.whatsapp||"");
  setField("#profile-website",p.website||"");
  setField("#profile-primary",p.primaryColor||c.primaryColor||"#22c55e");
  setField("#profile-secondary",p.secondaryColor||c.secondaryColor||"#050807");
  pendingProfileLogo=null;
  removeProfileLogo=false;
  showStoredProfileLogo(p.logoUrl||"");
  updateAgentProfilePreview();
  const status=$("#profile-save-status");
  if(status)status.textContent=p.submittedAt?"Perfil enviado ao NEXUS. Você pode atualizá-lo quando quiser.":"";
}
async function optimizeLogo(file){
  if(!file||!file.type.startsWith("image/"))throw new Error("Selecione uma imagem válida.");
  if(file.size>6*1024*1024)throw new Error("A logo deve ter no máximo 6 MB.");
  const source=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error("Não foi possível ler a imagem."));img.src=URL.createObjectURL(file);});
  const max=700,scale=Math.min(1,max/Math.max(source.width,source.height)),w=Math.max(1,Math.round(source.width*scale)),h=Math.max(1,Math.round(source.height*scale));
  const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;canvas.getContext("2d").drawImage(source,0,0,w,h);
  return canvas.toDataURL("image/webp",0.86);
}
function formatTokenCount(value){
  const number=Math.max(0,Number(value||0));
  try{return new Intl.NumberFormat("pt-BR",{maximumFractionDigits:0}).format(number);}
  catch{return String(Math.round(number));}
}
async function loadTokenUsage(){
  if(!currentClient)return;
  const state=$("#token-budget-state"),used=$("#token-used-today"),limit=$("#token-daily-limit"),remaining=$("#token-remaining"),bar=$("#token-budget-bar"),calls=$("#token-call-count"),detail=$("#token-budget-detail");
  try{
    const r=await fetch("/api/portal/token-usage",{credentials:"same-origin",headers:sessionAuth?{"x-nexus-session":sessionAuth}:{}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||"token_usage_unavailable");
    if(used)used.textContent=formatTokenCount(d.usedTokens);
    if(limit)limit.textContent=formatTokenCount(d.limitTokens);
    if(remaining)remaining.textContent=formatTokenCount(d.remainingTokens);
    if(calls)calls.textContent=Number(d.calls||0)+" chamada"+(Number(d.calls||0)===1?"":"s")+" registrada"+(Number(d.calls||0)===1?"":"s");
    if(bar)bar.style.width=Math.max(0,Math.min(100,Number(d.percent||0)))+"%";
    if(state){
      state.textContent=d.blocked?"LIMITE ATINGIDO":Number(d.percent||0)>=80?"ATENÇÃO":"DISPONÍVEL";
      state.classList.toggle("off",Boolean(d.blocked));
      state.classList.toggle("warning",!d.blocked&&Number(d.percent||0)>=80);
    }
    if(detail)detail.textContent=d.blocked
      ?"O limite de hoje foi atingido. Novas chamadas de IA ficam bloqueadas até a virada do dia em São Paulo."
      :"Uso de hoje: "+Number(d.percent||0)+"% do limite. A contagem reinicia à meia-noite no horário de São Paulo.";
  }catch{
    if(state){state.textContent="INDISPONÍVEL";state.classList.add("off");}
    if(detail)detail.textContent="Não foi possível sincronizar o consumo de tokens agora.";
  }
}

async function providerUsage(){
  if(currentClient?.managedInfrastructure)return;
  try{
    const r=await fetch("/api/portal/provider-usage",{headers:{"x-nexus-session":sessionAuth}});
    if(!r.ok)return;
    const d=await r.json();
    const oa=$("#live-openai"),oad=$("#live-openai-detail"),rw=$("#live-railway"),rwd=$("#live-railway-detail");
    if(d.openai?.connected&&oa){
      oa.textContent=d.openai.costAvailable?("US$ "+Number(d.openai.cost31dUsd||0).toFixed(2)+" / 31 dias"):"OpenAI conectada";
      if(oad)oad.textContent=d.openai.costAvailable?"Custo obtido da API da organização.":"Chave do projeto validada.";
    }
    if(d.railway?.connected&&rw){
      rw.textContent=d.railway.projectCount!=null?(d.railway.projectCount+" projeto(s) autorizado(s)"):"Railway conectada";
      if(rwd)rwd.textContent=(d.railway.projects||[]).slice(0,3).map(p=>p.name).filter(Boolean).join(" · ")||"Autorização Railway ativa.";
    }
  }catch{}
}

setInterval(()=>{
  if(currentClient&&!$("#portal-view")?.hidden)loadTokenUsage();
},30000);

async function liveStatus(){
  try{
    const r=await fetch("/api/portal/live-status",{headers:{"x-nexus-session":sessionAuth}});
    const d=await r.json();
    const configured=currentClient?.status==="online";
    if(!d.connected){
      $("#agent-live-chip").textContent=configured?"ATIVO":"CONFIGURANDO";
      $("#agent-live-chip").classList.toggle("off",!configured);
      $("#agent-status").textContent=configured?"Online":"Em configuração";
      $("#overview-agent-status").textContent=configured?"ATIVO":"CONFIGURANDO";
      return;
    }
    $("#agent-live-chip").textContent="ONLINE";
    $("#agent-live-chip").classList.remove("off");
    $("#agent-status").textContent="Online";
    $("#overview-agent-status").textContent="ONLINE";
    if(Array.isArray(d.post_times)&&d.post_times.length){
      currentClient.postTimes=d.post_times;
      $("#post-times").textContent=d.post_times.join(" · ");
      $("#next-post").textContent=nextPostTime(d.post_times);
    }
    if(d.last_post){
      $("#last-post").textContent=d.last_post.time||d.last_post.slot||"Publicado";
      $("#last-post-detail").textContent=d.last_post.media_id?("ID "+d.last_post.media_id):"publicação confirmada";
    }
    $("#last-agent-error").textContent=d.last_error?String(d.last_error).slice(0,90):"Nenhum";
  }catch(e){
    const configured=currentClient?.status==="online";
    $("#agent-live-chip").textContent=configured?"ATIVO":"CONFIGURANDO";
    $("#agent-live-chip").classList.toggle("off",!configured);
    $("#agent-status").textContent=configured?"Online":"Em configuração";
    $("#overview-agent-status").textContent=configured?"ATIVO":"CONFIGURANDO";
  }
}
async function loadConnections(){
  try{
    const r=await fetch("/api/portal/connections",{headers:{"x-nexus-session":sessionAuth}});
    if(!r.ok)return null;
    const d=await r.json();
    currentClient.connections=d.connections||{};
    currentClient.onboarding=d.onboarding||currentClient.onboarding||{};
    renderConnections(currentClient.connections);
    renderOnboarding();
    return d;
  }catch{return null;}
}

let connectionProvider="";
function openConnectionModal(provider){
  connectionProvider=provider;
  $("#connection-error").textContent="";
  $("#github-fields").hidden=provider!=="github";
  $("#openai-fields").hidden=provider!=="openai";
  $("#connection-title").textContent=provider==="github"?"Conectar GitHub":"Conectar OpenAI";
  $("#connection-help").textContent=provider==="github"
    ?"Cole um token de acesso do GitHub. Não use sua senha."
    :"Cole a chave da API do projeto. A chave administrativa para custos é opcional.";
  $("#connection-modal").hidden=false;
}
function closeConnectionModal(){
  $("#connection-modal").hidden=true;connectionProvider="";
  $("#github-token").value="";$("#openai-key").value="";$("#openai-admin-key").value="";
  $("#connection-error").textContent="";
}
async function startRailwayConnection(){
  const button=$('[data-connect="railway"]');
  button.disabled=true;button.textContent="Abrindo autorização…";
  try{
    const r=await fetch("/api/oauth/railway/start",{headers:{"x-nexus-session":sessionAuth}});
    const d=await r.json();
    if(!r.ok||!d.url)throw new Error("Não foi possível iniciar a conexão Railway.");
    const popup=window.open(d.url,"nexus-railway-oauth","width=720,height=760");
    let tries=0;
    const timer=setInterval(async()=>{
      tries++;
      const status=await loadConnections();
      if(status?.connections?.railway?.direct||tries>90||popup?.closed){
        clearInterval(timer);
        button.disabled=false;button.textContent="Conectar Railway";
        if(status?.connections?.railway?.direct){await providerUsage();}
      }
    },1500);
  }catch(error){
    button.disabled=false;button.textContent="Conectar Railway";alert(error.message);
  }
}

let instagramOauthTimer=null;
async function refreshPortalClient(){
  try{
    const r=await fetch("/api/portal/session",{credentials:"same-origin"});
    if(!r.ok)return null;
    const c=await r.json();
    renderClient(c);
    return c;
  }catch{return null;}
}
async function startInstagramConnection(){
  const button=$("#instagram-connect"),status=$("#instagram-connect-status");
  if(!button||button.disabled)return;
  button.disabled=true;
  button.textContent="Abrindo Instagram…";
  if(status)status.textContent="";
  try{
    const r=await fetch("/api/portal/instagram/start",{credentials:"same-origin"});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.url){
      if(d.error==="instagram_nexus_not_configured"){
        throw new Error("O administrador ainda precisa ativar a conexão central do Instagram.");
      }
      throw new Error("Não foi possível iniciar a conexão do Instagram.");
    }
    const popup=window.open(d.url,"nexus-instagram-oauth","width=620,height=760");
    if(!popup)throw new Error("Permita a abertura da janela do Instagram.");
    if(status)status.textContent="Autorize sua conta na janela do Instagram.";
    let tries=0;
    clearInterval(instagramOauthTimer);
    instagramOauthTimer=setInterval(async()=>{
      tries++;
      const c=await refreshPortalClient();
      if(c?.instagram){
        clearInterval(instagramOauthTimer);
        instagramOauthTimer=null;
        if(status)status.textContent=c.instagram+" conectado com sucesso.";
        try{popup.close();}catch{}
        return;
      }
      if(tries>120||popup.closed){
        clearInterval(instagramOauthTimer);
        instagramOauthTimer=null;
        button.disabled=false;
        button.textContent="Conectar Instagram";
      }
    },1500);
  }catch(error){
    button.disabled=false;
    button.textContent="Conectar Instagram";
    if(status)status.textContent=error.message;
  }
}
window.addEventListener("message",event=>{
  if(event.data?.type!=="nexus-instagram-oauth")return;
  refreshPortalClient().then(c=>{
    const status=$("#instagram-connect-status");
    if(c?.instagram&&status)status.textContent=c.instagram+" conectado com sucesso.";
  });
});
const instagramConnectButton=$("#instagram-connect");
if(instagramConnectButton)instagramConnectButton.addEventListener("click",startInstagramConnection);

async function patchOnboarding(payload){const r=await fetch("/api/portal/onboarding",{method:"PATCH",headers:{"x-nexus-session":sessionAuth,"content-type":"application/json"},body:JSON.stringify(payload)});if(!r.ok)throw new Error("Falha ao salvar etapa");renderClient(await r.json());}

function escapeSupport(value){const el=document.createElement("span");el.textContent=String(value||"");return el.innerHTML;}
function supportStatusLabel(status){return status==="resolved"?"Resolvido":status==="read"?"Em atendimento":"Novo";}
async function loadSupportTickets(){
  const list=$("#client-support-list");
  try{
    const r=await fetch("/api/portal/support",{headers:{"x-nexus-session":sessionAuth}});
    if(!r.ok)throw new Error();
    const d=await r.json(),tickets=d.tickets||[];
    if(!list)return;
    if(!tickets.length){list.innerHTML='<div class="support-empty-client"><strong>Nenhum chamado ainda</strong><span>Quando precisar, abra um chamado ao lado.</span></div>';return;}
    list.innerHTML=tickets.map(t=>`<article class="client-ticket ${t.status}"><div><strong>${escapeSupport(t.subject)}</strong><span>${escapeSupport(t.category)} · ${supportStatusLabel(t.status)}</span></div><small>${new Date(t.createdAt).toLocaleString("pt-BR")}</small></article>`).join("");
  }catch{if(list)list.innerHTML='<p class="muted">Não foi possível carregar os chamados agora.</p>';}
}

let clientLeadData={summary:{total:0,hot:0,warm:0,cold:0,needsHuman:0},leads:[],source:"stored"};
function leadTemperatureMeta(value){
  const map={hot:["QUENTE","hot"],warm:["MORNO","warm"],cold:["FRIO","cold"]};
  return map[value]||["FRIO","cold"];
}
function formatLeadDate(value){
  if(!value)return"—";
  const date=typeof value==="number"?new Date(value*1000):new Date(value);
  try{return new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"}).format(date);}catch{return"—";}
}
function renderClientLeads(data={}){
  clientLeadData=data||clientLeadData;
  const summary=clientLeadData.summary||{};
  [["#client-leads-total","total"],["#client-leads-hot","hot"],["#client-leads-warm","warm"],["#client-leads-cold","cold"],["#client-leads-human","needsHuman"]].forEach(([selector,key])=>{const el=$(selector);if(el)el.textContent=Number(summary[key]||0);});
  const source=$("#client-leads-source");if(source){
    const src=String(clientLeadData.source||"");
    source.textContent=src.includes("nexus-hunter")&&src.includes("agent")?"NEXUS Lead Hunter + ODIN sincronizados":src.includes("nexus-hunter")?"NEXUS Lead Hunter + ODIN":src==="agent"?"ODIN sincronizado em tempo real":"Aguardando sincronização do agente";
  }
  const body=$("#client-leads-body");if(!body)return;
  const leads=Array.isArray(clientLeadData.leads)?clientLeadData.leads:[];
  body.innerHTML=leads.length?leads.map(lead=>{
    const [label,cls]=leadTemperatureMeta(lead.temperature);
    const handle=lead.instagramUsername?"@"+escapeSupport(String(lead.instagramUsername).replace(/^@/,"")):(lead.instagramUserId?"ID …"+escapeSupport(String(lead.instagramUserId).slice(-6)):"Sem @");
    return `<tr>
      <td><strong>${handle}</strong>${lead.needsHuman?'<small class="human-needed">ATENDIMENTO HUMANO</small>':""}</td>
      <td><span class="lead-temp ${cls}">${label}</span></td>
      <td><strong>${Number(lead.score||0)}</strong></td>
      <td>${escapeSupport(lead.intent||lead.triggerKeyword||"—")}</td>
      <td>${escapeSupport(lead.stage||"—")}</td>
      <td>${formatLeadDate(lead.updatedAt||lead.lastContactAt)}</td>
    </tr>`;
  }).join(""):'<tr><td colspan="6">Nenhum lead captado ainda.</td></tr>';
}
async function loadClientLeads(){
  try{
    const r=await fetch("/api/portal/leads",{credentials:"same-origin"});
    if(!r.ok)throw new Error("Não foi possível sincronizar o Odin.");
    renderClientLeads(await r.json());
  }catch(error){
    const source=$("#client-leads-source");if(source)source.textContent=error.message;
    const body=$("#client-leads-body");if(body)body.innerHTML='<tr><td colspan="6">O Odin não respondeu agora. Tente atualizar.</td></tr>';
  }
}


let leadHunterData={config:{},summary:{},leads:[]};

function leadHunterTempMeta(value){
  const map={hot:["QUENTE","hot"],warm:["MORNO","warm"],cold:["FRIO","cold"]};
  return map[String(value||"cold")]||map.cold;
}

function leadHunterSourceLabel(value){
  const src=String(value||"");
  if(src==="meta-comment")return"Comentário da conta";
  if(src==="public-target")return"Alvo público";
  if(src==="multi-source")return"Múltiplas fontes";
  return src||"NEXUS";
}

function renderLeadHunter(data={}){
  leadHunterData=data&&typeof data==="object"?data:leadHunterData;
  const config=leadHunterData.config||{},summary=leadHunterData.summary||{},leads=Array.isArray(leadHunterData.leads)?leadHunterData.leads:[];

  const set=(id,value)=>{const el=$(id);if(el)el.textContent=value;};
  set("#lead-hunter-total",Number(summary.total||0));
  set("#lead-hunter-hot",Number(summary.hot||0));
  set("#lead-hunter-analyzed",Number(summary.lastAnalyzed||0));
  set("#lead-hunter-new",Number(summary.lastNew||0));
  set("#lead-hunter-last-run",summary.lastRunAt?formatLeadDate(summary.lastRunAt):"—");

  const sourceStatus=$("#lead-hunter-source-status");
  if(sourceStatus){
    const parts=[];
    if(Number(summary.lastSources?.metaComments||0))parts.push(Number(summary.lastSources.metaComments)+" comentários");
    if(Number(summary.lastSources?.publicTargets||0))parts.push(Number(summary.lastSources.publicTargets)+" alvos públicos");
    sourceStatus.textContent=parts.length?parts.join(" · "):(summary.lastRunStatus==="failed"?"Última varredura falhou":"Aguardando sinais");
  }

  const status=$("#lead-hunter-status");
  if(status){
    status.textContent=config.enabled?(config.autoRun?"AUTOMAÇÃO ATIVA":"MODO MANUAL"):"DESATIVADO";
    status.className="save-status "+(config.enabled?"ok":"");
  }

  const assignCheck=(selector,value)=>{const el=$(selector);if(el)el.checked=Boolean(value);};
  assignCheck("#lead-hunter-enabled",config.enabled);
  assignCheck("#lead-hunter-auto",config.autoRun);
  assignCheck("#lead-hunter-meta",config.metaComments);
  assignCheck("#lead-hunter-public",config.publicTargets);
  assignCheck("#lead-hunter-ai",config.aiQualification);

  const assignValue=(selector,value)=>{const el=$(selector);if(el&&document.activeElement!==el)el.value=String(value??"");};
  assignValue("#lead-hunter-interval",config.scanIntervalMinutes||60);
  assignValue("#lead-hunter-lookback",config.lookbackDays||7);
  assignValue("#lead-hunter-limit",config.maxResultsPerRun||100);
  assignValue("#lead-hunter-min-score",config.minScore||35);
  assignValue("#lead-hunter-targets",(config.targets||[]).join("\n"));
  assignValue("#lead-hunter-intents",(config.intentTerms||[]).join(", "));
  assignValue("#lead-hunter-niche-terms",(config.nicheTerms||[]).join(", "));

  const root=$("#lead-hunter-leads");
  if(!root)return;
  if(!leads.length){
    root.innerHTML='<div class="post-client-empty"><strong>Nenhuma oportunidade ainda</strong><span>O RADAR ainda não encontrou uma interação acima do score mínimo.</span></div>';
    return;
  }
  root.innerHTML=leads.slice(0,30).map(lead=>{
    const [label,cls]=leadHunterTempMeta(lead.temperature);
    const username=String(lead.instagramUsername||"").replace(/^@/,"");
    const profileUrl=username?"https://www.instagram.com/"+encodeURIComponent(username)+"/":"";
    const sourceUrl=lead.sourceUrl||profileUrl;
    return '<article class="lead-hunter-row">'
      +'<div class="lead-hunter-person"><strong>'+(username?"@"+escapeSupport(username):"Perfil sem @")+'</strong><span>'+escapeSupport(lead.lastMessage||lead.intent||"Sinal comercial detectado")+'</span></div>'
      +'<div class="lead-hunter-score"><b>'+Number(lead.score||0)+'</b><span>/100</span></div>'
      +'<div><span class="lead-temp '+cls+'">'+label+'</span><small>'+escapeSupport(lead.intent||"interação")+'</small></div>'
      +'<div class="lead-hunter-origin"><strong>'+escapeSupport(leadHunterSourceLabel(lead.source))+'</strong><small>'+Number(lead.evidenceCount||1)+' evidência(s)</small></div>'
      +'<div class="lead-hunter-actions">'+(sourceUrl?'<a target="_blank" rel="noopener" href="'+escapeSupport(sourceUrl)+'">Abrir Instagram</a>':"")+'<button type="button" data-lead-hunter-discard="'+escapeSupport(lead.id)+'">Descartar</button></div>'
      +'</article>';
  }).join("");
}

async function loadLeadHunter(){
  const status=$("#lead-hunter-status");
  try{
    if(status){status.textContent="Sincronizando RADAR…";status.className="save-status";}
    const r=await fetch("/api/portal/lead-hunter",{credentials:"same-origin"});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||"Não foi possível carregar a captação.");
    renderLeadHunter(d);
  }catch(error){
    if(status){status.textContent=error.message;status.className="save-status error";}
    const root=$("#lead-hunter-leads");if(root)root.innerHTML='<div class="post-client-empty"><strong>Captação indisponível</strong><span>'+escapeSupport(error.message)+'</span></div>';
  }
}

async function saveLeadHunterConfig(event){
  event?.preventDefault?.();
  const status=$("#lead-hunter-save-status");
  const button=$("#lead-hunter-form")?.querySelector('button[type="submit"]');
  if(button)button.disabled=true;
  if(status){status.textContent="Salvando…";status.className="save-status";}
  const splitTerms=value=>String(value||"").split(/\r?\n|,/).map(x=>x.trim()).filter(Boolean);
  const payload={
    enabled:Boolean($("#lead-hunter-enabled")?.checked),
    autoRun:Boolean($("#lead-hunter-auto")?.checked),
    metaComments:Boolean($("#lead-hunter-meta")?.checked),
    publicTargets:Boolean($("#lead-hunter-public")?.checked),
    aiQualification:Boolean($("#lead-hunter-ai")?.checked),
    scanIntervalMinutes:Number($("#lead-hunter-interval")?.value||60),
    lookbackDays:Number($("#lead-hunter-lookback")?.value||7),
    maxResultsPerRun:Number($("#lead-hunter-limit")?.value||100),
    minScore:Number($("#lead-hunter-min-score")?.value||35),
    targets:String($("#lead-hunter-targets")?.value||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean),
    intentTerms:splitTerms($("#lead-hunter-intents")?.value),
    nicheTerms:splitTerms($("#lead-hunter-niche-terms")?.value)
  };
  try{
    const r=await fetch("/api/portal/lead-hunter/config",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify(payload)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||"Não foi possível salvar.");
    leadHunterData.config=d.config||leadHunterData.config;
    leadHunterData.summary=d.summary||leadHunterData.summary;
    renderLeadHunter(leadHunterData);
    if(status){status.textContent="Configuração salva.";status.className="save-status ok";}
  }catch(error){
    if(status){status.textContent=error.message;status.className="save-status error";}
  }finally{if(button)button.disabled=false;}
}

async function runLeadHunterNow(){
  const button=$("#lead-hunter-run"),status=$("#lead-hunter-status");
  if(button){button.disabled=true;button.textContent="RADAR captando…";}
  if(status){status.textContent="RADAR coletando · ODIN qualificando…";status.className="save-status";}
  try{
    const r=await fetch("/api/portal/lead-hunter/run",{method:"POST",credentials:"same-origin"});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.message||d.error||"Falha na captação.");
    renderLeadHunter(d.view||d);
    await loadClientLeads();
    await loadAgentTeam();
    const run=d.run||d.view?.run;
    if(status){status.textContent=run?"Concluído · "+Number(run.newLeads||0)+" novo(s) lead(s)":"Varredura concluída.";status.className="save-status ok";}
  }catch(error){
    if(status){status.textContent=error.message;status.className="save-status error";}
  }finally{
    if(button){button.disabled=false;button.textContent="Captar agora";}
  }
}

async function discardLeadHunterLead(id,button){
  if(!id)return;
  button.disabled=true;
  try{
    const r=await fetch("/api/portal/lead-hunter/leads/"+encodeURIComponent(id)+"/discard",{method:"POST",credentials:"same-origin"});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||"Não foi possível descartar.");
    renderLeadHunter(d.view||leadHunterData);
    await loadClientLeads();
  }catch(error){alert(error.message);}
  finally{button.disabled=false;}
}


let clientPosts=[];
function saoPauloDay(value=new Date()){
  const date=value instanceof Date?value:new Date(value);
  try{
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
    const get=t=>parts.find(p=>p.type===t)?.value||"";
    return get("year")+"-"+get("month")+"-"+get("day");
  }catch{return"";}
}
function formatClientPostDate(value){
  if(!value)return"—";
  try{return new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"}).format(new Date(value));}
  catch{return"—";}
}
function clientPostState(post){
  if(post.status==="published")return{label:"ENVIADA",cls:"sent",attention:false};
  if(post.approvalStatus==="correction_requested")return{label:"CORREÇÃO SOLICITADA",cls:"correction",attention:true};
  if(post.approvalStatus==="rejected")return{label:"NÃO APROVADA",cls:"rejected",attention:true};
  if(post.approvalStatus==="approved"&&post.status==="ready")return{label:"APROVADA",cls:"approved",attention:false};
  if(post.status==="publishing")return{label:"ENVIANDO",cls:"working",attention:false};
  if(post.status==="generating")return{label:"EM ANDAMENTO",cls:"working",attention:false};
  if(post.status==="failed")return{label:"FALHOU",cls:"rejected",attention:true};
  if(post.status==="skipped")return{label:"NÃO ENVIADA",cls:"rejected",attention:true};
  return{label:"AGENDADA",cls:"scheduled",attention:false};
}
function renderClientPosts(data={}){
  clientPosts=Array.isArray(data.posts)?data.posts:[];
  const schedule=Array.isArray(data.schedule)?data.schedule:(currentClient?.postTimes||[]);
  if($("#client-post-schedule"))$("#client-post-schedule").textContent=schedule.join(" · ")||"—";
  const today=saoPauloDay();
  const todayPosts=clientPosts.filter(post=>saoPauloDay(post.scheduledFor||post.updatedAt)===today);
  if($("#client-post-today-count"))$("#client-post-today-count").textContent=todayPosts.length;
  if($("#client-post-published-count"))$("#client-post-published-count").textContent=todayPosts.filter(post=>post.status==="published").length;
  if($("#client-post-attention-count"))$("#client-post-attention-count").textContent=todayPosts.filter(post=>clientPostState(post).attention).length;

  const root=$("#client-post-list");
  if(!root)return;
  if(!clientPosts.length){
    root.innerHTML='<div class="post-client-empty"><strong>Nenhuma postagem registrada ainda</strong><span>Quando o agente preparar a agenda, ela aparecerá aqui.</span></div>';
    return;
  }
  root.innerHTML=clientPosts.map(post=>{
    const state=clientPostState(post);
    const sentAt=post.publishedAt||post.attemptedAt;
    const detail=post.error?escapeSupport(post.error):(post.revisionRequest?"Correção: "+escapeSupport(post.revisionRequest):"");
    const canAct=post.status!=="published";
    return `<article class="client-post-card ${state.cls}" data-client-post="${escapeSupport(post.id)}">
      <div class="client-post-time"><span>HORÁRIO</span><strong>${escapeSupport(post.scheduledHour||"—")}</strong><small>${formatClientPostDate(post.scheduledFor)}</small></div>
      <div class="client-post-main">
        <div class="client-post-title"><strong>Postagem do agente</strong><span class="client-post-status ${state.cls}">${state.label}</span></div>
        <div class="client-post-meta"><span>Previsão: <b>${escapeSupport(post.scheduledHour||"—")}</b></span><span>${sentAt?"Última ação: "+formatClientPostDate(sentAt):"Aguardando execução"}</span></div>
        ${detail?`<p class="client-post-detail">${detail}</p>`:""}
        ${post.title?`<div class="client-post-draft"><span>PAUTA</span><strong>${escapeSupport(post.title)}</strong>${post.caption?`<p>${escapeSupport(post.caption)}</p>`:""}${post.imageUrl?`<img src="${escapeSupport(post.imageUrl)}" alt="Prévia da pauta">`:""}</div>`:""}
        <div class="client-post-response" data-post-response></div>
        ${canAct?`<div class="client-post-actions">
          ${post.approvalStatus==="pending"||post.approvalStatus==="correction_requested"?`<button type="button" class="post-approve" data-post-decision="${escapeSupport(post.id)}" data-decision="approved">Aprovar pauta</button><button type="button" class="post-reject" data-post-decision="${escapeSupport(post.id)}" data-decision="rejected">Reprovar</button>`:""}
          <button type="button" class="post-send-now" data-post-manual="${escapeSupport(post.id)}">Enviar agora</button>
          <button type="button" class="post-correct" data-post-edit="${escapeSupport(post.id)}">Corrigir / usar meu conteúdo</button>
        </div>
        <div class="client-post-editor" data-post-editor hidden>
          <div class="post-editor-block">
            <label><span>O que deve ser corrigido?</span><textarea data-post-revision rows="3" maxlength="1600" placeholder="Ex.: troque a imagem, deixe o título mais forte, remova esta frase..."></textarea></label>
            <button type="button" data-post-revision-send="${escapeSupport(post.id)}">Enviar para correção</button>
          </div>
          <div class="post-editor-separator"><span>OU</span></div>
          <div class="post-editor-block">
            <strong>Usar meu próprio conteúdo</strong>
            <label class="post-own-file">Selecionar imagem<input type="file" accept="image/png,image/jpeg,image/webp" data-post-own-image hidden></label>
            <label><span>Legenda</span><textarea data-post-own-caption rows="4" maxlength="2200" placeholder="Escreva a legenda que deve acompanhar a postagem."></textarea></label>
            <button type="button" data-post-own-save="${escapeSupport(post.id)}">Aprovar meu conteúdo</button>
          </div>
        </div>`:""}
      </div>
    </article>`;
  }).join("");
}
async function loadClientPosts(){
  try{
    const r=await fetch("/api/portal/posts",{credentials:"same-origin"});
    if(!r.ok)throw new Error("Não foi possível carregar as postagens.");
    renderClientPosts(await r.json());
  }catch(error){
    const root=$("#client-post-list");
    if(root)root.innerHTML='<div class="post-client-empty"><strong>Falha ao sincronizar</strong><span>'+escapeSupport(error.message)+'</span></div>';
  }
}
function postCardForButton(button){return button.closest("[data-client-post]");}
function setPostResponse(card,message,type=""){
  const el=card?.querySelector("[data-post-response]");
  if(!el)return;
  el.textContent=message||"";
  el.className="client-post-response "+type;
}
async function decidePost(postId,decision,button){
  const card=postCardForButton(button);
  const original=button.textContent;
  button.disabled=true;
  button.textContent=decision==="approved"?"Aprovando…":"Reprovando…";
  setPostResponse(card,"");
  try{
    const r=await fetch("/api/portal/posts/"+encodeURIComponent(postId)+"/decision",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify({decision})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.message||d.error||"Não foi possível registrar a decisão.");
    setPostResponse(card,d.message||"Decisão salva.","ok");
    await loadClientPosts();
  }catch(error){
    setPostResponse(card,error.message,"error");
    button.disabled=false;
    button.textContent=original;
  }
}

async function sendPostNow(postId,button){
  const card=postCardForButton(button);
  button.disabled=true;button.textContent="Consultando servidor…";setPostResponse(card,"");
  try{
    const r=await fetch("/api/portal/posts/"+encodeURIComponent(postId)+"/manual",{method:"POST",credentials:"same-origin"});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){
      setPostResponse(card,d.message||"O servidor não liberou esta postagem.","error");
      const editor=card?.querySelector("[data-post-editor]");
      if(editor)editor.hidden=false;
      return;
    }
    setPostResponse(card,d.message||"Postagem enviada.","ok");
    await loadClientPosts();
  }catch{setPostResponse(card,"Não foi possível falar com o servidor agora.","error");}
  finally{button.disabled=false;button.textContent="Enviar agora";}
}
async function sendRevision(postId,button){
  const card=postCardForButton(button),text=card?.querySelector("[data-post-revision]")?.value?.trim()||"";
  if(!text){setPostResponse(card,"Explique o que precisa ser corrigido.","error");return;}
  button.disabled=true;button.textContent="Enviando…";
  try{
    const r=await fetch("/api/portal/posts/"+encodeURIComponent(postId)+"/revision",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify({instructions:text})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.message||"Não foi possível pedir a correção.");
    setPostResponse(card,d.message||"Correção solicitada.","ok");
    await loadClientPosts();
  }catch(error){setPostResponse(card,error.message,"error");}
  finally{button.disabled=false;button.textContent="Enviar para correção";}
}
function fileAsDataUrl(file){
  return new Promise((resolve,reject)=>{
    if(!file||!file.type.startsWith("image/"))return reject(new Error("Selecione uma imagem."));
    if(file.size>10*1024*1024)return reject(new Error("A imagem deve ter no máximo 10 MB."));
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||""));
    reader.onerror=()=>reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
}
async function saveOwnPost(postId,button){
  const card=postCardForButton(button);
  const file=card?.querySelector("[data-post-own-image]")?.files?.[0];
  const caption=card?.querySelector("[data-post-own-caption]")?.value?.trim()||"";
  if(!file||!caption){setPostResponse(card,"Selecione uma imagem e escreva a legenda.","error");return;}
  button.disabled=true;button.textContent="Preparando…";
  try{
    const imageDataUrl=await fileAsDataUrl(file);
    const r=await fetch("/api/portal/posts/"+encodeURIComponent(postId)+"/content",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify({imageDataUrl,caption})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.message||d.error||"Não foi possível salvar seu conteúdo.");
    setPostResponse(card,d.message||"Conteúdo pronto para envio.","ok");
    await loadClientPosts();
  }catch(error){setPostResponse(card,error.message,"error");}
  finally{button.disabled=false;button.textContent="Aprovar meu conteúdo";}
}

let latestVideoJobs=[];
let latestVideoFolders=[{id:"default",name:"Meus vídeos"}];
let videoFolderFilter="";
const bulkVideoSelection=new Set();
const bulkVideoTimes=new Map();

function videoClipKey(jobId,clipId){return String(jobId)+"|"+String(clipId);}
function findLatestClip(key){
  const [jobId,clipId]=String(key).split("|");
  const job=latestVideoJobs.find(item=>item.id===jobId);
  const clip=job?.clips?.find(item=>item.id===clipId);
  return job&&clip?{job,clip}:null;
}
function ensureBulkVideoScheduler(){
  const view=$("#view-videos");
  if(!view||$("#video-bulk-scheduler"))return;
  const grid=view.querySelector(".video-client-grid");
  if(!grid)return;
  const panel=document.createElement("section");
  panel.id="video-bulk-scheduler";
  panel.className="panel settings-panel wide-panel";
  panel.innerHTML=`
    <div class="panel-heading">
      <div>
        <p class="eyebrow">AGENDAMENTO EM LOTE</p>
        <h2>Agendar vários vídeos</h2>
        <p class="muted">Selecione quantos cortes quiser. O horário escolhido vai direto para o servidor; não depende de aprovação do Master.</p>
      </div>
      <span id="video-bulk-count" class="post-client-help">0 selecionados</span>
    </div>
    <div class="video-bulk-tools">
      <button type="button" class="ghost-action" id="video-bulk-select-ready">Selecionar todos prontos</button>
      <button type="button" class="ghost-action" id="video-bulk-clear">Limpar seleção</button>
      <label>Primeira postagem<input id="video-bulk-start" type="datetime-local"></label>
      <label>Intervalo
        <select id="video-bulk-interval">
          <option value="30">30 minutos</option>
          <option value="60" selected>1 hora</option>
          <option value="120">2 horas</option>
          <option value="180">3 horas</option>
          <option value="360">6 horas</option>
          <option value="1440">1 dia</option>
        </select>
      </label>
      <button type="button" class="ghost-action" id="video-bulk-distribute">Distribuir horários</button>
    </div>
    <div id="video-bulk-list" class="video-bulk-list">
      <div class="post-client-empty"><strong>Nenhum vídeo selecionado</strong><span>Marque os vídeos prontos abaixo para montar a agenda.</span></div>
    </div>
    <div class="video-bulk-confirm">
      <span id="video-bulk-status" class="save-status"></span>
      <button type="button" class="connection-submit" id="video-bulk-confirm" disabled>Confirmar agendamento</button>
    </div>`;
  grid.parentNode.insertBefore(panel,grid);

  if(!$("#video-bulk-style")){
    const style=document.createElement("style");style.id="video-bulk-style";style.textContent=`
      .video-bulk-tools{display:grid;grid-template-columns:auto auto 1fr 170px auto;gap:9px;align-items:end;margin:12px 0}
      .video-bulk-tools label{display:grid;gap:5px;color:#7893a0;font-size:9px}.video-bulk-tools input,.video-bulk-tools select,.video-bulk-row input{width:100%;border:1px solid rgba(93,211,255,.12);border-radius:9px;background:#02080b;color:#edfaff;padding:9px}
      .video-bulk-list{display:grid;gap:8px}.video-bulk-row{display:grid;grid-template-columns:minmax(160px,1fr) 210px;gap:12px;align-items:center;padding:10px 12px;border:1px solid rgba(93,211,255,.1);border-radius:10px;background:#041015}.video-bulk-row strong{display:block;font-size:11px}.video-bulk-row small{display:block;margin-top:3px;color:#7893a0;font-size:9px}.video-bulk-confirm{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:13px}.video-bulk-check{display:flex!important;align-items:center;gap:7px!important;margin:0 0 8px;color:#9edfff!important;font-size:9px!important}.video-bulk-check input{accent-color:#5dd3ff}.video-bulk-selected{box-shadow:0 0 0 1px rgba(93,211,255,.32) inset}
      @media(max-width:900px){.video-bulk-tools{grid-template-columns:1fr 1fr}.video-bulk-tools label{grid-column:span 1}.video-bulk-row{grid-template-columns:1fr}.video-bulk-confirm{align-items:stretch;flex-direction:column}}
    `;document.head.appendChild(style);
  }

  $("#video-bulk-select-ready")?.addEventListener("click",()=>{
    for(const job of latestVideoJobs){
      for(const clip of job.clips||[]){
        if(clip.status==="ready"&&clip.publishStatus!=="published")bulkVideoSelection.add(videoClipKey(job.id,clip.id));
      }
    }
    renderVideoJobs({jobs:latestVideoJobs});
  });
  $("#video-bulk-clear")?.addEventListener("click",()=>{
    bulkVideoSelection.clear();bulkVideoTimes.clear();renderVideoJobs({jobs:latestVideoJobs});
  });
  $("#video-bulk-distribute")?.addEventListener("click",()=>distributeBulkVideoTimes());
  $("#video-bulk-confirm")?.addEventListener("click",confirmBulkVideoSchedule);

  const start=$("#video-bulk-start");
  if(start&&!start.value){
    const d=new Date(Date.now()+60*60*1000);d.setSeconds(0,0);start.value=localInputValue(d.toISOString());
  }
}
function renderBulkVideoScheduler(){
  ensureBulkVideoScheduler();
  const list=$("#video-bulk-list"),count=$("#video-bulk-count"),confirm=$("#video-bulk-confirm");
  if(!list)return;
  for(const key of [...bulkVideoSelection]){
    const found=findLatestClip(key);
    if(!found||found.clip.publishStatus==="published")bulkVideoSelection.delete(key);
  }
  const keys=[...bulkVideoSelection];
  if(count)count.textContent=keys.length+" selecionado"+(keys.length===1?"":"s");
  if(confirm)confirm.disabled=!keys.length;
  if(!keys.length){
    list.innerHTML='<div class="post-client-empty"><strong>Nenhum vídeo selecionado</strong><span>Marque os vídeos prontos abaixo para montar a agenda.</span></div>';
    return;
  }
  list.innerHTML=keys.map((key,index)=>{
    const found=findLatestClip(key);if(!found)return"";
    const when=bulkVideoTimes.get(key)||found.clip.scheduledFor||"";
    return `<div class="video-bulk-row" data-bulk-key="${escapeSupport(key)}"><div><strong>${escapeSupport(found.clip.title||("Vídeo "+(index+1)))}</strong><small>${escapeSupport(found.job.filename||"")} · ${Math.round(Number(found.clip.duration||0))}s</small></div><input type="datetime-local" data-bulk-time value="${escapeSupport(localInputValue(when))}"></div>`;
  }).join("");
  $$("[data-bulk-time]").forEach(input=>input.addEventListener("change",()=>{
    const row=input.closest("[data-bulk-key]");if(!row)return;
    const date=new Date(input.value);bulkVideoTimes.set(row.dataset.bulkKey,Number.isFinite(date.getTime())?date.toISOString():"");
  }));
}
function distributeBulkVideoTimes(){
  const startInput=$("#video-bulk-start"),intervalInput=$("#video-bulk-interval"),status=$("#video-bulk-status");
  const base=new Date(startInput?.value||"");
  if(!Number.isFinite(base.getTime())){if(status)status.textContent="Escolha a data e hora da primeira postagem.";return;}
  const interval=Math.max(1,Number(intervalInput?.value||60));
  [...bulkVideoSelection].forEach((key,index)=>bulkVideoTimes.set(key,new Date(base.getTime()+index*interval*60000).toISOString()));
  renderBulkVideoScheduler();
  if(status)status.textContent="Horários distribuídos. Você pode alterar cada um antes de confirmar.";
}
async function confirmBulkVideoSchedule(){
  const button=$("#video-bulk-confirm"),status=$("#video-bulk-status");
  const items=[];
  for(const key of bulkVideoSelection){
    const found=findLatestClip(key);if(!found)continue;
    const row=$('[data-bulk-key="'+CSS.escape(key)+'"]');
    const local=row?.querySelector("[data-bulk-time]")?.value||"";
    const date=new Date(local);
    if(!Number.isFinite(date.getTime())){
      if(status){status.textContent="Preencha a data e hora de todos os vídeos.";status.className="save-status error";}
      return;
    }
    items.push({jobId:found.job.id,clipId:found.clip.id,scheduledFor:date.toISOString(),caption:found.clip.caption||found.clip.title||""});
  }
  if(!items.length)return;
  button.disabled=true;button.textContent="Agendando…";
  if(status){status.textContent="Enviando agenda ao servidor…";status.className="save-status";}
  try{
    const r=await fetch("/api/portal/videos/bulk-schedule",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify({items})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||"Falha ao agendar os vídeos.");
    bulkVideoSelection.clear();bulkVideoTimes.clear();
    if(status){status.textContent=(d.scheduled||0)+" vídeo(s) agendado(s) direto no servidor"+(d.failed?"; "+d.failed+" com erro.":".");status.className=d.failed?"save-status error":"save-status ok";}
    await loadVideoJobs();
  }catch(error){
    if(status){status.textContent=error.message;status.className="save-status error";}
  }finally{button.disabled=false;button.textContent="Confirmar agendamento";}
}

function videoFolderName(id){
  return latestVideoFolders.find(folder=>folder.id===id)?.name||"Meus vídeos";
}
function syncVideoFolderControls(){
  const filter=$("#video-folder-filter"),upload=$("#video-upload-folder");
  const options=latestVideoFolders.map(folder=>`<option value="${escapeSupport(folder.id)}">${escapeSupport(folder.name)}</option>`).join("");
  if(filter){
    const previous=videoFolderFilter||filter.value||"";
    filter.innerHTML='<option value="">Todas as pastas</option>'+options;
    filter.value=latestVideoFolders.some(folder=>folder.id===previous)?previous:"";
    videoFolderFilter=filter.value;
  }
  if(upload){
    const previous=upload.value||"default";
    upload.innerHTML=options;
    upload.value=latestVideoFolders.some(folder=>folder.id===previous)?previous:"default";
  }
  const rename=$("#video-rename-folder"),remove=$("#video-delete-folder");
  const locked=!videoFolderFilter||videoFolderFilter==="default";
  if(rename)rename.disabled=locked;
  if(remove)remove.disabled=locked;
}
async function createVideoFolder(){
  const input=$("#video-new-folder-name"),status=$("#video-upload-status");
  const name=input?.value?.trim()||"";
  if(!name){if(status)status.textContent="Digite o nome da nova pasta.";return;}
  try{
    const r=await fetch("/api/portal/video-folders",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify({name})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível criar a pasta.");
    latestVideoFolders=d.folders||latestVideoFolders;if(input)input.value="";syncVideoFolderControls();
    if(status){status.textContent="Pasta criada.";status.className="save-status ok";}
  }catch(error){if(status){status.textContent=error.message;status.className="save-status error";}}
}
async function renameCurrentVideoFolder(){
  if(!videoFolderFilter||videoFolderFilter==="default")return;
  const current=videoFolderName(videoFolderFilter);
  const name=prompt("Novo nome da pasta:",current)?.trim();
  if(!name)return;
  const status=$("#video-upload-status");
  try{
    const r=await fetch("/api/portal/video-folders/"+encodeURIComponent(videoFolderFilter),{method:"PATCH",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify({name})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível renomear a pasta.");
    latestVideoFolders=d.folders||latestVideoFolders;syncVideoFolderControls();renderVideoJobs({jobs:latestVideoJobs,folders:latestVideoFolders});
    if(status){status.textContent="Pasta renomeada.";status.className="save-status ok";}
  }catch(error){if(status){status.textContent=error.message;status.className="save-status error";}}
}
async function deleteCurrentVideoFolder(){
  if(!videoFolderFilter||videoFolderFilter==="default")return;
  if(!confirm("Excluir esta pasta? Os vídeos serão movidos para Meus vídeos."))return;
  const status=$("#video-upload-status"),folderId=videoFolderFilter;
  try{
    const r=await fetch("/api/portal/video-folders/"+encodeURIComponent(folderId),{method:"DELETE",credentials:"same-origin"});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível excluir a pasta.");
    videoFolderFilter="";latestVideoFolders=d.folders||latestVideoFolders;await loadVideoJobs();
    if(status){status.textContent="Pasta excluída. Os vídeos foram movidos para Meus vídeos.";status.className="save-status ok";}
  }catch(error){if(status){status.textContent=error.message;status.className="save-status error";}}
}
async function updateVideoMeta(jobId,payload){
  const r=await fetch("/api/portal/videos/"+encodeURIComponent(jobId),{method:"PATCH",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify(payload)});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível atualizar o vídeo.");
  return d;
}
async function renameVideoJob(jobId){
  const job=latestVideoJobs.find(item=>item.id===jobId);if(!job)return;
  const name=prompt("Novo nome do vídeo:",job.displayName||job.filename)?.trim();if(!name)return;
  try{await updateVideoMeta(jobId,{displayName:name});await loadVideoJobs();}catch(error){alert(error.message);}
}
async function deleteVideoJob(jobId){
  const job=latestVideoJobs.find(item=>item.id===jobId);if(!job)return;
  if(!confirm('Excluir "'+(job.displayName||job.filename)+'" da biblioteca? Isso apaga o arquivo e os cortes do NEXUS, mas não remove algo que já foi publicado no Instagram.'))return;
  try{
    const r=await fetch("/api/portal/videos/"+encodeURIComponent(jobId),{method:"DELETE",credentials:"same-origin"});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||d.error||"Não foi possível excluir o vídeo.");
    for(const key of [...bulkVideoSelection])if(key.startsWith(jobId+"|"))bulkVideoSelection.delete(key);
    await loadVideoJobs();
  }catch(error){alert(error.message);}
}
async function moveVideoJob(jobId,folderId){
  try{await updateVideoMeta(jobId,{folderId});await loadVideoJobs();}catch(error){alert(error.message);}
}

function videoJobStatus(job){
  const labels={queued:"RECEBIDO",uploaded:"RECEBIDO",transcribing:"TRANSCREVENDO",selecting:"ESCOLHENDO CORTES",cutting:"CRIANDO CORTES",ready:"PRONTO PARA REVISÃO",failed:"FALHOU"};
  return labels[job.status]||String(job.status||"RECEBIDO").toUpperCase();
}
function videoApprovalLabel(status){
  return status==="approved"?"APROVADO":status==="rejected"?"REPROVADO":"AGUARDANDO APROVAÇÃO";
}
function videoPublishLabel(clip){
  if(clip.publishStatus==="published")return"PUBLICADO";
  if(clip.publishStatus==="publishing")return"PUBLICANDO";
  if(clip.publishStatus==="scheduled")return"AGENDADO";
  if(clip.publishStatus==="failed")return"FALHA NO ENVIO";
  return"FORA DA AGENDA";
}
function localInputValue(iso){
  if(!iso)return"";
  const d=new Date(iso);if(!Number.isFinite(d.getTime()))return"";
  const pad=n=>String(n).padStart(2,"0");
  return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+"T"+pad(d.getHours())+":"+pad(d.getMinutes());
}
function renderVideoJobs(data={}){
  ensureBulkVideoScheduler();
  const root=$("#client-video-jobs");if(!root)return;
  const jobs=Array.isArray(data.jobs)?data.jobs:[];
  latestVideoJobs=jobs;
  for(const job of jobs){
    for(const clip of job.clips||[]){
      const key=videoClipKey(job.id,clip.id);
      if(clip.selectedForSchedule)bulkVideoSelection.add(key);
      if(clip.publishStatus==="scheduled"||clip.publishStatus==="published")bulkVideoSelection.delete(key);
    }
  }
  if(Array.isArray(data.folders)&&data.folders.length)latestVideoFolders=data.folders;
  syncVideoFolderControls();
  const visibleJobs=videoFolderFilter?jobs.filter(job=>(job.folderId||"default")===videoFolderFilter):jobs;
  if(!visibleJobs.length){root.innerHTML='<div class="post-client-empty"><strong>Nenhum vídeo nesta pasta</strong><span>Envie vídeos ou escolha outra pasta.</span></div>';renderBulkVideoScheduler();return;}
  root.innerHTML=visibleJobs.map(job=>{
    const clips=Array.isArray(job.clips)?job.clips:[];
    const folderOptions=latestVideoFolders.map(folder=>`<option value="${escapeSupport(folder.id)}" ${(job.folderId||"default")===folder.id?"selected":""}>${escapeSupport(folder.name)}</option>`).join("");
    const header=`<article class="video-job-card video-job-expanded" data-video-job="${escapeSupport(job.id)}">
      <div class="video-job-head">
        <div><strong>${escapeSupport(job.displayName||job.filename||"Vídeo")}</strong><span>${videoJobStatus(job)} · ${Math.round(Number(job.progress||0))}% · ${escapeSupport(job.outputFormatLabel||"Reels / Stories 9:16")}${job.detectedLanguage?` · idioma: ${escapeSupport(job.detectedLanguage)}`:""}${job.autoSubtitles?` · legenda PT-BR automática`:""}</span></div>
        <small>${escapeSupport(job.message||"Processando…")}</small>
      </div>
      <div class="video-library-row">
        <span class="video-folder-badge">${escapeSupport(videoFolderName(job.folderId||"default"))}</span>
        <select data-video-folder-move="${escapeSupport(job.id)}">${folderOptions}</select>
        <button type="button" class="ghost-action" data-video-rename-job="${escapeSupport(job.id)}">Renomear</button>
        <button type="button" class="video-delete-button" data-video-delete-job="${escapeSupport(job.id)}">Excluir vídeo</button>
      </div>
      <div class="video-job-progress"><i style="width:${Math.max(2,Math.min(100,Number(job.progress||0)))}%"></i></div>`;
    if(!clips.length){
      return header+`<div class="video-wait-card"><strong>${job.status==="failed"?"Não foi possível preparar os cortes.":"O NEXUS está trabalhando neste vídeo."}</strong><span>O vídeo não entra na agenda automática. Quando os cortes ficarem prontos, você decide aprovar, rejeitar ou agendar.</span></div></article>`;
    }
    return header+`<div class="video-clip-grid">${clips.map(clip=>`
      <article class="video-clip-card ${bulkVideoSelection.has(videoClipKey(job.id,clip.id))?"video-bulk-selected":""}" data-video-clip="${escapeSupport(clip.id)}" data-video-job-id="${escapeSupport(job.id)}">
        <video controls playsinline preload="metadata" src="${escapeSupport(clip.previewUrl)}"></video>
        <div class="video-clip-body">
          ${clip.status==="ready"&&clip.publishStatus!=="published"?`<label class="video-bulk-check"><input type="checkbox" data-video-bulk-select="${escapeSupport(job.id)}|${escapeSupport(clip.id)}" ${bulkVideoSelection.has(videoClipKey(job.id,clip.id))?"checked":""}> Selecionar para a agenda do mês</label>`:""}
          <div class="video-clip-top"><strong>Opção ${Number(clip.rank||1)} · ${escapeSupport(clip.title||"Melhor corte")}</strong><span class="video-approval ${escapeSupport(clip.approvalStatus||"pending")}">${videoApprovalLabel(clip.approvalStatus)}</span></div>
          <div class="video-smart-meta">${clip.qualityScore?`<span>IA ${Number(clip.qualityScore)}/100</span>`:""}${clip.subtitlesApplied?`<span>LEGENDAS PT-BR</span>`:""}${clip.hook?`<b>${escapeSupport(clip.hook)}</b>`:""}</div>
          <small>${escapeSupport(clip.reason||"Trecho selecionado por potencial de postagem")}</small>
          ${clip.transcript?`<p class="video-transcript">${escapeSupport(clip.transcript)}</p>`:""}
          <div class="video-clip-state"><span>${videoPublishLabel(clip)}</span>${clip.scheduledFor?`<b>${formatClientPostDate(clip.scheduledFor)}</b>`:""}</div>
          ${clip.error?`<p class="video-error">${escapeSupport(clip.error)}</p>`:""}
          <div class="video-review-actions">
            <button type="button" data-video-approve="${escapeSupport(job.id)}|${escapeSupport(clip.id)}">Aprovar</button>
            <button type="button" class="danger" data-video-reject="${escapeSupport(job.id)}|${escapeSupport(clip.id)}">Reprovar</button>
            <button type="button" class="ghost-action" data-video-toggle-edit>Editar corte</button>
          </div>
          <div class="video-edit-panel" hidden>
            <div class="video-cut-range">
              <label>Início (s)<input type="number" step="0.1" min="0" data-video-start value="${Number(clip.start||0).toFixed(1)}"></label>
              <label>Fim (s)<input type="number" step="0.1" min="0" data-video-end value="${Number(clip.end||0).toFixed(1)}"></label>
            </div>
            <label>Título<input data-video-title maxlength="100" value="${escapeSupport(clip.title||"")}"></label>
            <label>Legenda<textarea data-video-caption rows="3" maxlength="2200">${escapeSupport(clip.caption||clip.title||"")}</textarea></label>
            <label>Frase final<input data-video-end-text maxlength="90" value="${escapeSupport(clip.endText||job.endText||"")}"></label>
            <label>Contato / CTA final<input data-video-end-contact maxlength="90" value="${escapeSupport(clip.endContact||job.endContact||"")}"></label>
            <button type="button" data-video-adjust="${escapeSupport(job.id)}|${escapeSupport(clip.id)}">Salvar novo corte</button>
          </div>
          ${clip.approvalStatus==="approved"?`<div class="video-schedule-panel">
            <label>Agendar este vídeo<input type="datetime-local" data-video-schedule-time value="${localInputValue(clip.scheduledFor)}"></label>
            <label>Legenda<input data-video-schedule-caption maxlength="2200" value="${escapeSupport(clip.caption||clip.title||"")}"></label>
            <div><button type="button" data-video-schedule="${escapeSupport(job.id)}|${escapeSupport(clip.id)}">Agendar fora da agenda</button><button type="button" class="post-send-now" data-video-publish="${escapeSupport(job.id)}|${escapeSupport(clip.id)}">Publicar agora</button></div>
          </div>`:""}
          <div class="client-post-response" data-video-response></div>
        </div>
      </article>`).join("")}</div></article>`;
  }).join("");
  renderBulkVideoScheduler();
}
async function loadVideoJobs(){
  try{
    const r=await fetch("/api/portal/videos",{credentials:"same-origin"});
    if(!r.ok)throw new Error();
    renderVideoJobs(await r.json());
  }catch{
    const root=$("#client-video-jobs");if(root)root.innerHTML='<p class="muted">Não foi possível carregar seus vídeos agora.</p>';
  }
}
function videoActionParts(button){
  const raw=String(button.dataset.videoApprove||button.dataset.videoReject||button.dataset.videoAdjust||button.dataset.videoSchedule||button.dataset.videoPublish||"");
  const [jobId,clipId]=raw.split("|");
  return{jobId,clipId,card:button.closest("[data-video-clip]")};
}
function setVideoResponse(card,message,type=""){
  const el=card?.querySelector("[data-video-response]");if(!el)return;
  el.textContent=message||"";el.className="client-post-response "+type;
}
async function setVideoApproval(button,status){
  const {jobId,clipId,card}=videoActionParts(button);button.disabled=true;
  try{
    const r=await fetch(`/api/portal/videos/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}/approval`,{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify({status})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Falha ao atualizar aprovação.");
    setVideoResponse(card,status==="approved"?"Corte aprovado. Agora você pode agendar ou publicar.":"Corte reprovado. Ele não será publicado.","ok");
    await loadVideoJobs();
  }catch(error){setVideoResponse(card,error.message,"error");}finally{button.disabled=false;}
}
async function adjustVideo(button){
  const {jobId,clipId,card}=videoActionParts(button);
  const start=Number(card.querySelector("[data-video-start]").value),end=Number(card.querySelector("[data-video-end]").value);
  const title=card.querySelector("[data-video-title]").value,caption=card.querySelector("[data-video-caption]").value;
  const endText=card.querySelector("[data-video-end-text]")?.value||"",endContact=card.querySelector("[data-video-end-contact]")?.value||"";
  button.disabled=true;button.textContent="Recortando…";
  try{
    const r=await fetch(`/api/portal/videos/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}/adjust`,{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify({start,end,title,caption,endText,endContact})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Falha ao ajustar o corte.");
    setVideoResponse(card,"Novo corte criado. Revise e aprove novamente.","ok");await loadVideoJobs();
  }catch(error){setVideoResponse(card,error.message,"error");}finally{button.disabled=false;button.textContent="Salvar novo corte";}
}
async function scheduleVideo(button){
  const {jobId,clipId,card}=videoActionParts(button);
  const local=card.querySelector("[data-video-schedule-time]")?.value||"";
  const caption=card.querySelector("[data-video-schedule-caption]")?.value||"";
  if(!local){setVideoResponse(card,"Escolha a data e o horário.","error");return;}
  const date=new Date(local);if(!Number.isFinite(date.getTime())){setVideoResponse(card,"Data ou horário inválido.","error");return;}
  button.disabled=true;
  try{
    const r=await fetch(`/api/portal/videos/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}/schedule`,{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify({scheduledFor:date.toISOString(),caption})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Falha ao agendar.");
    setVideoResponse(card,"Vídeo agendado separadamente das postagens automáticas.","ok");await loadVideoJobs();
  }catch(error){setVideoResponse(card,error.message,"error");}finally{button.disabled=false;}
}
async function publishVideoNow(button){
  const {jobId,clipId,card}=videoActionParts(button);
  const caption=card.querySelector("[data-video-schedule-caption]")?.value||"";
  button.disabled=true;button.textContent="Publicando…";setVideoResponse(card,"Enviando o Reel ao Instagram…");
  try{
    const r=await fetch(`/api/portal/videos/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}/publish`,{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify({caption})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Falha ao publicar.");
    setVideoResponse(card,"Vídeo publicado com sucesso.","ok");await loadVideoJobs();
  }catch(error){setVideoResponse(card,error.message,"error");}finally{button.disabled=false;button.textContent="Publicar agora";}
}

document.addEventListener("change",async event=>{
  const folderMove=event.target.closest?.("[data-video-folder-move]");
  if(folderMove){moveVideoJob(folderMove.dataset.videoFolderMove,folderMove.value);return;}
  const input=event.target.closest?.("[data-video-bulk-select]");
  if(!input)return;
  const key=String(input.dataset.videoBulkSelect||"");
  const [jobId,clipId]=key.split("|");
  const selected=input.checked;
  input.disabled=true;
  try{
    const r=await fetch(`/api/portal/videos/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}/select`,{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify({selected})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível salvar a seleção.");
    if(selected)bulkVideoSelection.add(key);else{bulkVideoSelection.delete(key);bulkVideoTimes.delete(key);}
    const card=input.closest("[data-video-clip]");if(card)card.classList.toggle("video-bulk-selected",selected);
    renderBulkVideoScheduler();
  }catch(error){
    input.checked=!selected;
    const card=input.closest("[data-video-clip]");setVideoResponse(card,error.message,"error");
  }finally{input.disabled=false;}
});
document.addEventListener("click",event=>{
  const hunterDiscard=event.target.closest("[data-lead-hunter-discard]");if(hunterDiscard){discardLeadHunterLead(hunterDiscard.dataset.leadHunterDiscard,hunterDiscard);return;}
  const renameJob=event.target.closest("[data-video-rename-job]");if(renameJob){renameVideoJob(renameJob.dataset.videoRenameJob);return;}
  const deleteJob=event.target.closest("[data-video-delete-job]");if(deleteJob){deleteVideoJob(deleteJob.dataset.videoDeleteJob);return;}
  const decision=event.target.closest("[data-post-decision]");
  if(decision){decidePost(decision.dataset.postDecision,decision.dataset.decision,decision);return;}
  const manual=event.target.closest("[data-post-manual]");
  if(manual){sendPostNow(manual.dataset.postManual,manual);return;}
  const edit=event.target.closest("[data-post-edit]");
  if(edit){
    const editor=postCardForButton(edit)?.querySelector("[data-post-editor]");
    if(editor)editor.hidden=!editor.hidden;
    return;
  }
  const revision=event.target.closest("[data-post-revision-send]");
  if(revision){sendRevision(revision.dataset.postRevisionSend,revision);return;}
  const own=event.target.closest("[data-post-own-save]");
  if(own){saveOwnPost(own.dataset.postOwnSave,own);return;}
  const approve=event.target.closest("[data-video-approve]");if(approve){setVideoApproval(approve,"approved");return;}
  const reject=event.target.closest("[data-video-reject]");if(reject){setVideoApproval(reject,"rejected");return;}
  const toggleEdit=event.target.closest("[data-video-toggle-edit]");if(toggleEdit){const panel=toggleEdit.closest("[data-video-clip]")?.querySelector(".video-edit-panel");if(panel)panel.hidden=!panel.hidden;return;}
  const adjust=event.target.closest("[data-video-adjust]");if(adjust){adjustVideo(adjust);return;}
  const schedule=event.target.closest("[data-video-schedule]");if(schedule){scheduleVideo(schedule);return;}
  const publish=event.target.closest("[data-video-publish]");if(publish){publishVideoNow(publish);return;}
});
$$("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
const refreshClientPosts=$("#refresh-client-posts");if(refreshClientPosts)refreshClientPosts.addEventListener("click",loadClientPosts);
const refreshClientLeads=$("#refresh-client-leads");if(refreshClientLeads)refreshClientLeads.addEventListener("click",loadClientLeads);
const leadHunterForm=$("#lead-hunter-form");if(leadHunterForm)leadHunterForm.addEventListener("submit",saveLeadHunterConfig);
const leadHunterRun=$("#lead-hunter-run");if(leadHunterRun)leadHunterRun.addEventListener("click",runLeadHunterNow);
const refreshAgentTeam=$("#refresh-agent-team");if(refreshAgentTeam)refreshAgentTeam.addEventListener("click",loadAgentTeam);
const trailerSearchForm=$("#trailer-search-form");
if(trailerSearchForm)trailerSearchForm.addEventListener("submit",searchTrailers);
$$("[data-trailer-kind]").forEach(button=>button.addEventListener("click",()=>{
  const type=button.dataset.trailerKind==="series"?"series":"movie";
  const select=$("#trailer-type");if(select)select.value=type;
  $$("[data-trailer-kind]").forEach(item=>{
    const active=item===button;
    item.classList.toggle("active",active);
    item.setAttribute("aria-pressed",active?"true":"false");
  });
  $("#trailer-query")?.focus();
}));$$("[data-open-setup]").forEach(b=>b.addEventListener("click",()=>showView("setup")));$$("[data-open-posting]").forEach(b=>b.addEventListener("click",()=>showView("posting")));
$$("[data-profile-tab]").forEach(button=>button.addEventListener("click",()=>{
  $$("[data-profile-tab]").forEach(item=>item.classList.toggle("active",item===button));
  $$("[data-profile-panel]").forEach(panel=>panel.classList.toggle("active",panel.dataset.profilePanel===button.dataset.profileTab));
}));
["#profile-primary","#profile-secondary","#profile-agent-name","#profile-brand-name","#profile-niche","#profile-cta"].forEach(selector=>{
  const el=$(selector);if(el)el.addEventListener("input",updateAgentProfilePreview);
});
const profileLogoFile=$("#profile-logo-file");
if(profileLogoFile)profileLogoFile.addEventListener("change",async event=>{
  const file=event.target.files?.[0];if(!file)return;
  const status=$("#profile-save-status");
  try{
    if(status)status.textContent="Preparando logo…";
    pendingProfileLogo=await optimizeLogo(file);
    removeProfileLogo=false;
    showStoredProfileLogo(pendingProfileLogo);
    if(status)status.textContent="Logo pronta para salvar.";
  }catch(error){
    if(status)status.textContent=error.message;
    event.target.value="";
  }
});
const profileLogoRemove=$("#profile-logo-remove");
if(profileLogoRemove)profileLogoRemove.addEventListener("click",()=>{
  pendingProfileLogo=null;removeProfileLogo=true;showStoredProfileLogo("");$("#profile-logo-file").value="";
});
$$("[data-complete]").forEach(b=>b.addEventListener("click",async()=>{b.disabled=true;try{await patchOnboarding({[b.dataset.complete]:true});}finally{b.disabled=false;}}));
$$("[data-connect]").forEach(b=>b.addEventListener("click",()=>{const provider=b.dataset.connect;if(provider==="railway")startRailwayConnection();else openConnectionModal(provider);}));
$("#connection-close").addEventListener("click",closeConnectionModal);
$("#connection-modal").addEventListener("click",event=>{if(event.target===$("#connection-modal"))closeConnectionModal();});
$("#connection-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const error=$("#connection-error"),submit=event.currentTarget.querySelector(".connection-submit");
  error.textContent="";submit.disabled=true;submit.textContent="Validando…";
  try{
    let endpoint,payload;
    if(connectionProvider==="github"){
      endpoint="/api/portal/connect/github";payload={token:$("#github-token").value};
    }else if(connectionProvider==="openai"){
      endpoint="/api/portal/connect/openai";payload={apiKey:$("#openai-key").value,adminKey:$("#openai-admin-key").value};
    }else throw new Error("Conexão inválida.");
    const r=await fetch(endpoint,{method:"POST",headers:{"x-nexus-session":sessionAuth,"content-type":"application/json"},body:JSON.stringify(payload)});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error==="github_auth_failed"?"Token do GitHub não foi aceito.":d.error==="openai_auth_failed"?"A chave da OpenAI não foi aceita.":d.error==="openai_admin_auth_failed"?"A chave administrativa da OpenAI não foi aceita.":"Não foi possível conectar.");
    renderClient(d);closeConnectionModal();await providerUsage();
  }catch(err){error.textContent=err.message;}
  finally{submit.disabled=false;submit.textContent="Validar e conectar";}
});
$("#mode-new").addEventListener("click",()=>patchOnboarding({setupMode:"new"}));$("#mode-ready").addEventListener("click",()=>patchOnboarding({setupMode:"ready"}));
const legacySupportButton=$("#request-support");
if(legacySupportButton)legacySupportButton.addEventListener("click",()=>showView("support"));

const supportForm=$("#support-form");
if(supportForm)supportForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const form=event.currentTarget,status=$("#support-send-status"),button=form.querySelector("button[type=submit]");
  if(status){status.textContent="Enviando…";status.className="save-status";}
  button.disabled=true;
  try{
    const payload={subject:$("#support-subject").value,category:$("#support-category").value,message:$("#support-message").value};
    const r=await fetch("/api/portal/support",{method:"POST",headers:{"x-nexus-session":sessionAuth,"content-type":"application/json"},body:JSON.stringify(payload)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||"Falha ao abrir chamado");
    form.reset();
    if(status){status.textContent="Chamado aberto. O suporte já recebeu a notificação.";status.className="save-status ok";}
    await loadSupportTickets();
  }catch{
    if(status){status.textContent="Não foi possível abrir o chamado.";status.className="save-status error";}
  }finally{button.disabled=false;}
});

async function searchTrailers(event){
  event?.preventDefault?.();
  const query=$("#trailer-query")?.value?.trim()||"";
  const type=$("#trailer-type")?.value||"movie";
  const status=$("#trailer-search-status"),root=$("#trailer-results");
  if(!query){if(status)status.textContent="Digite o nome do filme ou série.";return;}
  if(status){status.textContent="Pesquisando…";status.className="save-status";}
  if(root)root.innerHTML='<div class="post-client-empty"><strong>Pesquisando</strong><span>Localizando a obra e o trailer oficial…</span></div>';
  try{
    const r=await fetch("/api/portal/trailers/search?q="+encodeURIComponent(query)+"&type="+encodeURIComponent(type),{credentials:"same-origin",headers:sessionAuth?{"x-nexus-session":sessionAuth}:{}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.message||d.error||"Falha na pesquisa.");
    const rows=Array.isArray(d.results)?d.results:[];
    if(status){
      status.textContent=d.configured?"Resultados encontrados.":"Busca de catálogo avançada ainda precisa do TMDB_API_TOKEN; abrindo busca oficial no YouTube continua disponível.";
      status.className=d.configured?"save-status ok":"save-status";
    }
    if(!rows.length){
      const fallback=d.youtubeSearchUrl||("https://www.youtube.com/results?search_query="+encodeURIComponent(query+" trailer oficial"));
      root.innerHTML='<div class="post-client-empty"><strong>Nenhum trailer confirmado automaticamente</strong><span>Você ainda pode abrir a busca oficial no YouTube.</span><a class="trailer-open" target="_blank" rel="noopener" href="'+escapeSupport(fallback)+'">Buscar no YouTube</a></div>';
      return;
    }
    root.innerHTML=rows.map(item=>{
      const link=item.trailerUrl||item.youtubeSearchUrl||"#";
      const badge=item.trailerUrl?(item.official?"TRAILER OFICIAL":"TRAILER ENCONTRADO"):"BUSCAR NO YOUTUBE";
      const importAction=item.downloadable&&item.downloadUrl
        ?'<button type="button" class="trailer-import" data-import-video="'+escapeSupport(item.downloadUrl)+'" data-import-title="'+escapeSupport(item.title||"")+'">Baixar no NEXUS</button>'
        :'<button type="button" class="trailer-import unavailable" disabled title="A fonte encontrada não oferece arquivo direto autorizado">Sem download direto</button>';
      return '<article class="trailer-card">'
        +(item.posterUrl?'<img class="trailer-poster" data-trailer-poster="1" data-fallback="'+escapeSupport(item.posterFallbackUrl||"")+'" data-title="'+escapeSupport(item.title||"")+'" loading="lazy" referrerpolicy="no-referrer" src="'+escapeSupport(item.posterUrl)+'" alt="Imagem de '+escapeSupport(item.title)+'">':'<div class="trailer-poster-empty">'+escapeSupport((item.title||"NEXUS").slice(0,18))+'</div>')
        +'<div class="trailer-card-copy"><span>'+escapeSupport(item.type==="series"?"SÉRIE":"FILME")+' · '+escapeSupport(item.year||"—")+'</span>'
        +'<strong>'+escapeSupport(item.title||"")+'</strong>'
        +'<p>'+escapeSupport(item.overview||"Sinopse não disponível.")+'</p>'
        +'<div class="trailer-card-actions"><a class="trailer-open" target="_blank" rel="noopener" href="'+escapeSupport(link)+'">'+badge+'</a><button type="button" class="trailer-use-title" data-use-trailer-title="'+escapeSupport(item.title||"")+'">Usar no Video Cutter</button>'+importAction+'</div></div>'
        +'</article>';
    }).join("");
    root.querySelectorAll("[data-trailer-poster]").forEach(img=>{
      img.addEventListener("error",()=>{
        const fallback=String(img.dataset.fallback||"");
        if(fallback&&img.src!==fallback){
          img.dataset.fallback="";
          img.src=fallback;
          return;
        }
        const empty=document.createElement("div");
        empty.className="trailer-poster-empty";
        empty.textContent=String(img.dataset.title||"NEXUS").slice(0,18);
        img.replaceWith(empty);
      });
    });
    root.querySelectorAll("[data-use-trailer-title]").forEach(button=>button.addEventListener("click",()=>{
      const title=String(button.dataset.useTrailerTitle||"").trim();
      const input=$("#video-content-title");
      if(input)input.value=title;
      showView("videos");
      input?.focus();
      const status=$("#video-upload-status");
      if(status){status.textContent=title?"Título enviado somente como contexto para escolher as cenas. Ele não será escrito no vídeo.":"";status.className="save-status ok";}
    }));
    root.querySelectorAll("[data-import-video]").forEach(button=>button.addEventListener("click",()=>importAuthorizedVideo(button)));

  }catch(error){
    if(status){status.textContent=error.message;status.className="save-status error";}
    if(root)root.innerHTML='<div class="post-client-empty"><strong>Não foi possível pesquisar</strong><span>'+escapeSupport(error.message)+'</span></div>';
  }
}

const videoFileInput=$("#video-file");
if(videoFileInput)videoFileInput.addEventListener("change",()=>{
  const files=[...(videoFileInput.files||[])];
  if($("#video-file-name"))$("#video-file-name").textContent=files.length>1?files.length+" vídeos selecionados":files[0]?.name||"MP4, MOV, WEBM ou MKV";
});
async function importAuthorizedVideo(button){
  const url=String(button?.dataset.importVideo||"").trim();
  const title=String(button?.dataset.importTitle||"").trim();
  if(!url||!button)return;
  const original=button.textContent;
  button.disabled=true;button.textContent="Baixando…";
  const status=$("#trailer-search-status");
  if(status){status.textContent="Baixando o arquivo autorizado e enviando para análise…";status.className="save-status";}
  const payload={
    url,
    contentTitle:title,
    goal:$("#video-goal")?.value||"viral",
    duration:$("#video-clip-duration")?.value||30,
    clips:$("#video-requested-clips")?.value||3,
    outputFormat:$("#video-output-format")?.value||"reel",
    autoSubtitles:Boolean($("#video-auto-subtitles")?.checked),
    subtitleSize:$("#video-subtitle-size")?.value||"auto",
    subtitleColor:$("#video-subtitle-color")?.value||"white",
    subtitleWeight:$("#video-subtitle-weight")?.value||"bold",
    subtitleBg:$("#video-subtitle-bg")?.value||"black",
    folderId:$("#video-upload-folder")?.value||"default",
    endText:$("#video-end-text")?.value?.trim()||"",
    endContact:$("#video-end-contact")?.value?.trim()||""
  };
  try{
    const r=await fetch("/api/portal/videos/import",{
      method:"POST",
      credentials:"same-origin",
      headers:{"content-type":"application/json",...(sessionAuth?{"x-nexus-session":sessionAuth}:{})},
      body:JSON.stringify(payload)
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok){
      const code=String(d.error||"");
      if(code.includes("protected_streaming"))throw new Error("Essa fonte usa streaming protegido e não permite download direto pelo NEXUS.");
      if(code.includes("too_large"))throw new Error("O arquivo ultrapassa o limite de 750 MB.");
      throw new Error("Não foi possível importar esse arquivo direto.");
    }
    if(status){status.textContent="Vídeo baixado no NEXUS. A IA já está escolhendo as melhores cenas.";status.className="save-status ok";}
    showView("videos");
    await loadVideoJobs();
  }catch(error){
    if(status){status.textContent=error.message;status.className="save-status error";}
  }finally{
    button.disabled=false;button.textContent=original;
  }
}

$("#video-folder-filter")?.addEventListener("change",event=>{videoFolderFilter=event.target.value||"";renderVideoJobs({jobs:latestVideoJobs,folders:latestVideoFolders});});
$("#video-create-folder")?.addEventListener("click",createVideoFolder);
$("#video-rename-folder")?.addEventListener("click",renameCurrentVideoFolder);
$("#video-delete-folder")?.addEventListener("click",deleteCurrentVideoFolder);

function uploadSingleVideo(file,index,total,settings,progress){
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open("POST","/api/portal/videos");
    xhr.withCredentials=true;
    xhr.setRequestHeader("Content-Type",file.type||"application/octet-stream");
    xhr.setRequestHeader("X-File-Name",encodeURIComponent(file.name));
    xhr.setRequestHeader("X-Video-Goal",settings.goal);
    xhr.setRequestHeader("X-Clip-Duration",settings.duration);
    xhr.setRequestHeader("X-Requested-Clips",settings.clips);
    xhr.setRequestHeader("X-Output-Format",settings.outputFormat);
    xhr.setRequestHeader("X-Auto-Subtitles",settings.autoSubtitles?"1":"0");
    xhr.setRequestHeader("X-Subtitle-Size",settings.subtitleSize);
    xhr.setRequestHeader("X-Subtitle-Color",settings.subtitleColor);
    xhr.setRequestHeader("X-Subtitle-Weight",settings.subtitleWeight);
    xhr.setRequestHeader("X-Subtitle-Bg",settings.subtitleBg);
    xhr.setRequestHeader("X-Video-Folder",settings.folderId);
    xhr.setRequestHeader("X-Content-Title",encodeURIComponent(settings.contentTitle||""));
    xhr.setRequestHeader("X-Video-End-Text",encodeURIComponent(settings.endText||""));
    xhr.setRequestHeader("X-Video-End-Contact",encodeURIComponent(settings.endContact||""));
    xhr.upload.onprogress=e=>{
      if(!e.lengthComputable||!progress)return;
      const local=e.loaded/e.total;
      const pct=Math.round(((index+local)/total)*100);
      progress.querySelector("i").style.width=Math.max(2,pct)+"%";
      progress.querySelector("span").textContent="Enviando "+(index+1)+" de "+total+" · "+pct+"%";
    };
    xhr.onload=()=>{
      let d={};try{d=JSON.parse(xhr.responseText||"{}");}catch{}
      if(xhr.status>=200&&xhr.status<300){resolve(d);return;}
      if(xhr.status===401){const err=new Error("Sua sessão expirou. Entre novamente no portal e o vídeo continuará selecionado.");err.code="session_expired";reject(err);return;}
      reject(new Error(d.error==="video_too_large"?"Vídeo acima do limite de 750 MB.":(d.error||"Não foi possível enviar "+file.name)));
    };
    xhr.onerror=()=>reject(new Error("Falha de conexão ao enviar "+file.name));
    xhr.send(file);
  });
}
const videoUploadForm=$("#video-upload-form");
if(videoUploadForm)videoUploadForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const files=[...(videoFileInput?.files||[])],status=$("#video-upload-status"),button=videoUploadForm.querySelector("button[type=submit]"),progress=$("#video-upload-progress");
  if(!files.length){if(status)status.textContent="Selecione um ou mais vídeos.";return;}
  const oversized=files.find(file=>file.size>750*1024*1024);
  if(oversized){if(status)status.textContent=oversized.name+" passa do limite de 750 MB.";return;}
  const settings={
    goal:$("#video-goal").value,
    duration:$("#video-clip-duration").value,
    clips:$("#video-requested-clips").value,
    outputFormat:$("#video-output-format")?.value||"reel",
    autoSubtitles:Boolean($("#video-auto-subtitles")?.checked),
    subtitleSize:$("#video-subtitle-size")?.value||"auto",
    subtitleColor:$("#video-subtitle-color")?.value||"white",
    subtitleWeight:$("#video-subtitle-weight")?.value||"bold",
    subtitleBg:$("#video-subtitle-bg")?.value||"black",
    folderId:$("#video-upload-folder")?.value||"default",
    contentTitle:$("#video-content-title")?.value?.trim()||"",
    endText:$("#video-end-text")?.value?.trim()||"",
    endContact:$("#video-end-contact")?.value?.trim()||""
  };
  button.disabled=true;
  if(status){status.textContent="Carregando "+files.length+" vídeo(s)…";status.className="save-status";}
  if(progress){progress.hidden=false;progress.querySelector("i").style.width="2%";progress.querySelector("span").textContent="Preparando envio…";}
  let sent=0,failed=0,lastError="";
  for(let index=0;index<files.length;index++){
    try{await uploadSingleVideo(files[index],index,files.length,settings,progress);sent++;}
    catch(error){failed++;lastError=error.message;}
  }
  button.disabled=false;if(progress)progress.hidden=true;
  if(sent>0){
    videoUploadForm.reset();
    if($("#video-file-name"))$("#video-file-name").textContent="MP4, MOV, WEBM ou MKV";
    syncVideoFolderControls();
  }
  if(status){
    status.textContent=sent+" vídeo(s) carregado(s) para cortes"+(failed?"; "+failed+" falhou: "+lastError:".");
    status.className=failed?"save-status error":"save-status ok";
  }
  if(sent===0&&/sessão expirou/i.test(lastError)){
    setTimeout(()=>location.reload(),1200);
    return;
  }
  await loadVideoJobs();
});

const agentProfileForm=$("#agent-profile-form");
if(agentProfileForm)agentProfileForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const button=$("#save-agent-profile"),status=$("#profile-save-status");
  button.disabled=true;button.textContent="Enviando perfil…";
  if(status){status.textContent="Salvando e enviando ao Painel Master…";status.className="save-status";}
  const payload={
    agentName:$("#profile-agent-name").value,
    brandName:$("#profile-brand-name").value,
    niche:$("#profile-niche").value,
    audience:$("#profile-audience").value,
    goal:$("#profile-goal").value,
    region:$("#profile-region").value,
    offer:$("#profile-offer").value,
    services:$("#profile-services").value,
    differentials:$("#profile-differentials").value,
    tone:$("#profile-tone").value,
    cta:$("#profile-cta").value,
    avoidTopics:$("#profile-avoid").value,
    notes:$("#profile-notes").value,
    whatsapp:$("#profile-whatsapp").value,
    website:$("#profile-website").value,
    primaryColor:$("#profile-primary").value,
    secondaryColor:$("#profile-secondary").value,
    removeLogo:removeProfileLogo
  };
  if(pendingProfileLogo)payload.logoDataUrl=pendingProfileLogo;
  try{
    const r=await fetch("/api/portal/agent-profile",{method:"POST",headers:{"x-nexus-session":sessionAuth,"content-type":"application/json"},body:JSON.stringify(payload)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.message||d.error||"Não foi possível salvar o perfil.");
    renderClient(d);
    if(status){status.textContent="Perfil enviado ao Painel Master com sucesso.";status.className="save-status ok";}
    button.style.display="none";
    setTimeout(()=>{button.style.display="";button.textContent="Atualizar perfil do meu agente";button.disabled=false;},1800);
  }catch(error){
    if(status){status.textContent=error.message;status.className="save-status error";}
    button.disabled=false;button.textContent="Salvar perfil do meu agente";
  }
});

$("#logout").addEventListener("click",async()=>{
  const token=sessionAuth;
  sessionAuth=null;currentClient=null;
  try{if(token)await fetch("/api/portal/logout",{method:"POST",headers:{"x-nexus-session":token}});}catch{}
  $("#portal-view").hidden=true;$("#login-view").hidden=false;$("#login-error").textContent="";
});

function runNexusBoot(){
  const boot=$("#nexus-boot");
  if(!boot)return;
  boot.hidden=false;
  document.body.classList.add("booting");
  const label=$("#boot-status");
  const steps=["Autenticando ambiente...","Sincronizando agente...","NEXUS AI operacional"];
  let i=0;
  if(label)label.textContent=steps[0];
  const timer=setInterval(()=>{
    i++;
    if(label)label.textContent=steps[Math.min(i,steps.length-1)];
    if(i>=steps.length-1){
      clearInterval(timer);
      setTimeout(()=>{
        boot.classList.add("boot-out");
        setTimeout(()=>{boot.hidden=true;boot.classList.remove("boot-out");document.body.classList.remove("booting");},450);
      },500);
    }
  },520);
}

async function resumeCookieSession(){
  const params=new URLSearchParams(location.search);
  if(params.get("error")==="1"){
    $("#login-error").textContent="Usuário ou senha inválidos.";
    return;
  }
  try{
    const r=await fetch("/api/portal/session",{credentials:"same-origin"});
    if(!r.ok)return;
    const c=await r.json();
    $("#login-view").hidden=true;
    $("#portal-view").hidden=false;
    document.documentElement.style.setProperty("--accent",c.primaryColor||"#22c55e");
    renderClient(c);
    $("#login-error").textContent="";
    runNexusBoot();
    showView("overview");
    liveStatus();
    providerUsage();
    loadTokenUsage();
    loadConnections();
    loadClientPosts();
    loadClientLeads();
    loadVideoJobs();
    loadAgentTeam();
  }catch{}
}

/* ===== NEXUS Remember Access ===== */
const loginForm=$("#login-form");
const loginUsername=$("#login-username");
const loginPassword=$("#login-password");
const rememberAccess=$("#remember-access");
const toggleLoginPassword=$("#toggle-login-password");

try{
  const remembered=localStorage.getItem("nexus_remember_access")==="1";
  const savedUsername=localStorage.getItem("nexus_remember_username")||"";
  if(rememberAccess)rememberAccess.checked=remembered;
  if(loginUsername&&remembered&&savedUsername&&!loginUsername.value)loginUsername.value=savedUsername;
}catch{}

if(toggleLoginPassword&&loginPassword){
  toggleLoginPassword.addEventListener("click",()=>{
    const showing=loginPassword.type==="text";
    loginPassword.type=showing?"password":"text";
    toggleLoginPassword.setAttribute("aria-label",showing?"Mostrar senha":"Ocultar senha");
    toggleLoginPassword.title=showing?"Mostrar senha":"Ocultar senha";
  });
}

let loginSubmitCommitted=false;

async function hydrateRememberedCredential(){
  const remember=Boolean(rememberAccess?.checked);
  if(!remember||!("credentials" in navigator)||!("PasswordCredential" in window))return;
  try{
    const credential=await navigator.credentials.get({password:true,mediation:"optional"});
    if(!credential||credential.type!=="password")return;
    if(loginUsername&&!loginUsername.value)loginUsername.value=credential.id||"";
    if(loginPassword&&!loginPassword.value&&credential.password)loginPassword.value=credential.password;
  }catch{}
}

if(loginForm){
  loginForm.addEventListener("submit",async event=>{
    if(loginSubmitCommitted)return;
    const remember=Boolean(rememberAccess?.checked);
    try{
      if(remember){
        localStorage.setItem("nexus_remember_access","1");
        localStorage.setItem("nexus_remember_username",String(loginUsername?.value||"").trim());
      }else{
        localStorage.removeItem("nexus_remember_access");
        localStorage.removeItem("nexus_remember_username");
      }
    }catch{}

    if(remember && "credentials" in navigator && "PasswordCredential" in window){
      event.preventDefault();
      const submit=loginForm.querySelector('button[type="submit"]');
      if(submit){submit.disabled=true;submit.textContent="Salvando acesso…";}
      try{
        const credential=new PasswordCredential(loginForm);
        await navigator.credentials.store(credential);
      }catch{}
      loginSubmitCommitted=true;
      HTMLFormElement.prototype.submit.call(loginForm);
    }
  });
}
hydrateRememberedCredential();

resumeCookieSession();
function videoPlaybackActive(){
  return $$("video").some(video=>!video.paused&&!video.ended&&video.readyState>1);
}
setInterval(()=>{
  const view=$("#view-videos");if(!view||view.hidden)return;
  const active=document.activeElement;
  const editing=view.querySelector(".video-edit-panel:not([hidden])");
  const scheduling=bulkVideoSelection.size>0;
  const typing=active&&view.contains(active)&&["INPUT","TEXTAREA","SELECT"].includes(active.tagName);
  const playing=videoPlaybackActive();
  if(!editing&&!scheduling&&!typing&&!playing)loadVideoJobs();
},12000);


/* ===== NEXUS installable app ===== */
let nexusInstallPrompt=null;
function setInstallButtonsVisible(visible){
  $$("[data-install-app]").forEach(button=>button.hidden=!visible);
}
window.addEventListener("beforeinstallprompt",event=>{
  event.preventDefault();
  nexusInstallPrompt=event;
  setInstallButtonsVisible(true);
});
window.addEventListener("appinstalled",()=>{
  nexusInstallPrompt=null;
  setInstallButtonsVisible(false);
});
$$("[data-install-app]").forEach(button=>button.addEventListener("click",async()=>{
  if(!nexusInstallPrompt)return;
  nexusInstallPrompt.prompt();
  try{await nexusInstallPrompt.userChoice;}catch{}
  nexusInstallPrompt=null;
  setInstallButtonsVisible(false);
}));
if(window.matchMedia("(display-mode: standalone)").matches){
  document.body.classList.add("installed-app");
  setInstallButtonsVisible(false);
}
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));
}
