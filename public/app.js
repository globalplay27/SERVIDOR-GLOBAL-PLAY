const state = { clients: [], auth: sessionStorage.getItem("nexus-auth"), portalClientId: null, supportTickets: [], supportFilter: "all", postLedger: { posts: [], byClient: [], totalCostUsd: 0, totalPosts: 0, published: 0, failed: 0 }, postClientFilter: "", leadData: { summary:{total:0,hot:0,warm:0,cold:0,needsHuman:0}, leads:[], byClient:[] }, leadClientFilter:"", agentCore: { modules:[], clients:[], totalExecutionsToday:0, totalCostTodayUsd:0, totalCostMonthUsd:0 }, agentCoreClientId:"" };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  return fetch(path, { ...options, headers, credentials: "same-origin" }).then(async response => {
    if (response.status === 401) {
      location.href = "/master";
      throw new Error("Sessão administrativa expirada");
    }
    if (!response.ok) throw new Error(`Erro ${response.status}`);
    return response.json();
  });
}

function badge(value, online = true) { return `<span class="badge ${online ? "" : "off"}">${value}</span>`; }
function initials(name) { return name.split(/\s+/).map(word => word[0]).join("").slice(0, 2).toUpperCase(); }
function aiModeLabel(mode) {
  return mode === "own-key" ? "CHAVE PRÓPRIA" : "SEM IMAGEM PAGA";
}

function render() {
  const clients = state.clients;
  const online = clients.filter(client => client.status === "online").length;
  const totals = state.leadData?.summary || { total:0, hot:0, warm:0, cold:0, needsHuman:0 };
  const alerts = clients.filter(client => Math.max(client.usage?.openaiPercent || 0, client.usage?.railwayPercent || 0) >= 80).length;
  $("#metric-clients").textContent = clients.length;
  $("#metric-online").textContent = online;
  $("#metric-leads").textContent = totals.total;
  $("#metric-hot").textContent = `${totals.hot} quentes`;
  $("#metric-alerts").textContent = alerts;
  $("#funnel-total").textContent = totals.total;
  $("#funnel-warm").textContent = totals.warm;
  $("#funnel-hot").textContent = totals.hot;

  $("#client-cards").innerHTML = clients.length ? clients.slice(0, 4).map(client => `<div class="client-card"><div class="avatar" style="--accent:${client.primaryColor || "#22c55e"}">${initials(client.name)}</div><div><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(client.instagram || "Instagram pendente")} · ${escapeHtml(client.niche || "Outro")}</small></div>${badge(client.status === "online" ? "ONLINE" : "SETUP", client.status === "online")}</div>`).join("") : `<p class="muted">Nenhum cliente cadastrado.</p>`;

  const managedUsageClients = clients.filter(client => client.id !== "ragnar-one");
  $("#usage-list").innerHTML = managedUsageClients.length ? managedUsageClients.map(client => {
    return `<div class="usage-row"><div><span>${escapeHtml(client.name)}</span><strong>Geração paga de imagens desativada</strong></div><div class="bar"><i style="width:0%"></i></div></div>`;
  }).join("") : `<p class="muted">Novos clientes aparecerão aqui. Ragnar continua isolado na própria conta.</p>`;

  $("#clients-table").innerHTML = clients.map(client => {
    const ragnar = client.id === "ragnar-one";
    const mode = ragnar ? "Conta própria" : "NEXUS GERENCIADA";
    const extra = !ragnar ? `<br><small>imagem IA paga desativada</small>` : "";
    const protect = ragnar
      ? `<span class="protected-client">PILOTO PROTEGIDO</span>`
      : client.ownerAccount
        ? `<span class="protected-client">CONTA PRINCIPAL</span>`
        : "";
    const remove = (!ragnar && !client.ownerAccount)
      ? `<button type="button" class="small-danger" data-delete-client="${escapeHtml(client.id)}" data-client-name="${escapeHtml(client.name)}">Excluir</button>`
      : "";
    const action = `<div class="client-action-stack"><button type="button" class="small-primary" data-assume-client="${escapeHtml(client.id)}">Assumir painel</button><button type="button" class="small-primary" data-portal-access="${escapeHtml(client.id)}" data-client-name="${escapeHtml(client.name)}">Definir acesso</button>${remove}${protect}</div>`;
    return `<tr><td><strong>${escapeHtml(client.name)}</strong><br><small>${escapeHtml(client.niche || "Outro")}</small></td><td>${badge(client.status === "online" ? "ONLINE" : "SETUP", client.status === "online")}</td><td>${escapeHtml(client.instagram || "Aguardando conexão")}</td><td>${client.odin ? badge("ATIVO") : badge("DESLIGADO", false)}</td><td>${(client.postTimes || []).join(" · ") || "—"}</td><td><strong>${mode}</strong>${extra}</td><td>${action}</td></tr>`;
  }).join("");
  renderAgentProfiles();
  renderPortalSelector();
}

