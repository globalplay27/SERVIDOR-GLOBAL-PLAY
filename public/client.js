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
  const publishTest=$("#publish-test-now");
  if(publishTest)publishTest.hidden=c.id!=="testador";
  populatePosting(c);
  renderOnboarding();
}
function populatePosting(c){const p=c.postingProfile||{};$("#cfg-niche").value=c.niche||"Outro";$("#cfg-audience").value=p.targetAudience||"Misto";$("#cfg-strategy").value=p.contentStrategy||"Vendas + engajamento";$("#cfg-style").value=p.visualStyle||"Tecnológico premium";$("#cfg-tone").value=p.tone||"Firme, direto e profissional";$("#cfg-focus").value=p.contentFocus||"";$("#cfg-avoid").value=p.avoidTopics||"";$("#cfg-primary").value=c.primaryColor||"#22c55e";$("#cfg-secondary").value=c.secondaryColor||"#050807";$("#cfg-cta").value=p.cta||'Comente "QUERO" e saiba mais';$("#cfg-hashtags").value=p.hashtags||"";const t=c.postTimes||["09:00","12:00","18:00"];$("#time-1").value=t[0]||"09:00";$("#time-2").value=t[1]||"12:00";$("#time-3").value=t[2]||"18:00";$("#theme-1").value=p.morningTheme||"";$("#theme-2").value=p.afternoonTheme||"";$("#theme-3").value=p.eveningTheme||"";$("#preview-title").textContent=c.name||"Seu agente";updatePreview();}
function updatePreview(){const p=$("#cfg-primary").value,s=$("#cfg-secondary").value;$("#cfg-primary-text").textContent=p;$("#cfg-secondary-text").textContent=s;$("#creative-preview").style.background=`radial-gradient(circle at 80% 15%,${p}55,transparent 35%),linear-gradient(135deg,${s},#090d0b)`;$("#creative-preview").style.borderColor=p;$("#preview-cta").textContent=$("#cfg-cta").value||"CTA";}
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
$("#cfg-primary").addEventListener("input",updatePreview);$("#cfg-secondary").addEventListener("input",updatePreview);$("#cfg-cta").addEventListener("input",updatePreview);
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

const presets={
  final:{audience:"Cliente final",focus:"Estabilidade, suporte, futebol, filmes e séries para quem quer assistir sem dor de cabeça.",themes:["Dor do cliente: travamento, delay e suporte que não responde","Filmes, séries, variedade de conteúdo e experiência em vários dispositivos","Futebol, jogos ao vivo, estabilidade e chamada para teste"],cta:'Comente "QUERO" para testar'},
  reseller:{audience:"Revendedores",focus:"Captação de revendedores destacando estabilidade, suporte, painel e oportunidade comercial.",themes:["Dor do revendedor: fornecedor some, cliente reclama e painel instável","Estrutura, suporte e recursos para revender com mais tranquilidade","Oportunidade comercial, equipe, crescimento e chamada para abrir painel"],cta:'Comente "QUERO" para saber sobre revenda'},
  mixed:{audience:"Misto",focus:"Misturar aquisição de cliente final com captação de novos revendedores.",themes:["Cliente final: dor de travamento e estabilidade","Entretenimento, filmes e séries para cliente final","Revenda: oportunidade, suporte e estrutura"],cta:'Comente "QUERO" e escolha assinatura ou revenda'}
};
$$("[data-preset]").forEach(b=>b.addEventListener("click",()=>{const p=presets[b.dataset.preset];$("#cfg-niche").value="Streaming";$("#cfg-audience").value=p.audience;$("#cfg-focus").value=p.focus;$("#theme-1").value=p.themes[0];$("#theme-2").value=p.themes[1];$("#theme-3").value=p.themes[2];$("#cfg-cta").value=p.cta;updatePreview();}));

$("#posting-form").addEventListener("submit",async e=>{e.preventDefault();$("#save-status").textContent="Salvando…";$("#save-status").className="save-status";const payload={niche:$("#cfg-niche").value,primaryColor:$("#cfg-primary").value,secondaryColor:$("#cfg-secondary").value,postTimes:[$("#time-1").value,$("#time-2").value,$("#time-3").value].filter(Boolean),postingProfile:{contentStrategy:$("#cfg-strategy").value,targetAudience:$("#cfg-audience").value,visualStyle:$("#cfg-style").value,contentFocus:$("#cfg-focus").value,morningTheme:$("#theme-1").value,afternoonTheme:$("#theme-2").value,eveningTheme:$("#theme-3").value,tone:$("#cfg-tone").value,cta:$("#cfg-cta").value,hashtags:$("#cfg-hashtags").value,avoidTopics:$("#cfg-avoid").value}};try{const r=await fetch("/api/portal/settings",{method:"PATCH",headers:{"x-nexus-session":sessionAuth,"content-type":"application/json"},body:JSON.stringify(payload)});if(!r.ok)throw new Error("Não foi possível salvar.");const c=await r.json();renderClient(c);document.documentElement.style.setProperty("--accent",c.primaryColor||"#22c55e");$("#save-status").textContent="Salvo. O agente usará estas regras nas próximas postagens.";$("#save-status").className="save-status ok";await patchOnboarding({creativeProfile:true});}catch(err){$("#save-status").textContent=err.message;$("#save-status").className="save-status error";}});

const publishTestButton=$("#publish-test-now");
if(publishTestButton)publishTestButton.addEventListener("click",async()=>{
  if(!confirm("Publicar agora esta postagem de teste no Instagram conectado?"))return;
  publishTestButton.disabled=true;
  const originalText=publishTestButton.textContent;
  publishTestButton.textContent="Publicando…";
  $("#save-status").textContent="Enviando imagem ao Instagram…";
  $("#save-status").className="save-status";
  const payload={
    imageUrl:"https://cdn.openart.ai/openart-uploads/production/attachment-transfers/2be36b8d8426d0dc34aeea7466c37256badd4decfc736a8136840c21c81a7fd3.jpg",
    caption:'🚀 Sua empresa precisa aparecer mais?\n\nCriamos imagens profissionais, vídeos promocionais, automação para Instagram e sites modernos para transformar sua presença digital em mais autoridade, oportunidades e vendas.\n\n✅ Imagens profissionais\n✅ Vídeos promocionais\n✅ Automação de Instagram\n✅ Sites profissionais\n\nQuer levar sua empresa para outro nível?\nComente “QUERO” ou chame no direct.\n\n#MarketingDigital #AutomacaoInstagram #CriacaoDeSites #DesignProfissional #VideosPromocionais #ConteudoDigital #PresencaDigital #VendasOnline #Empreendedorismo #SocialMedia'
  };
  try{
    const r=await fetch("/api/portal/instagram/publish-test",{method:"POST",headers:{"x-nexus-session":sessionAuth,"content-type":"application/json"},body:JSON.stringify(payload)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.message||d.error||"Falha ao publicar.");
    $("#save-status").textContent=d.permalink?"Publicado com sucesso. Abrindo Instagram…":"Publicado com sucesso no Instagram.";
    $("#save-status").className="save-status ok";
    if(d.permalink)window.open(d.permalink,"_blank","noopener");
  }catch(err){
    $("#save-status").textContent=err.message;
    $("#save-status").className="save-status error";
  }finally{
    publishTestButton.disabled=false;
    publishTestButton.textContent=originalText;
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
