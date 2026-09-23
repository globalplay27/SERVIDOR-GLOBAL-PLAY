const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let sessionAuth=null,currentClient=null;

function nextPostTime(times=[]){if(!Array.isArray(times)||!times.length)return"—";const parts=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());const now=Number(parts.find(p=>p.type==="hour")?.value||0)*60+Number(parts.find(p=>p.type==="minute")?.value||0);const sorted=times.map(v=>{const[h,m]=String(v).split(":").map(Number);return{v,m:h*60+m}}).filter(x=>Number.isFinite(x.m)).sort((a,b)=>a.m-b.m);return sorted.find(x=>x.m>now)?.v||sorted[0]?.v||"—";}
function showView(name){$$("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===name));["overview","posting","support","setup"].forEach(v=>{const el=$("#view-"+v);if(el)el.hidden=v!==name;});if(name==="support")loadSupportTickets();}
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
$$("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));$$("[data-open-setup]").forEach(b=>b.addEventListener("click",()=>showView("setup")));$$("[data-open-posting]").forEach(b=>b.addEventListener("click",()=>showView("posting")));
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
    loadConnections();
  }catch{}
}
resumeCookieSession();


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