function renderAgentProfiles() {
  const root = $("#master-agent-profiles");
  if (!root) return;
  const clients = state.clients.filter(client => client.id !== "ragnar-one");
  if (!clients.length) {
    root.innerHTML = '<div class="master-profile-empty">Os perfis enviados pelos clientes aparecerão aqui.</div>';
    return;
  }
  root.innerHTML = clients.map(client => {
    const p = client.agentProfile || {};
    if (!p.submittedAt) {
      return `<article class="master-profile-card waiting"><div class="master-profile-head"><div class="master-profile-logo fallback">${initials(client.name)}</div><div><span class="profile-kicker">AGUARDANDO CLIENTE</span><h3>${escapeHtml(client.name)}</h3><small>O perfil do agente ainda não foi enviado.</small></div></div></article>`;
    }
    const logo = p.logoUrl
      ? `<div class="master-profile-logo"><img src="${escapeHtml(p.logoUrl)}" alt=""></div>`
      : `<div class="master-profile-logo fallback" style="--profile-color:${escapeHtml(p.primaryColor||client.primaryColor||"#22c55e")}">${initials(p.brandName||client.name)}</div>`;
    const status = p.status === "configured" ? "CONFIGURADO" : "NOVO PERFIL";
    const post = client.postingProfile || {};
    const times = Array.isArray(client.postTimes) ? client.postTimes : ["09:00","12:00","18:00"];
    return `<article class="master-profile-card" data-master-profile="${escapeHtml(client.id)}">
      <div class="master-profile-head">
        ${logo}
        <div class="master-profile-title"><span class="profile-kicker">${escapeHtml(p.agentName||"AGENTE NEXUS")}</span><h3>${escapeHtml(p.brandName||client.name)}</h3><small>${escapeHtml(p.niche||client.niche||"Outro")} · enviado ${formatSupportDate(p.submittedAt)}</small></div>
        ${badge(status,p.status==="configured")}
      </div>
      <div class="master-profile-colorline"><i style="background:${escapeHtml(p.primaryColor||client.primaryColor||"#22c55e")}"></i><i style="background:${escapeHtml(p.secondaryColor||client.secondaryColor||"#050807")}"></i><span>Identidade enviada pelo cliente</span></div>
      <div class="master-profile-facts">
        <div><span>Público</span><strong>${escapeHtml(p.audience||"—")}</strong></div>
        <div><span>Objetivo</span><strong>${escapeHtml(p.goal||"—")}</strong></div>
        <div><span>Região</span><strong>${escapeHtml(p.region||"—")}</strong></div>
        <div><span>WhatsApp</span><strong>${escapeHtml(p.whatsapp||"—")}</strong></div>
      </div>
      <div class="master-profile-text"><span>O que oferece</span><p>${escapeHtml(p.offer||"Não informado")}</p></div>
      <div class="master-profile-text"><span>Produtos / serviços</span><p>${escapeHtml(p.services||"Não informado")}</p></div>
      <div class="master-profile-text"><span>Diferenciais</span><p>${escapeHtml(p.differentials||"Não informado")}</p></div>
      <details class="master-agent-config" ${p.status!=="configured"?"open":""}>
        <summary>Configurar operação do agente</summary>
        <div class="master-config-grid">
          <label>Horário 1<input data-master-time="0" type="time" value="${escapeHtml(times[0]||"09:00")}"></label>
          <label>Horário 2<input data-master-time="1" type="time" value="${escapeHtml(times[1]||"12:00")}"></label>
          <label>Horário 3<input data-master-time="2" type="time" value="${escapeHtml(times[2]||"18:00")}"></label>
          <label>Estratégia<input data-master-field="contentStrategy" value="${escapeHtml(post.contentStrategy||"Vendas + engajamento")}"></label>
          <label>Estilo visual<input data-master-field="visualStyle" value="${escapeHtml(post.visualStyle||"Tecnológico premium")}"></label>
          <label>Tom<input data-master-field="tone" value="${escapeHtml(post.tone||p.tone||"Firme, direto e profissional")}"></label>
          <label class="wide">Foco principal<textarea data-master-field="contentFocus" rows="3">${escapeHtml(post.contentFocus||p.offer||"")}</textarea></label>
          <label class="wide">Tema da manhã<input data-master-field="morningTheme" value="${escapeHtml(post.morningTheme||"")}"></label>
          <label class="wide">Tema da tarde<input data-master-field="afternoonTheme" value="${escapeHtml(post.afternoonTheme||"")}"></label>
          <label class="wide">Tema da noite<input data-master-field="eveningTheme" value="${escapeHtml(post.eveningTheme||"")}"></label>
          <label class="wide">CTA<input data-master-field="cta" value="${escapeHtml(post.cta||p.cta||"")}"></label>
          <label class="wide">Hashtags<textarea data-master-field="hashtags" rows="2">${escapeHtml(post.hashtags||"")}</textarea></label>
          <label class="wide">Não publicar<textarea data-master-field="avoidTopics" rows="2">${escapeHtml(post.avoidTopics||p.avoidTopics||"")}</textarea></label>
        </div>
        <div class="master-config-actions"><button type="button" class="primary" data-master-profile-save>Salvar configuração do agente</button><span data-master-profile-message></span></div>
      </details>
    </article>`;
  }).join("");
}

function renderPortalSelector() {
  const select = $("#portal-client");
  if (!state.clients.length) {
    select.innerHTML = "<option>Nenhum cliente</option>";
    $("#portal-empty").hidden = false;
    $("#client-portal").hidden = true;
    return;
  }
  if (!state.portalClientId || !state.clients.some(client => client.id === state.portalClientId)) state.portalClientId = state.clients[0].id;
  select.innerHTML = state.clients.map(client => `<option value="${escapeHtml(client.id)}" ${client.id === state.portalClientId ? "selected" : ""}>${escapeHtml(client.name)}</option>`).join("");
  renderClientPortal(state.clients.find(client => client.id === state.portalClientId));
}

