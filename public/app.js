const state = { clients: [], auth: sessionStorage.getItem("nexus-auth"), portalClientId: null };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (state.auth) headers.authorization = state.auth;
  return fetch(path, { ...options, headers }).then(async response => {
    if (response.status === 401) {
      const username = prompt("Usuário administrativo da NEXUS AI:");
      if (username === null) throw new Error("Autenticação cancelada");
      const password = prompt("Senha administrativa:");
      if (password === null) throw new Error("Autenticação cancelada");
      state.auth = `Basic ${btoa(`${username}:${password}`)}`;
      sessionStorage.setItem("nexus-auth", state.auth);
      return api(path, options);
    }
    if (!response.ok) throw new Error(`Erro ${response.status}`);
    return response.json();
  });
}

function badge(value, online = true) { return `<span class="badge ${online ? "" : "off"}">${value}</span>`; }
function initials(name) { return name.split(/\s+/).map(word => word[0]).join("").slice(0, 2).toUpperCase(); }

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

  $("#usage-list").innerHTML = clients.length ? clients.map(client => `<div class="usage-row"><div><span>${escapeHtml(client.name)} · OpenAI</span><strong>${client.usage?.openaiPercent || 0}%</strong></div><div class="bar"><i style="width:${Math.min(client.usage?.openaiPercent || 0, 100)}%"></i></div><div><span>${escapeHtml(client.name)} · Railway</span><strong>${client.usage?.railwayPercent || 0}%</strong></div><div class="bar"><i style="width:${Math.min(client.usage?.railwayPercent || 0, 100)}%"></i></div></div>`).join("") : `<p class="muted">Sem dados de consumo.</p>`;

  $("#clients-table").innerHTML = clients.map(client => `<tr><td><strong>${escapeHtml(client.name)}</strong><br><small>${escapeHtml(client.niche || "Outro")}</small></td><td>${badge(client.status === "online" ? "ONLINE" : "SETUP", client.status === "online")}</td><td>${escapeHtml(client.instagram || "—")}</td><td>${client.odin ? badge("ATIVO") : badge("DESLIGADO", false)}</td><td>${(client.postTimes || []).join(" · ") || "—"}</td><td>GitHub: ${escapeHtml(client.github || "pendente")}<br>Railway: ${escapeHtml(client.railway || "pendente")}</td></tr>`).join("");
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
  $("#portal-usage").innerHTML = [["OpenAI", client.usage?.openaiPercent || 0], ["Railway", client.usage?.railwayPercent || 0]].map(([label, value]) => `<div class="usage-row"><div><span>${label}</span><strong>${value}%</strong></div><div class="bar"><i style="width:${Math.min(value, 100)}%"></i></div></div>`).join("");
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
    const status = await api("/api/system/status");
    const items = [["GitHub OAuth", status.githubConfigured], ["Railway API", status.railwayConfigured], ["OpenAI Admin", status.openaiAdminConfigured], ["Meta", false]];
    $("#integration-list").innerHTML = items.map(([name, ready]) => `<div class="integration"><div><strong>${name}</strong><small>${name === "Meta" ? "Configuração assistida" : "Variáveis de ambiente"}</small></div>${badge(ready ? "CONFIGURADO" : "PENDENTE", ready)}</div>`).join("");
  } catch (error) { console.error(error); }
}

$$('[data-view]').forEach(button => button.addEventListener("click", () => { showView(button.dataset.view); if (button.dataset.view === "settings") loadIntegrations(); }));
$$('[data-go]').forEach(button => button.addEventListener("click", () => showView(button.dataset.go)));
$("#refresh").addEventListener("click", load);
$("#portal-client").addEventListener("change", event => { state.portalClientId = event.target.value; renderPortalSelector(); });
$("#client-form").addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  $("#form-status").textContent = "Salvando…";
  try { await api("/api/clients", { method: "POST", body: JSON.stringify(data) }); event.currentTarget.reset(); $("#form-status").textContent = "Cliente criado."; await load(); showView("clients"); }
  catch (error) { $("#form-status").textContent = error.message; }
});
$("select[name=theme]").addEventListener("change", event => {
  const colors = { "green-black": ["#31e676", "#031d0c"], "red-black": ["#ff4b55", "#200306"], "blue-white": ["#3d9bff", "#10253c"], "gold-black": ["#e9bd52", "#211804"] };
  const [accent, base] = colors[event.target.value];
  $("#theme-preview").style.background = `radial-gradient(circle at 80% 20%, ${accent}55, transparent 28%), linear-gradient(135deg, #101512, ${base})`;
  $("#theme-preview").style.borderColor = accent;
});

load();
