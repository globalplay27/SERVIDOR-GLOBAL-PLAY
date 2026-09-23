const state = { clients: [], auth: sessionStorage.getItem("nexus-auth"), portalClientId: null };
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
  return mode === "hybrid" ? "HÍBRIDO" : mode === "own-key" ? "CHAVE PRÓPRIA" : "ECONÔMICO";
}

function render() {
  const clients = state.clients;
  const online = clients.filter(client => client.status === "online").length;
  const totals = clients.reduce((sum, client) => ({ total: sum.total + (client.leads?.total || 0), hot: sum.hot + (client.leads?.hot || 0), warm: sum.warm + (client.leads?.warm || 0) }), { total: 0, hot: 0, warm: 0 });
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
    const mode = client.aiMode || "economy";
    const used = Number(client.aiImagesUsed || 0);
    const limit = Number(client.aiMonthlyImageLimit || 0);
    const pct = mode === "hybrid" && limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 0;
    const detail = mode === "hybrid" ? `${used} / ${limit} imagens IA` : mode === "own-key" ? "custo na conta do cliente" : "sem imagem IA paga";
    return `<div class="usage-row"><div><span>${escapeHtml(client.name)} · ${aiModeLabel(mode)}</span><strong>${detail}</strong></div><div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }).join("") : `<p class="muted">Novos clientes aparecerão aqui. Ragnar não entra no consumo OpenAI central.</p>`;

  $("#clients-table").innerHTML = clients.map(client => {
    const ragnar = client.id === "ragnar-one";
    const mode = ragnar ? "Conta própria" : aiModeLabel(client.aiMode || "economy");
    const extra = !ragnar && client.aiMode === "hybrid" ? `<br><small>${Number(client.aiImagesUsed||0)} / ${Number(client.aiMonthlyImageLimit||0)} imagens IA</small>` : "";
    return `<tr><td><strong>${escapeHtml(client.name)}</strong><br><small>${escapeHtml(client.niche || "Outro")}</small></td><td>${badge(client.status === "online" ? "ONLINE" : "SETUP", client.status === "online")}</td><td>${escapeHtml(client.instagram || "—")}</td><td>${client.odin ? badge("ATIVO") : badge("DESLIGADO", false)}</td><td>${(client.postTimes || []).join(" · ") || "—"}</td><td><strong>${mode}</strong>${extra}</td></tr>`;
  }).join("");
  renderPortalSelector();
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
  const mode = ragnar ? "Conta OpenAI própria" : aiModeLabel(client.aiMode || "economy");
  const aiDetail = !ragnar && client.aiMode === "hybrid"
    ? `${Number(client.aiImagesUsed||0)} de ${Number(client.aiMonthlyImageLimit||0)} imagens IA usadas`
    : ragnar ? "isolada do NEXUS central" : client.aiMode === "own-key" ? "cobrança na conta do cliente" : "criativos econômicos sem imagem IA paga";
  $("#portal-usage").innerHTML = `<div class="usage-row"><div><span>Modo de IA</span><strong>${mode}</strong></div><small>${aiDetail}</small></div><div class="usage-row"><div><span>Infraestrutura</span><strong>Gerenciada pelo NEXUS</strong></div><small>GitHub e Railway não são exigidos do cliente.</small></div>`;
}

function escapeHtml(value) { const el = document.createElement("span"); el.textContent = String(value); return el.innerHTML; }

function showView(id) {
  $$(".view").forEach(view => view.classList.toggle("active", view.id === id));
  $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.view === id));
  const titles = { dashboard: "Visão geral", clients: "Clientes", portal: "Portal do cliente", odin: "Odin & Leads", onboarding: "Novo cliente", settings: "Integrações" };
  $("#page-title").textContent = titles[id] || "NEXUS AI";
}

async function load() {
  try { state.clients = await api("/api/clients"); render(); }
  catch (error) { console.error(error); }
}

async function loadIntegrations() {
  try {
    const [status, openai] = await Promise.all([
      api("/api/system/status"),
      api("/api/master/openai")
    ]);

    const items = [
      {
        name: "GitHub Core",
        detail: status.githubConfigured ? "Código central conectado" : "Configuração administrativa opcional",
        label: status.githubConfigured ? "CONECTADO" : "OPCIONAL",
        ready: Boolean(status.githubConfigured)
      },
      {
        name: "Railway Core",
        detail: status.railwayConfigured ? "Hospedagem central operacional" : "Integração pendente",
        label: status.railwayConfigured ? "CONECTADO" : "PENDENTE",
        ready: Boolean(status.railwayConfigured)
      },
      {
        name: "Meta / Instagram",
        detail: "Uma integração NEXUS; autorização individual de cada cliente",
        label: "EM PREPARAÇÃO",
        ready: true
      }
    ];
    $("#integration-list").innerHTML = items.map(item => `<div class="integration"><div><strong>${item.name}</strong><small>${item.detail}</small></div>${badge(item.label, item.ready)}</div>`).join("");

    const state = $("#openai-master-state");
    if (state) {
      state.textContent = openai.apiConnected && openai.billingConnected ? "CONECTADA" : openai.connected ? "PARCIAL" : "NÃO CONECTADA";
      state.classList.toggle("off", !openai.connected);
    }
    const money = value => Number.isFinite(Number(value)) ? "US$ " + Number(value).toFixed(2) : "—";
    $("#openai-balance").textContent = money(openai.balanceEstimatedUsd);
    $("#openai-month-cost").textContent = money(openai.monthCostUsd);
    $("#openai-spend-limit").textContent = money(openai.spendLimitUsd);
    $("#openai-balance-note").textContent = openai.balanceEstimatedUsd != null
      ? "estimativa automática desde o último saldo informado"
      : "informe o saldo atual uma vez";
  } catch (error) {
    console.error(error);
  }
}

$$('[data-view]').forEach(button => button.addEventListener("click", () => { showView(button.dataset.view); if (button.dataset.view === "settings") loadIntegrations(); }));
$$('[data-go]').forEach(button => button.addEventListener("click", () => showView(button.dataset.go)));
$("#refresh").addEventListener("click", load);
$("#portal-client").addEventListener("change", event => { state.portalClientId = event.target.value; renderPortalSelector(); });
const aiModeSelect=$("#ai-mode"),aiLimitWrap=$("#ai-limit-wrap"),aiLimit=$("#ai-limit");
function syncAiModeFields(){
  if(!aiModeSelect)return;
  const hybrid=aiModeSelect.value==="hybrid";
  if(aiLimitWrap)aiLimitWrap.hidden=!hybrid;
  if(aiLimit)aiLimit.required=hybrid;
}
if(aiModeSelect){aiModeSelect.addEventListener("change",syncAiModeFields);syncAiModeFields();}

$("#client-form").addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  $("#form-status").textContent = "Salvando…";
  try {
    const result = await api("/api/clients", { method: "POST", body: JSON.stringify(data) });
    event.currentTarget.reset();
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

const openaiMasterForm=$("#openai-master-form");
if(openaiMasterForm)openaiMasterForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const message=$("#openai-master-message");
  if(message)message.textContent="Validando e salvando…";
  const data=Object.fromEntries(new FormData(event.currentTarget));
  try{
    await api("/api/master/openai",{method:"POST",body:JSON.stringify(data)});
    event.currentTarget.reset();
    if(message)message.textContent="OpenAI NEXUS atualizada com segurança.";
    await loadIntegrations();
  }catch(error){
    if(message)message.textContent="Não foi possível conectar: "+error.message;
  }
});

load();

const copyAccessButton=$("#copy-client-access");
if(copyAccessButton)copyAccessButton.addEventListener("click",async()=>{
  const card=$("#new-client-access");
  const text=card?.dataset.access||"";
  if(!text)return;
  try{await navigator.clipboard.writeText(text);copyAccessButton.textContent="Acesso copiado";setTimeout(()=>copyAccessButton.textContent="Copiar acesso",1500);}
  catch{alert(text);}
});