function renderClientPortal(client) {
  if (!client) return;
  $("#portal-empty").hidden = true;
  $("#client-portal").hidden = false;
  const online = client.status === "online";
  const accent = client.primaryColor || "#24e27a";
  $("#client-portal").style.setProperty("--client-accent", accent);
  $("#portal-avatar").textContent = initials(client.name);
  $("#portal-name").textContent = client.name;
  $("#portal-meta").textContent = `${client.niche || "Outro"} · Portal exclusivo`;
  $("#portal-status").textContent = online ? "Agente online" : "Em configuração";
  $("#portal-leads").textContent = client.leads?.total || 0;
  $("#portal-hot").textContent = client.leads?.hot || 0;
  $("#portal-next-post").textContent = client.postTimes?.[0] || "—";
  $("#portal-odin").textContent = client.odin ? "Ativa" : "Pausada";
  $("#portal-instagram").textContent = client.instagram || "Pendente";
  $("#portal-niche").textContent = client.niche || "Outro";
  $("#portal-times").textContent = (client.postTimes || []).join(" · ") || "—";
  const agentBadge = $("#portal-agent-badge");
  agentBadge.textContent = online ? "ONLINE" : "SETUP";
  agentBadge.classList.toggle("off", !online);
  const ragnar = client.id === "ragnar-one";
  const mode = ragnar ? "Conta OpenAI própria" : "NEXUS sem imagem paga";
  const aiDetail = ragnar ? "isolada do NEXUS central" : "geração paga de imagens desativada";
  $("#portal-usage").innerHTML = `<div class="usage-row"><div><span>Modo de IA</span><strong>${mode}</strong></div><small>${aiDetail}</small></div><div class="usage-row"><div><span>Infraestrutura</span><strong>Gerenciada pelo NEXUS</strong></div><small>GitHub e Railway não são exigidos do cliente.</small></div>`;
}

function escapeHtml(value) { const el = document.createElement("span"); el.textContent = String(value); return el.innerHTML; }

function moneyPost(value) {
  const amount = Number(value || 0);
  return "US$ " + (Number.isFinite(amount) ? amount.toFixed(4) : "0.0000");
}

function postStatusMeta(status) {
  const map = {
    published: ["PUBLICADA", "published"],
    failed: ["FALHOU", "failed"],
    skipped: ["NÃO FEITA", "failed"],
    publishing: ["PUBLICANDO", "running"],
    generating: ["GERANDO", "running"],
    ready: ["PRONTA", "running"],
    scheduled: ["AGENDADA", "running"]
  };
  return map[status] || [String(status || "AGENDADA").toUpperCase(), "running"];
}

function formatPostDate(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch { return "—"; }
}

