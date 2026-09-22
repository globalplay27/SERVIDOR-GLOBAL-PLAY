const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let sessionAuth=null,currentClient=null;

function nextPostTime(times=[]){if(!Array.isArray(times)||!times.length)return"—";const parts=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());const now=Number(parts.find(p=>p.type==="hour")?.value||0)*60+Number(parts.find(p=>p.type==="minute")?.value||0);const sorted=times.map(v=>{const[h,m]=String(v).split(":").map(Number);return{v,m:h*60+m}}).filter(x=>Number.isFinite(x.m)).sort((a,b)=>a.m-b.m);return sorted.find(x=>x.m>now)?.v||sorted[0]?.v||"—";}
function showView(name){$$("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===name));["overview","posting","setup"].forEach(v=>$("#view-"+v).hidden=v!==name);}
function onboardingKeys(){return["github","railway","openai","facebook","instagram","metaApp","creativeProfile","supportRequested"];}
function setupPercent(){const o=currentClient?.onboarding||{};const keys=onboardingKeys();return Math.round(keys.filter(k=>o[k]).length/keys.length*100);}
function renderOnboarding(){
  const o=currentClient?.onboarding||{},pct=setupPercent();$("#setup-progress").textContent=pct+"%";$("#setup-banner").hidden=pct>=100;
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

function renderClient(c){currentClient=c;renderConnections(c.connections||{});$("#client-name").textContent=c.name;$("#client-meta").textContent=`${c.niche||"Outro"} · ambiente exclusivo`;$("#leads-total").textContent=c.leads?.total||0;$("#leads-hot").textContent=c.leads?.hot||0;$("#next-post").textContent=nextPostTime(c.postTimes);$("#odin-status").textContent=c.odin?"Ativo":"Pausado";$("#instagram").textContent=c.instagram||"Pendente";$("#niche").textContent=c.niche||"Outro";$("#agent-status").textContent=c.status==="online"?"Online":"Em configuração";$("#post-times").textContent=(c.postTimes||[]).join(" · ")||"—";populatePosting(c);renderOnboarding();}
function populatePosting(c){const p=c.postingProfile||{};$("#cfg-niche").value=[...$("#cfg-niche").options].some(o=>o.value===c.niche)?c.niche:"Outro";$("#cfg-audience").value=p.targetAudience||"Misto";$("#cfg-strategy").value=p.contentStrategy||"Vendas + engajamento";$("#cfg-style").value=p.visualStyle||"Tecnológico premium";$("#cfg-tone").value=p.tone||"Firme, direto e profissional";$("#cfg-focus").value=p.contentFocus||"";$("#cfg-avoid").value=p.avoidTopics||"";$("#cfg-primary").value=c.primaryColor||"#22c55e";$("#cfg-secondary").value=c.secondaryColor||"#050807";$("#cfg-cta").value=p.cta||'Comente "QUERO" e saiba mais';$("#cfg-hashtags").value=p.hashtags||"";const t=c.postTimes||["09:00","12:00","18:00"];$("#time-1").value=t[0]||"09:00";$("#time-2").value=t[1]||"12:00";$("#time-3").value=t[2]||"18:00";$("#theme-1").value=p.morningTheme||"";$("#theme-2").value=p.afternoonTheme||"";$("#theme-3").value=p.eveningTheme||"";$("#preview-title").textContent=c.name||"Seu agente";updatePreview();}
function updatePreview(){const p=$("#cfg-primary").value,s=$("#cfg-secondary").value;$("#cfg-primary-text").textContent=p;$("#cfg-secondary-text").textContent=s;$("#creative-preview").style.background=`radial-gradient(circle at 80% 15%,${p}55,transparent 35%),linear-gradient(135deg,${s},#090d0b)`;$("#creative-preview").style.borderColor=p;$("#preview-cta").textContent=$("#cfg-cta").value||"CTA";}
async function providerUsage(){
  try{
    const r=await fetch("/api/portal/provider-usage",{headers:{"x-nexus-session":sessionAuth}});
    if(!r.ok)return;
    const d=await r.json();
    if(d.openai?.connected){
      $("#live-openai").textContent=d.openai.costAvailable?`US$ ${Number(d.openai.cost31dUsd||0).toFixed(2)} / 31 dias`:"OpenAI conectada";
      $("#live-openai-detail").textContent=d.openai.costAvailable?"Custo obtido da API da organização.":"Chave do projeto validada. Custo exige credencial administrativa compatível.";
    }
    if(d.railway?.connected){
      $("#live-railway").textContent=d.railway.projectCount!=null?`${d.railway.projectCount} projeto(s) autorizado(s)`:"Railway conectada";
      $("#live-railway-detail").textContent=(d.railway.projects||[]).slice(0,3).map(p=>p.name).filter(Boolean).join(" · ")||"Autorização Railway ativa.";
    }
  }catch{}
}

async function liveStatus(){try{const r=await fetch("/api/portal/live-status",{headers:{"x-nexus-session":sessionAuth}}),d=await r.json();if(!d.connected){$("#agent-live-chip").textContent="SEM LEITURA";$("#agent-live-chip").classList.add("off");$("#live-openai").textContent="Aguardando conexão";$("#live-openai-detail").textContent="O agente ainda não respondeu.";$("#live-railway").textContent="Aguardando conexão";$("#live-railway-detail").textContent="—";return;}$("#agent-live-chip").textContent="ONLINE";$("#agent-live-chip").classList.remove("off");$("#agent-status").textContent="Online";if(Array.isArray(d.post_times)&&d.post_times.length){currentClient.postTimes=d.post_times;$("#post-times").textContent=d.post_times.join(" · ");$("#next-post").textContent=nextPostTime(d.post_times);}const oa=d.openai||{};$("#live-openai").textContent=oa.month_cost_usd!=null?`US$ ${Number(oa.month_cost_usd).toFixed(2)} / 31 dias`:oa.configured?"Conta conectada":"Não conectada";$("#live-openai-detail").textContent=oa.status||"Sem custo disponível pela API";const rw=d.railway||{};$("#live-railway").textContent=rw.project||"Railway";$("#live-railway-detail").textContent=rw.disk_used_mb!=null?`${rw.disk_used_mb} MB usados · ${rw.disk_free_mb} MB livres`:"Sem métricas";}catch(e){$("#agent-live-chip").textContent="SEM LEITURA";}}
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

async function patchOnboarding(payload){const r=await fetch("/api/portal/onboarding",{method:"PATCH",headers:{"x-nexus-session":sessionAuth,"content-type":"application/json"},body:JSON.stringify(payload)});if(!r.ok)throw new Error("Falha ao salvar etapa");renderClient(await r.json());}
$$("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));$$("[data-open-setup]").forEach(b=>b.addEventListener("click",()=>showView("setup")));$$("[data-open-posting]").forEach(b=>b.addEventListener("click",()=>showView("posting")));
$("#cfg-primary").addEventListener("input",updatePreview);$("#cfg-secondary").addEventListener("input",updatePreview);$("#cfg-cta").addEventListener("input",updatePreview);
$("[data-complete]").forEach(b=>b.addEventListener("click",async()=>{b.disabled=true;try{await patchOnboarding({[b.dataset.complete]:true});}finally{b.disabled=false;}}));
$("[data-connect]").forEach(b=>b.addEventListener("click",()=>{const provider=b.dataset.connect;if(provider==="railway")startRailwayConnection();else openConnectionModal(provider);}));
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
$("#request-support").addEventListener("click",async()=>{await patchOnboarding({supportRequested:true});alert("Solicitação registrada. O suporte poderá concluir a instalação final.");});

const presets={
  final:{audience:"Cliente final",focus:"Estabilidade, suporte, futebol, filmes e séries para quem quer assistir sem dor de cabeça.",themes:["Dor do cliente: travamento, delay e suporte que não responde","Filmes, séries, variedade de conteúdo e experiência em vários dispositivos","Futebol, jogos ao vivo, estabilidade e chamada para teste"],cta:'Comente "QUERO" para testar'},
  reseller:{audience:"Revendedores",focus:"Captação de revendedores destacando estabilidade, suporte, painel e oportunidade comercial.",themes:["Dor do revendedor: fornecedor some, cliente reclama e painel instável","Estrutura, suporte e recursos para revender com mais tranquilidade","Oportunidade comercial, equipe, crescimento e chamada para abrir painel"],cta:'Comente "QUERO" para saber sobre revenda'},
  mixed:{audience:"Misto",focus:"Misturar aquisição de cliente final com captação de novos revendedores.",themes:["Cliente final: dor de travamento e estabilidade","Entretenimento, filmes e séries para cliente final","Revenda: oportunidade, suporte e estrutura"],cta:'Comente "QUERO" e escolha assinatura ou revenda'}
};
$$("[data-preset]").forEach(b=>b.addEventListener("click",()=>{const p=presets[b.dataset.preset];$("#cfg-niche").value="Streaming";$("#cfg-audience").value=p.audience;$("#cfg-focus").value=p.focus;$("#theme-1").value=p.themes[0];$("#theme-2").value=p.themes[1];$("#theme-3").value=p.themes[2];$("#cfg-cta").value=p.cta;updatePreview();}));

$("#posting-form").addEventListener("submit",async e=>{e.preventDefault();$("#save-status").textContent="Salvando…";$("#save-status").className="save-status";const payload={niche:$("#cfg-niche").value,primaryColor:$("#cfg-primary").value,secondaryColor:$("#cfg-secondary").value,postTimes:[$("#time-1").value,$("#time-2").value,$("#time-3").value].filter(Boolean),postingProfile:{contentStrategy:$("#cfg-strategy").value,targetAudience:$("#cfg-audience").value,visualStyle:$("#cfg-style").value,contentFocus:$("#cfg-focus").value,morningTheme:$("#theme-1").value,afternoonTheme:$("#theme-2").value,eveningTheme:$("#theme-3").value,tone:$("#cfg-tone").value,cta:$("#cfg-cta").value,hashtags:$("#cfg-hashtags").value,avoidTopics:$("#cfg-avoid").value}};try{const r=await fetch("/api/portal/settings",{method:"PATCH",headers:{"x-nexus-session":sessionAuth,"content-type":"application/json"},body:JSON.stringify(payload)});if(!r.ok)throw new Error("Não foi possível salvar.");const c=await r.json();renderClient(c);document.documentElement.style.setProperty("--accent",c.primaryColor||"#22c55e");$("#save-status").textContent="Salvo. O agente usará estas regras nas próximas postagens.";$("#save-status").className="save-status ok";await patchOnboarding({creativeProfile:true});}catch(err){$("#save-status").textContent=err.message;$("#save-status").className="save-status error";}});

$("#login-form").addEventListener("submit",async e=>{
  e.preventDefault();
  $("#login-error").textContent="Verificando…";
  const f=new FormData(e.currentTarget);
  try{
    const r=await fetch("/api/portal/login",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({username:String(f.get("username")||"").trim(),password:String(f.get("password")||"")})
    });
    const d=await r.json();
    if(!r.ok||!d.token||!d.client)throw new Error("Usuário ou senha inválidos.");
    sessionAuth=d.token;
    const c=d.client;
    $("#login-view").hidden=true;
    $("#portal-view").hidden=false;
    document.documentElement.style.setProperty("--accent",c.primaryColor||"#22c55e");
    renderClient(c);
    e.currentTarget.reset();
    $("#login-error").textContent="";
    showView("setup");
    liveStatus();
    providerUsage();
    loadConnections();
  }catch(err){
    sessionAuth=null;
    $("#login-error").textContent=err.message;
  }
});
$("#logout").addEventListener("click",async()=>{
  const token=sessionAuth;
  sessionAuth=null;currentClient=null;
  try{if(token)await fetch("/api/portal/logout",{method:"POST",headers:{"x-nexus-session":token}});}catch{}
  $("#portal-view").hidden=true;$("#login-view").hidden=false;$("#login-error").textContent="";
});
