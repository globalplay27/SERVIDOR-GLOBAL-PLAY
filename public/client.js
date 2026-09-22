const $ = selector => document.querySelector(selector);
let sessionAuth = null;
let currentClient = null;

function nextPostTime(times = []) {
  if (!Array.isArray(times) || !times.length) return "—";
  const parts = new Intl.DateTimeFormat("pt-BR", {timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());
  const nowMinutes = Number(parts.find(p=>p.type==="hour")?.value||0)*60 + Number(parts.find(p=>p.type==="minute")?.value||0);
  const normalized = times.map(value => { const [h,m]=String(value).split(":").map(Number); return {value,minutes:h*60+m}; }).filter(x=>Number.isFinite(x.minutes)).sort((a,b)=>a.minutes-b.minutes);
  return normalized.find(x=>x.minutes>nowMinutes)?.value || normalized[0]?.value || "—";
}
function usageRow(label,value){const safe=Math.min(Number(value)||0,100);return `<div class="usage-row"><div><span>${label}</span><strong>${safe}%</strong></div><div class="bar"><i style="width:${safe}%"></i></div></div>`;}

function renderClient(client){
  currentClient=client;
  $("#client-name").textContent=client.name;
  $("#client-meta").textContent=`${client.niche||"Outro"} · ambiente exclusivo`;
  $("#leads-total").textContent=client.leads?.total||0;
  $("#leads-hot").textContent=client.leads?.hot||0;
  $("#next-post").textContent=nextPostTime(client.postTimes);
  $("#odin-status").textContent=client.odin?"Ativo":"Pausado";
  $("#instagram").textContent=client.instagram||"Pendente";
  $("#niche").textContent=client.niche||"Outro";
  $("#agent-status").textContent=client.status==="online"?"Online":"Em configuração";
  $("#post-times").textContent=(client.postTimes||[]).join(" · ")||"—";
  $("#usage").innerHTML=usageRow("OpenAI",client.usage?.openaiPercent)+usageRow("Railway",client.usage?.railwayPercent);
  populatePosting(client);
}
function showPortal(client){
  $("#login-view").hidden=true;$("#portal-view").hidden=false;
  document.documentElement.style.setProperty("--accent",client.primaryColor||"#22c55e");
  renderClient(client);
}
function populatePosting(client){
  const p=client.postingProfile||{};
  $("#cfg-niche").value=client.niche||"";
  $("#cfg-strategy").value=p.contentStrategy||"Vendas + engajamento";
  $("#cfg-style").value=p.visualStyle||"Tecnológico premium";
  $("#cfg-tone").value=p.tone||"Firme, direto e profissional";
  $("#cfg-focus").value=p.contentFocus||"";
  $("#cfg-avoid").value=p.avoidTopics||"";
  $("#cfg-primary").value=client.primaryColor||"#22c55e";
  $("#cfg-secondary").value=client.secondaryColor||"#050807";
  $("#cfg-cta").value=p.cta||'Comente "QUERO" e saiba mais';
  $("#cfg-hashtags").value=p.hashtags||"";
  const times=client.postTimes||["09:00","12:00","18:00"];
  $("#time-1").value=times[0]||"09:00";$("#time-2").value=times[1]||"12:00";$("#time-3").value=times[2]||"18:00";
  $("#theme-1").value=p.morningTheme||"";$("#theme-2").value=p.afternoonTheme||"";$("#theme-3").value=p.eveningTheme||"";
  updatePreview();
}
function updatePreview(){
  const primary=$("#cfg-primary").value,secondary=$("#cfg-secondary").value;
  $("#cfg-primary-text").textContent=primary;$("#cfg-secondary-text").textContent=secondary;
  $("#creative-preview").style.background=`radial-gradient(circle at 80% 15%,${primary}55,transparent 35%),linear-gradient(135deg,${secondary},#090d0b)`;
  $("#creative-preview").style.borderColor=primary;
  $("#preview-cta").textContent=$("#cfg-cta").value||"CTA";
}
document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>{
  document.querySelectorAll("[data-view]").forEach(x=>x.classList.toggle("active",x===button));
  $("#view-overview").hidden=button.dataset.view!=="overview";
  $("#view-posting").hidden=button.dataset.view!=="posting";
}));
$("#cfg-primary").addEventListener("input",updatePreview);$("#cfg-secondary").addEventListener("input",updatePreview);$("#cfg-cta").addEventListener("input",updatePreview);

$("#posting-form").addEventListener("submit",async event=>{
  event.preventDefault();
  $("#save-status").textContent="Salvando…";$("#save-status").className="save-status";
  const postTimes=[$("#time-1").value,$("#time-2").value,$("#time-3").value].filter(Boolean);
  const payload={
    niche:$("#cfg-niche").value,
    primaryColor:$("#cfg-primary").value,
    secondaryColor:$("#cfg-secondary").value,
    postTimes,
    postingProfile:{
      contentStrategy:$("#cfg-strategy").value,
      visualStyle:$("#cfg-style").value,
      contentFocus:$("#cfg-focus").value,
      morningTheme:$("#theme-1").value,
      afternoonTheme:$("#theme-2").value,
      eveningTheme:$("#theme-3").value,
      tone:$("#cfg-tone").value,
      cta:$("#cfg-cta").value,
      hashtags:$("#cfg-hashtags").value,
      avoidTopics:$("#cfg-avoid").value
    }
  };
  try{
    const response=await fetch("/api/portal/settings",{method:"PATCH",headers:{authorization:sessionAuth,"content-type":"application/json"},body:JSON.stringify(payload)});
    if(!response.ok) throw new Error("Não foi possível salvar.");
    const client=await response.json();renderClient(client);
    document.documentElement.style.setProperty("--accent",client.primaryColor||"#22c55e");
    $("#save-status").textContent="Salvo e enviado ao agente";$("#save-status").className="save-status ok";
  }catch(error){$("#save-status").textContent=error.message;$("#save-status").className="save-status error";}
});

$("#login-form").addEventListener("submit",async event=>{
  event.preventDefault();$("#login-error").textContent="Verificando…";
  const form=new FormData(event.currentTarget);sessionAuth=`Basic ${btoa(`${form.get("username")}:${form.get("password")}`)}`;
  try{
    const response=await fetch("/api/portal/session",{headers:{authorization:sessionAuth}});
    if(!response.ok) throw new Error("Usuário ou senha inválidos.");
    showPortal(await response.json());event.currentTarget.reset();$("#login-error").textContent="";
  }catch(error){sessionAuth=null;$("#login-error").textContent=error.message;}
});
$("#logout").addEventListener("click",()=>{sessionAuth=null;currentClient=null;$("#portal-view").hidden=true;$("#login-view").hidden=false;$("#login-error").textContent="";});