function renderPostLedger() {
  const data = state.postLedger || {};
  if ($("#posts-total-cost")) $("#posts-total-cost").textContent = moneyPost(data.totalCostUsd);
  if ($("#posts-total-count")) $("#posts-total-count").textContent = Number(data.totalPosts || 0);
  if ($("#posts-published-count")) $("#posts-published-count").textContent = Number(data.published || 0);
  if ($("#posts-failed-count")) $("#posts-failed-count").textContent = Number(data.failed || 0);

  const ranking = $("#post-cost-ranking");
  if (ranking) {
    const rows = data.byClient || [];
    const max = Math.max(0.000001, ...rows.map(item => Number(item.costUsd || 0)));
    ranking.innerHTML = rows.length ? rows.map((item, index) => {
      const pct = Math.max(3, Math.round(Number(item.costUsd || 0) / max * 100));
      return `<div class="post-rank-row">
        <div class="post-rank-head"><span><b>#${index + 1}</b> ${escapeHtml(item.clientName || item.clientId)}</span><strong>${moneyPost(item.costUsd)}</strong></div>
        <small>${escapeHtml(item.instagram || "")} · ${Number(item.published || 0)} publicadas · ${Number(item.failed || 0)} falhas</small>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </div>`;
    }).join("") : '<p class="muted">Os custos aparecerão assim que os agentes registrarem novas postagens.</p>';
  }

  const filter = $("#post-client-filter");
  if (filter) {
    const previous = state.postClientFilter || filter.value || "";
    const clients = state.clients || [];
    filter.innerHTML = '<option value="">Todos</option>' + clients.map(client => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)} · ${escapeHtml(client.instagram || "sem Instagram")}</option>`).join("");
    filter.value = clients.some(client => client.id === previous) ? previous : "";
    state.postClientFilter = filter.value;
  }

  const body = $("#post-ledger-body");
  if (!body) return;
  let posts = Array.isArray(data.posts) ? data.posts : [];
  if (state.postClientFilter) posts = posts.filter(post => post.clientId === state.postClientFilter);
  body.innerHTML = posts.length ? posts.map(post => {
    const [label, cls] = postStatusMeta(post.status);
    const detail = post.error ? escapeHtml(post.error) : post.mediaId ? "Media ID " + escapeHtml(post.mediaId) : "—";
    return `<tr>
      <td><strong>${escapeHtml(post.clientName || post.clientId)}</strong></td>
      <td>${escapeHtml(post.instagram || "—")}</td>
      <td><strong>${escapeHtml(post.scheduledHour || "—")}</strong><br><small>${formatPostDate(post.scheduledFor)}</small></td>
      <td>${formatPostDate(post.publishedAt || post.attemptedAt)}</td>
      <td><span class="post-status ${cls}">${label}</span></td>
      <td><strong>${moneyPost(post.costUsd)}</strong><br><small>${escapeHtml(post.costSource || "sem custo registrado")}</small></td>
      <td>${escapeHtml(post.model || "—")}</td>
      <td class="post-detail">${detail}</td>
    </tr>`;
  }).join("") : '<tr><td colspan="8">Nenhuma postagem registrada para este filtro.</td></tr>';
}

async function loadPostLedger() {
  try {
    state.postLedger = await api("/api/master/posts");
    renderPostLedger();
  } catch (error) {
    console.error(error);
  }
}

function leadTempMeta(value){
  const map={hot:["QUENTE","hot"],warm:["MORNO","warm"],cold:["FRIO","cold"]};
  return map[value]||["FRIO","cold"];
}
function leadDate(value){
  if(!value)return"—";
  const date=typeof value==="number"?new Date(value*1000):new Date(value);
  try{return new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"}).format(date);}catch{return"—";}
}
function renderMasterLeads(){
  const data=state.leadData||{},summary=data.summary||{};
  if($("#funnel-total"))$("#funnel-total").textContent=Number(summary.total||0);
  if($("#funnel-hot"))$("#funnel-hot").textContent=Number(summary.hot||0);
  if($("#funnel-warm"))$("#funnel-warm").textContent=Number(summary.warm||0);
  if($("#funnel-cold"))$("#funnel-cold").textContent=Number(summary.cold||0);
  if($("#funnel-human"))$("#funnel-human").textContent=Number(summary.needsHuman||0);
  const filter=$("#master-lead-client-filter");
  if(filter){
    const previous=state.leadClientFilter||filter.value||"";
    filter.innerHTML='<option value="">Todos</option>'+state.clients.map(client=>`<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)} · ${escapeHtml(client.instagram||"sem Instagram")}</option>`).join("");
    filter.value=state.clients.some(c=>c.id===previous)?previous:"";state.leadClientFilter=filter.value;
  }
  const body=$("#master-leads-body");if(!body)return;
  let leads=Array.isArray(data.leads)?data.leads:[];
  if(state.leadClientFilter)leads=leads.filter(lead=>lead.clientId===state.leadClientFilter);
  body.innerHTML=leads.length?leads.map(lead=>{
    const [label,cls]=leadTempMeta(lead.temperature);
    const handle=lead.instagramUsername?"@"+escapeHtml(String(lead.instagramUsername).replace(/^@/,"")):(lead.instagramUserId?"ID …"+escapeHtml(String(lead.instagramUserId).slice(-6)):"Sem @");
    return `<tr><td><strong>${escapeHtml(lead.clientName||lead.clientId)}</strong></td><td>${handle}</td><td><span class="master-lead-temp ${cls}">${label}</span></td><td><strong>${Number(lead.score||0)}</strong></td><td>${escapeHtml(lead.intent||lead.triggerKeyword||"—")}</td><td>${escapeHtml(lead.stage||"—")}</td><td>${lead.needsHuman?'<span class="human-flag">SIM</span>':"não"}</td><td>${leadDate(lead.updatedAt||lead.lastContactAt)}</td></tr>`;
  }).join(""):'<tr><td colspan="8">Nenhum lead captado para este filtro.</td></tr>';
}
async function loadMasterLeads(){
  try{state.leadData=await api("/api/master/leads");renderMasterLeads();render();}
  catch(error){console.error(error);}
}


function agentCoreStatusMeta(status){
  if(status==="success")return["OK","published"];
  if(status==="failed")return["FALHOU","failed"];
  if(status==="blocked")return["BLOQUEADO","failed"];
  return["ATENÇÃO","running"];
}
function selectedAgentCoreClient(){
  const clients=Array.isArray(state.agentCore?.clients)?state.agentCore.clients:[];
  if(!clients.length)return null;
  if(!state.agentCoreClientId||!clients.some(item=>item.clientId===state.agentCoreClientId))state.agentCoreClientId=clients[0].clientId;
  return clients.find(item=>item.clientId===state.agentCoreClientId)||clients[0];
}
function syncAgentCoreApprovalUi(){
  const auto=$("#agent-core-auto-publish"),approval=$("#agent-core-require-approval");
  if(!auto||!approval)return;
  if(!auto.checked){approval.checked=true;approval.disabled=true;}
  else approval.disabled=false;
  const required=approval.checked;
  if($("#agent-core-approval-label"))$("#agent-core-approval-label").textContent=required?"APROVAÇÃO OBRIGATÓRIA":"MODO AUTOMÁTICO LIBERADO";
  if($("#agent-core-approval-note"))$("#agent-core-approval-note").textContent=required
    ?"Nenhuma pauta do Creator será publicada sem aprovação."
    :"O Publisher poderá publicar conteúdo pronto sem aprovação manual.";
}
function renderAgentCore(){
  const data=state.agentCore||{};
  if($("#agent-core-executions"))$("#agent-core-executions").textContent=Number(data.totalExecutionsToday||0);
  if($("#agent-core-cost-today"))$("#agent-core-cost-today").textContent=moneyPost(data.totalCostTodayUsd);
  if($("#agent-core-cost-month"))$("#agent-core-cost-month").textContent=moneyPost(data.totalCostMonthUsd);
  const clients=Array.isArray(data.clients)?data.clients:[];
  if($("#agent-core-active-clients"))$("#agent-core-active-clients").textContent=clients.filter(item=>item.config?.enabled!==false).length;

  const select=$("#agent-core-client");
  if(select){
    const previous=state.agentCoreClientId||select.value||"";
    select.innerHTML=clients.map(item=>`<option value="${escapeHtml(item.clientId)}">${escapeHtml(item.clientName||item.clientId)}</option>`).join("");
    state.agentCoreClientId=clients.some(item=>item.clientId===previous)?previous:(clients[0]?.clientId||"");
    select.value=state.agentCoreClientId;
  }
  const selected=selectedAgentCoreClient();
  if(!selected){
    if($("#agent-core-log-body"))$("#agent-core-log-body").innerHTML='<tr><td colspan="9">Nenhum cliente disponível.</td></tr>';
    return;
  }
  const config=selected.config||{};
  if($("#agent-core-enabled"))$("#agent-core-enabled").checked=config.enabled!==false;
  if($("#agent-core-auto-publish"))$("#agent-core-auto-publish").checked=config.autoPublish===true;
  if($("#agent-core-require-approval"))$("#agent-core-require-approval").checked=config.approvalRequired!==false;
  if($("#agent-core-cycle-minutes"))$("#agent-core-cycle-minutes").value=Number(config.cycleMinutes||60);
  const clientState=$("#agent-core-client-state");
  if(clientState){clientState.textContent=config.enabled!==false?"ATIVO":"PAUSADO";clientState.classList.toggle("off",config.enabled===false);}
  syncAgentCoreApprovalUi();

  const moduleRoot=$("#agent-core-module-toggles");
  const moduleDefs=Array.isArray(data.modules)?data.modules:[];
  if(moduleRoot)moduleRoot.innerHTML=moduleDefs.map(module=>`
    <label><input type="checkbox" data-agent-core-module="${escapeHtml(module.id)}" ${config.modules?.[module.id]!==false?"checked":""}> <strong>${escapeHtml(module.name)}</strong></label>
  `).join("");

  const live=$("#agent-core-live-state");
  const moduleState=selected.state?.modules||{};
  if(live)live.innerHTML=moduleDefs.map(module=>{
    const item=moduleState[module.id]||{};
    const [label,cls]=item.lastExecutionAt?agentCoreStatusMeta(item.status):["AGUARDANDO","running"];
    return `<div class="agent-core-live-row"><div><strong>${escapeHtml(module.name)}</strong><small>${escapeHtml(item.message||"Ainda sem execução registrada.")}</small></div><div><span class="post-status ${cls}">${label}</span><small>${item.lastExecutionAt?formatPostDate(item.lastExecutionAt):"—"}</small></div></div>`;
  }).join("");

  const rows=Array.isArray(selected.lastExecutions)?[...selected.lastExecutions]:[];
  const body=$("#agent-core-log-body");
  if(body)body.innerHTML=rows.length?rows.map(row=>{
    const [label,cls]=agentCoreStatusMeta(row.status);
    return `<tr>
      <td>${formatPostDate(row.finishedAt||row.startedAt)}</td>
      <td><strong>${escapeHtml(row.clientName||selected.clientName||selected.clientId)}</strong></td>
      <td><strong>${escapeHtml(row.agent||"—")}</strong></td>
      <td>${escapeHtml(row.function||"—")}</td>
      <td><span class="post-status ${cls}">${label}</span></td>
      <td>${escapeHtml(row.model||"—")}</td>
      <td>${Number(row.quantity||0)}</td>
      <td><strong>${moneyPost(row.costUsd)}</strong></td>
      <td class="post-detail">${escapeHtml(row.message||"—")}</td>
    </tr>`;
  }).join(""):'<tr><td colspan="9">Nenhuma execução registrada para este cliente.</td></tr>';
}
async function loadAgentCore(){
  try{
    state.agentCore=await api("/api/master/agent-core");
    renderAgentCore();
  }catch(error){console.error(error);}
}
async function saveAgentCoreConfig(){
  const selected=selectedAgentCoreClient();if(!selected)return;
  const message=$("#agent-core-message");
  if(message)message.textContent="Salvando…";
  const modules={};
  $("[data-agent-core-module]").forEach(input=>{modules[input.dataset.agentCoreModule]=input.checked;});
  const autoPublish=Boolean($("#agent-core-auto-publish")?.checked);
  const approvalRequired=autoPublish?Boolean($("#agent-core-require-approval")?.checked):true;
  const cycleMinutes=Math.max(15,Math.min(1440,Number($("#agent-core-cycle-minutes")?.value||60)));
  try{
    await api("/api/master/agent-core/"+encodeURIComponent(selected.clientId),{
      method:"PATCH",
      body:JSON.stringify({
        enabled:Boolean($("#agent-core-enabled")?.checked),
        autoPublish,
        approvalRequired,
        cycleMinutes,
        modules
      })
    });
    if(message)message.textContent="Configuração salva.";
    await loadAgentCore();
  }catch(error){if(message)message.textContent="Não foi possível salvar.";}
}
async function runAgentCore(agent="all",button=null){
  const selected=selectedAgentCoreClient();if(!selected)return;
  const message=$("#agent-core-message");
  const original=button?.textContent||"";
  if(button){button.disabled=true;button.textContent="Executando…";}
  if(message)message.textContent=agent==="all"?"Executando ciclo completo…":"Executando "+agent.toUpperCase()+"…";
  try{
    await api("/api/master/agent-core/"+encodeURIComponent(selected.clientId)+"/run",{
      method:"POST",body:JSON.stringify({agent})
    });
    if(message)message.textContent="Execução concluída e registrada.";
    await loadAgentCore();
    await loadPostLedger();
  }catch(error){if(message)message.textContent="Falha na execução: "+error.message;}
  finally{if(button){button.disabled=false;button.textContent=original;}}
}

function showView(id) {
  $$(".view").forEach(view => view.classList.toggle("active", view.id === id));
  $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.view === id));
  const titles = { dashboard: "Visão geral", clients: "Clientes", agents: "Agent Core", posts: "Postagens & custos", notifications: "Notificações", portal: "Portal do cliente", odin: "Odin & Leads", onboarding: "Novo cliente", settings: "Integrações" };
  $("#page-title").textContent = titles[id] || "NEXUS AI";
}

async function load() {
  try {
    const [clients, support, posts, leads, agentCore] = await Promise.all([api("/api/clients"), api("/api/master/support"), api("/api/master/posts"), api("/api/master/leads"), api("/api/master/agent-core")]);
    state.clients = clients;
    state.supportTickets = support.tickets || [];
    state.postLedger = posts || state.postLedger;
    state.leadData = leads || state.leadData;
    state.agentCore = agentCore || state.agentCore;
    render();
    renderSupportNotifications(support);
    renderPostLedger();
    renderMasterLeads();
    renderAgentCore();
  } catch (error) { console.error(error); }
}

function formatSupportDate(value) {
  try { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
  catch { return "—"; }
}

function renderSupportNotifications(summary = null) {
  const tickets = state.supportTickets || [];
  const unread = summary?.unreadCount ?? tickets.filter(item => item.status === "new").length;
  const open = summary?.openCount ?? tickets.filter(item => item.status !== "resolved").length;
  const counter = $("#notification-count");
  if (counter) { counter.textContent = unread; counter.hidden = unread <= 0; }
  if ($("#support-new-count")) $("#support-new-count").textContent = unread;
  if ($("#support-open-count")) $("#support-open-count").textContent = open;

  const list = $("#support-notifications");
  if (!list) return;
  const filtered = state.supportFilter === "all" ? tickets : tickets.filter(item => item.status === state.supportFilter);
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-support"><strong>Nenhum chamado aqui</strong><span>Quando um cliente abrir suporte pelo NEXUS, a notificação aparecerá nesta tela.</span></div>';
    return;
  }
  list.innerHTML = filtered.map(ticket => {
    const statusLabel = ticket.status === "new" ? "NOVO" : ticket.status === "read" ? "LIDO" : "RESOLVIDO";
    return `<article class="support-ticket ${ticket.status}">
      <div class="support-ticket-head">
        <div><span class="support-category">${escapeHtml(ticket.category || "Suporte")}</span><h3>${escapeHtml(ticket.subject)}</h3><small>${escapeHtml(ticket.clientName)} · ${formatSupportDate(ticket.createdAt)}</small></div>
        ${badge(statusLabel, ticket.status !== "resolved")}
      </div>
      <p>${escapeHtml(ticket.message)}</p>
      <div class="support-ticket-actions">
        ${ticket.status === "new" ? `<button type="button" class="ghost" data-ticket-status="read" data-ticket-id="${ticket.id}">Marcar como lido</button>` : ""}
        ${ticket.status !== "resolved" ? `<button type="button" class="primary" data-ticket-status="resolved" data-ticket-id="${ticket.id}">Resolver chamado</button>` : ""}
      </div>
    </article>`;
  }).join("");
}

async function updateSupportTicket(ticketId, status) {
  await api("/api/master/support/" + encodeURIComponent(ticketId), { method: "PATCH", body: JSON.stringify({ status }) });
  const support = await api("/api/master/support");
  state.supportTickets = support.tickets || [];
  renderSupportNotifications(support);
}

async function loadIntegrations() {
  try {
    const [status, openai, instagram] = await Promise.all([
      api("/api/system/status"),
      api("/api/master/openai"),
      api("/api/master/instagram")
    ]);

    const items = [
      {
        name: "GitHub Core",
        detail: status.githubConfigured
          ? "Repositório central conectado · deploy automático ativo"
          : "Conexão com o repositório indisponível",
        label: status.githubConfigured ? "CONECTADO" : "PENDENTE",
        ready: Boolean(status.githubConfigured)
      },
      {
        name: "Meta / Instagram",
        detail: instagram.configured ? "OAuth central pronto para os clientes" : "Falta configurar o App do Instagram uma única vez",
        label: instagram.configured ? "CONECTADO" : "PENDENTE",
        ready: Boolean(instagram.configured)
      }
    ];
    $("#integration-list").innerHTML = items.map(item => `<div class="integration"><div><strong>${item.name}</strong><small>${item.detail}</small></div>${badge(item.label, item.ready)}</div>`).join("");

    const openaiState = $("#openai-master-state");
    if (openaiState) {
      openaiState.textContent = openai.apiConnected
        ? "CENTRAL ATIVA"
        : "NÃO CONECTADA";
      openaiState.classList.toggle("off", !openai.connected);
    }
    const tokens = value => Number(value || 0).toLocaleString("pt-BR");
    $("#openai-balance").textContent = tokens(openai.nexusTodayTokens);
    $("#openai-month-cost").textContent = tokens(openai.nexusMonthTokens);
    $("#openai-month-budget").textContent = tokens(openai.ragnarTodayTokens);
    $("#openai-budget-remaining").textContent = tokens(openai.ragnarMonthTokens);
    $("#openai-balance-note").textContent = "tokens NEXUS usados hoje";
    const budgetNote = $("#openai-budget-note");
    if (budgetNote) budgetNote.textContent = "tokens Ragnar usados no mês";
    const igState=$("#instagram-master-state");
    if(igState){
      igState.textContent=instagram.configured?"CONFIGURADO":"NÃO CONFIGURADO";
      igState.classList.toggle("off",!instagram.configured);
    }
    if($("#instagram-app-id"))$("#instagram-app-id").value=instagram.appId||"";
    if($("#instagram-callback-url"))$("#instagram-callback-url").value=instagram.callbackUrl||"";
  } catch (error) {
    console.error(error);
  }
}

$$('[data-view]').forEach(button => button.addEventListener("click", async () => {
  showView(button.dataset.view);
  if (button.dataset.view === "settings") loadIntegrations();
  if (button.dataset.view === "agents") loadAgentCore();
  if (button.dataset.view === "posts") loadPostLedger();
  if (button.dataset.view === "odin") loadMasterLeads();
  if (button.dataset.view === "notifications") {
    try {
      const support = await api("/api/master/support");
      state.supportTickets = support.tickets || [];
      renderSupportNotifications(support);
    } catch {}
  }
}));
$$('[data-go]').forEach(button => button.addEventListener("click", () => showView(button.dataset.go)));
$("#refresh").addEventListener("click", load);
$("#portal-client").addEventListener("change", event => { state.portalClientId = event.target.value; renderPortalSelector(); });
const masterLeadFilter=$("#master-lead-client-filter");if(masterLeadFilter)masterLeadFilter.addEventListener("change",event=>{state.leadClientFilter=event.target.value||"";renderMasterLeads();});
const assumeSelected=$("#assume-selected-client");if(assumeSelected)assumeSelected.addEventListener("click",()=>{if(state.portalClientId)assumeClient(state.portalClientId);});
const portalAccessDialog=$("#portal-access-dialog");
const portalAccessForm=$("#portal-access-form");
const closePortalAccess=()=>{if(portalAccessDialog?.open)portalAccessDialog.close();};
$("#portal-access-close")?.addEventListener("click",closePortalAccess);
$("#portal-access-cancel")?.addEventListener("click",closePortalAccess);
portalAccessForm?.addEventListener("submit",async event=>{
  event.preventDefault();
  const clientId=$("#portal-access-client-id")?.value||"";
  const username=$("#portal-access-username")?.value?.trim()||"";
  const password=$("#portal-access-password")?.value||"";
  const status=$("#portal-access-status");
  if(status)status.textContent="Salvando…";
  try{
    await api("/api/migration/portal-user",{method:"POST",body:JSON.stringify({clientId,username,password})});
    if(status)status.textContent="Acesso salvo.";
    setTimeout(()=>closePortalAccess(),500);
  }catch(error){
    if(status)status.textContent=error.message||"Não foi possível salvar o acesso.";
  }
});
const postClientFilter = $("#post-client-filter");
if (postClientFilter) postClientFilter.addEventListener("change", event => {
  state.postClientFilter = event.target.value || "";
  renderPostLedger();
});
const agentCoreClient=$("#agent-core-client");
if(agentCoreClient)agentCoreClient.addEventListener("change",event=>{state.agentCoreClientId=event.target.value||"";renderAgentCore();});
const agentCoreAuto=$("#agent-core-auto-publish");
if(agentCoreAuto)agentCoreAuto.addEventListener("change",syncAgentCoreApprovalUi);
const agentCoreSave=$("#agent-core-save");
if(agentCoreSave)agentCoreSave.addEventListener("click",saveAgentCoreConfig);
const agentCoreRunAll=$("#agent-core-run-all");
if(agentCoreRunAll)agentCoreRunAll.addEventListener("click",()=>runAgentCore("all",agentCoreRunAll));
const agentCoreRefresh=$("#agent-core-refresh");
if(agentCoreRefresh)agentCoreRefresh.addEventListener("click",loadAgentCore);

$("#client-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  if (!String(data.password || "").trim()) {
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    const suffix = Array.from(bytes, value => value.toString(36).padStart(2, "0")).join("").slice(0, 14);
    data.password = "Nx!" + suffix;
  }
  $("#form-status").textContent = "Salvando…";
  try {
    const result = await api("/api/clients", { method: "POST", body: JSON.stringify(data) });
    form.reset();
    $("#form-status").textContent = "Cliente criado. Envie somente o acesso abaixo.";
    const access = result.portalCredentials || {};
    $("#new-client-user").textContent = "Usuário: " + (access.username || "—");
    $("#new-client-password").textContent = "Senha: " + (access.initialPassword || "—");
    $("#new-client-access").dataset.access = "NEXUS AI\nAcesso: " + location.origin + "/\nUsuário: " + (access.username || "") + "\nSenha: " + (access.initialPassword || "");
    $("#new-client-access").hidden = false;
    state.portalClientId = result.client?.id || state.portalClientId;
    await load();
  }
  catch (error) { $("#form-status").textContent = error.message; }
});
$("select[name=theme]").addEventListener("change", event => {
  const colors = { "green-black": ["#31e676", "#031d0c"], "red-black": ["#ff4b55", "#200306"], "blue-white": ["#3d9bff", "#10253c"], "gold-black": ["#e9bd52", "#211804"] };
  const [accent, base] = colors[event.target.value];
  $("#theme-preview").style.background = `radial-gradient(circle at 80% 20%, ${accent}55, transparent 28%), linear-gradient(135deg, #101512, ${base})`;
  $("#theme-preview").style.borderColor = accent;
});

document.addEventListener("click", async event => {
  const runAgentButton=event.target.closest("[data-run-agent]");
  if(runAgentButton){await runAgentCore(runAgentButton.dataset.runAgent||"all",runAgentButton);return;}
  const assumeButton=event.target.closest("[data-assume-client]");if(assumeButton){assumeClient(assumeButton.dataset.assumeClient);return;}
  const accessButton=event.target.closest("[data-portal-access]");
  if(accessButton){
    const clientId=accessButton.dataset.portalAccess||"";
    const clientName=accessButton.dataset.clientName||clientId;
    $("#portal-access-client-id").value=clientId;
    $("#portal-access-title").textContent="Acesso de "+clientName;
    $("#portal-access-username").value=clientId==="ragnar-one"?"ragnar.one":clientId.replace(/-/g,".");
    $("#portal-access-password").value="";
    $("#portal-access-status").textContent="";
    portalAccessDialog?.showModal();
    return;
  }
  const deleteButton = event.target.closest("[data-delete-client]");
  if (deleteButton) {
    const clientId = deleteButton.dataset.deleteClient;
    const clientName = deleteButton.dataset.clientName || clientId;
    if (!window.confirm('Excluir "' + clientName + '"?\n\nIsso remove acesso, configurações e chamados. Esta ação não pode ser desfeita.')) return;
    deleteButton.disabled = true;
    deleteButton.textContent = "Excluindo…";
    try {
      await api("/api/clients/" + encodeURIComponent(clientId), { method: "DELETE" });
      if (state.portalClientId === clientId) state.portalClientId = null;
      await load();
    } catch (error) {
      alert(error.message === "Erro 409" ? "O cliente piloto Ragnar está protegido contra exclusão acidental." : "Não foi possível excluir o cliente.");
      deleteButton.disabled = false;
      deleteButton.textContent = "Excluir";
    }
    return;
  }

  const ticketButton = event.target.closest("[data-ticket-status]");
  if (ticketButton) {
    ticketButton.disabled = true;
    try { await updateSupportTicket(ticketButton.dataset.ticketId, ticketButton.dataset.ticketStatus); }
    catch { alert("Não foi possível atualizar o chamado."); }
    return;
  }

  const masterProfileSave = event.target.closest("[data-master-profile-save]");
  if (masterProfileSave) {
    const card = masterProfileSave.closest("[data-master-profile]");
    const clientId = card?.dataset.masterProfile;
    const message = card?.querySelector("[data-master-profile-message]");
    const fields = {};
    card?.querySelectorAll("[data-master-field]").forEach(input => { fields[input.dataset.masterField] = input.value; });
    const postTimes = [...(card?.querySelectorAll("[data-master-time]") || [])].map(input=>input.value).filter(Boolean);
    masterProfileSave.disabled = true;
    if (message) message.textContent = "Salvando configuração…";
    try {
      await api("/api/master/agent-config/" + encodeURIComponent(clientId), {
        method: "PATCH",
        body: JSON.stringify({ postTimes, postingProfile: fields })
      });
      state.clients = await api("/api/clients");
      render();
      const updated = $("#master-agent-profiles")?.querySelector('[data-master-profile="' + CSS.escape(clientId) + '"] [data-master-profile-message]');
      if (updated) updated.textContent = "Agente configurado com sucesso.";
    } catch {
      if (message) message.textContent = "Não foi possível salvar.";
      masterProfileSave.disabled = false;
    }
    return;
  }

  const filterButton = event.target.closest("[data-support-filter]");
  if (filterButton) {
    state.supportFilter = filterButton.dataset.supportFilter || "all";
    $("[data-support-filter]").forEach(btn => btn.classList.toggle("active", btn === filterButton));
    renderSupportNotifications();
  }
});

const instagramMasterForm=$("#instagram-master-form");
if(instagramMasterForm)instagramMasterForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const message=$("#instagram-master-message");
  if(message)message.textContent="Salvando…";
  const data=Object.fromEntries(new FormData(form));
  try{
    const result=await api("/api/master/instagram",{method:"POST",body:JSON.stringify(data)});
    form.querySelector('input[name="appSecret"]').value="";
    if(message)message.textContent="Instagram NEXUS configurado.";
    if($("#instagram-master-state")){$("#instagram-master-state").textContent="CONFIGURADO";$("#instagram-master-state").classList.remove("off");}
    if($("#instagram-callback-url"))$("#instagram-callback-url").value=result.callbackUrl||"";
    await loadIntegrations();
  }catch(error){
    if(message)message.textContent="Não foi possível salvar a integração.";
  }
});

const openaiMasterForm=$("#openai-master-form");
if(openaiMasterForm)openaiMasterForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const message=$("#openai-master-message");
  if(message)message.textContent="Validando e salvando…";
  const data=Object.fromEntries(new FormData(form));
  try{
    await api("/api/master/openai",{method:"POST",body:JSON.stringify(data)});
    if(message)message.textContent="Controle financeiro OpenAI NEXUS atualizado.";
    await loadIntegrations();
  }catch(error){
    if(message)message.textContent="Não foi possível conectar: "+error.message;
  }
});

load();
setInterval(async()=>{
  try{
    const support=await api("/api/master/support");
    state.supportTickets=support.tickets||[];
    renderSupportNotifications(support);
  }catch{}
},20000);

const copyAccessButton=$("#copy-client-access");
if(copyAccessButton)copyAccessButton.addEventListener("click",async()=>{
  const card=$("#new-client-access");
  const text=card?.dataset.access||"";
  if(!text)return;
  try{await navigator.clipboard.writeText(text);copyAccessButton.textContent="Acesso copiado";setTimeout(()=>copyAccessButton.textContent="Copiar acesso",1500);}
  catch{alert(text);}
});
