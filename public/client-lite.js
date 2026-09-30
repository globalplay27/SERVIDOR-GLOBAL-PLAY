const $ = selector => document.querySelector(selector);
const formatNumber = value => new Intl.NumberFormat("pt-BR").format(Number(value || 0));
const formatDate = value => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(date)
    : "—";
};
let client = null;
let posts = [];
let activeTab = "overview";

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    showLogin("Sua sessão terminou. Entre novamente.");
    throw new Error("Sessão expirada");
  }
  if (!response.ok) throw new Error(data.message || data.error || "Não foi possível consultar o NEXUS.");
  return data;
}

function notice(message) {
  const element = $("#notice");
  element.textContent = message;
  element.hidden = !message;
}

function showLogin(message = "") {
  $("#dashboard").hidden = true;
  $("#login").hidden = false;
  $("#login-error").textContent = message;
}

function showDashboard(data) {
  client = data;
  $("#login").hidden = true;
  $("#dashboard").hidden = false;
  $("#client-label").textContent = data.name || "Cliente";
  $("#client-name").textContent = data.name || "Seu painel";
  $("#next-post").textContent = "Automática pelo NEXUS";
}

function showTab(name) {
  activeTab = name;
  document.querySelectorAll("[data-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === name);
  });
  document.querySelectorAll(".tab").forEach(section => {
    section.hidden = section.id !== "tab-" + name;
  });
  if (name === "posts") loadPosts();
  if (name === "agents") loadAgents();
  if (name === "performance") loadPerformance();
  if (name === "instagram") loadInstagram();
}

function postStatus(post) {
  const status = String(post.status || "scheduled");
  const approval = String(post.approvalStatus || "pending");
  if (status === "published") return ["Publicada", "published"];
  if (status === "failed") return ["Falhou", "failed"];
  if (status === "publishing") return ["Publicando", "ready"];
  if (approval === "pending") return ["Aguardando aprovação", "ready"];
  if (approval === "rejected" || approval === "correction_requested") return ["Precisa de revisão", "failed"];
  return ["Programada", "ready"];
}

function safeInstagramLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && ["instagram.com", "www.instagram.com"].includes(url.hostname)) return url.href;
  } catch {}
  return "";
}

function renderPosts() {
  const list = $("#post-list");
  list.replaceChildren();
  $("#published-count").textContent = formatNumber(posts.filter(post => post.status === "published").length);
  $("#attention-count").textContent = formatNumber(posts.filter(post =>
    post.status === "failed" || ["pending", "rejected", "correction_requested"].includes(post.approvalStatus)
  ).length);
  const latest = posts.find(post => post.status === "published") || posts[0];
  $("#last-activity").textContent = latest
    ? postStatus(latest)[0] + " · " + formatDate(latest.publishedAt || latest.updatedAt || latest.scheduledFor)
    : "Nenhuma publicação registrada ainda.";
  if (!posts.length) {
    const empty = document.createElement("div"); empty.className = "card muted";
    empty.textContent = "Nenhuma postagem registrada ainda."; list.append(empty); return;
  }
  for (const post of posts) {
    const card = document.createElement("article"); card.className = "card post";
    const main = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = post.title || (post.caption || "Publicação").split("\n")[0].slice(0, 90) || "Publicação";
    const when = document.createElement("small");
    when.textContent = "Programada: " + formatDate(post.scheduledFor) + (post.publishedAt ? " · Publicada: " + formatDate(post.publishedAt) : "");
    main.append(heading, document.createElement("br"), when);
    if (post.imageUrl || post.publicImageUrl) {
      const preview = document.createElement("img");
      preview.className = "post-preview";
      preview.src = post.imageUrl || post.publicImageUrl;
      preview.alt = "Prévia do criativo";
      preview.loading = "lazy";
      main.append(preview);
    }
    if (post.caption) { const caption = document.createElement("p"); caption.textContent = post.caption; main.append(caption); }
    if (post.revisionRequest) { const revision = document.createElement("p"); revision.className = "revision-note"; revision.textContent = "Ajuste solicitado: " + post.revisionRequest; main.append(revision); }
    if (post.error) { const error = document.createElement("p"); error.className = "error"; error.textContent = "Detalhe: " + post.error; main.append(error); }
    const permalink = safeInstagramLink(post.permalink);
    if (permalink) { const link = document.createElement("a"); link.href = permalink; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Ver no Instagram"; main.append(link); }

    if (post.status !== "published") {
      const actions = document.createElement("div"); actions.className = "post-actions";
      const approve = document.createElement("button"); approve.type = "button"; approve.className = "primary"; approve.textContent = "Aprovar";
      approve.addEventListener("click", () => decidePostAction(post.id, "approved", approve));
      const reject = document.createElement("button"); reject.type = "button"; reject.textContent = "Reprovar";
      reject.addEventListener("click", () => decidePostAction(post.id, "rejected", reject));
      const revise = document.createElement("button"); revise.type = "button"; revise.textContent = "Pedir ajuste";
      revise.addEventListener("click", () => requestRevisionAction(post.id, revise));
      actions.append(approve, reject, revise); main.append(actions);
    }

    const imageUrl = String(post.imageUrl || post.publicImageUrl || "");
    if (/^https:\/\//.test(imageUrl)) {
      const preview = document.createElement("img");
      preview.className = "post-preview";
      preview.src = imageUrl;
      preview.alt = "Prévia do criativo";
      preview.loading = "lazy";
      main.prepend(preview);
    }

    if (post.approvalStatus === "pending" || post.approvalStatus === "rejected" || post.approvalStatus === "correction_requested") {
      const actions = document.createElement("div");
      actions.className = "post-actions";

      const approve = document.createElement("button");
      approve.className = "primary";
      approve.type = "button";
      approve.textContent = "Aprovar";
      approve.addEventListener("click", () => decidePost(post.id, "approved", approve));

      const reject = document.createElement("button");
      reject.type = "button";
      reject.textContent = "Reprovar";
      reject.addEventListener("click", () => decidePost(post.id, "rejected", reject));

      const revise = document.createElement("button");
      revise.type = "button";
      revise.textContent = "Pedir ajuste";
      revise.addEventListener("click", () => requestRevision(post.id, revise));

      actions.append(approve, reject, revise);
      main.append(actions);
    }

    if (post.revisionRequest) {
      const revision = document.createElement("p");
      revision.className = "revision-note";
      revision.textContent = "Correção solicitada: " + post.revisionRequest;
      main.append(revision);
    }

    const badge = document.createElement("span"); const [label, kind] = postStatus(post);
    badge.className = "status " + kind; badge.textContent = label; card.append(main, badge); list.append(card);
  }
}

async function loadPosts() {
  try { posts = (await api("/api/portal/posts")).posts || []; renderPosts(); }
  catch (error) { notice("Postagens: " + error.message); }
}

async function decidePost(postId, decision, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = decision === "approved" ? "Aprovando..." : "Reprovando...";
  try {
    const data = await api("/api/portal/posts/" + encodeURIComponent(postId) + "/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision })
    });
    notice(data.message || (decision === "approved" ? "Postagem aprovada." : "Postagem reprovada."));
    await loadPosts();
  } catch (error) {
    notice("Postagem: " + error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function requestRevision(postId, button) {
  const instructions = window.prompt("Explique o que precisa ser corrigido neste criativo:");
  if (!instructions || !instructions.trim()) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Enviando...";
  try {
    const data = await api("/api/portal/posts/" + encodeURIComponent(postId) + "/revision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instructions: instructions.trim() })
    });
    notice(data.message || "Correção enviada ao NEXUS.");
    await loadPosts();
  } catch (error) {
    notice("Correção: " + error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function agentLabel(value) {
  return String(value || "Agente").replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

async function loadAgents() {
  try {
    const data = await api("/api/portal/agent-core");
    const modules = Array.isArray(data.modules) ? data.modules : [];
    const executions = Array.isArray(data.executions) ? data.executions : [];
    $("#agent-count").textContent = formatNumber(modules.length);
    $("#execution-count").textContent = formatNumber(executions.length);
    $("#agent-pending-count").textContent = formatNumber(data.pendingApproval);
    $("#agent-correction-count").textContent = formatNumber(data.correctionRequested);

    const root = $("#agent-list");
    root.replaceChildren();
    const latestByAgent = new Map();
    for (const execution of executions) {
      const key = String(execution.agent || "agent");
      if (!latestByAgent.has(key)) latestByAgent.set(key, execution);
    }

    const names = modules.length ? modules.map(item => typeof item === "string" ? item : (item.id || item.name || item.agent)).filter(Boolean) : [...latestByAgent.keys()];
    if (!names.length) {
      const empty = document.createElement("div");
      empty.className = "card muted";
      empty.textContent = "Nenhuma execução de agente registrada ainda.";
      root.append(empty);
      return;
    }

    for (const name of names) {
      const execution = latestByAgent.get(String(name)) || {};
      const card = document.createElement("article");
      card.className = "card agent-card";
      const title = document.createElement("strong");
      title.textContent = agentLabel(name);
      const status = document.createElement("span");
      const state = String(execution.status || "aguardando").toLowerCase();
      status.className = "status " + (state === "success" ? "published" : state === "failed" || state === "error" ? "failed" : "ready");
      status.textContent = state === "success" ? "Ativo" : state === "failed" || state === "error" ? "Falha" : "Aguardando";
      const detail = document.createElement("p");
      detail.className = "muted";
      detail.textContent = execution.summary || execution.detail || execution.message || "Sem atividade recente detalhada.";
      const when = document.createElement("small");
      when.textContent = execution.createdAt ? "Última execução: " + formatDate(execution.createdAt) : "Ainda sem execução registrada.";
      card.append(title, status, detail, when);
      root.append(card);
    }
  } catch (error) {
    notice("Agentes: " + error.message);
  }
}

async function decidePostAction(postId, decision, button) {
  button.disabled = true;
  try {
    const data = await api("/api/portal/posts/" + encodeURIComponent(postId) + "/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision })
    });
    notice(data.message || (decision === "approved" ? "Postagem aprovada." : "Postagem reprovada."));
    await loadPosts();
  } catch (error) {
    notice("Postagem: " + error.message);
  } finally {
    button.disabled = false;
  }
}

async function requestRevisionAction(postId, button) {
  const instructions = window.prompt("O que você quer que o agente corrija?");
  if (!instructions || !instructions.trim()) return;
  button.disabled = true;
  try {
    const data = await api("/api/portal/posts/" + encodeURIComponent(postId) + "/revision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instructions: instructions.trim() })
    });
    notice(data.message || "Correção enviada ao NEXUS.");
    await loadPosts();
    if (activeTab === "agents") await loadAgents();
  } catch (error) {
    notice("Correção: " + error.message);
  } finally {
    button.disabled = false;
  }
}

function agentLabel(item) {
  return String(item?.agent || item?.module || item?.name || item?.agentName || "Agente");
}

function executionTime(item) {
  return item?.finishedAt || item?.completedAt || item?.updatedAt || item?.createdAt || item?.startedAt || null;
}

async function loadAgents() {
  try {
    const data = await api("/api/portal/agent-core");
    const modules = Array.isArray(data.modules) ? data.modules : [];
    const executions = Array.isArray(data.executions) ? data.executions : [];
    $("#agent-count").textContent = formatNumber(modules.length);
    $("#execution-count").textContent = formatNumber(executions.length);
    $("#agent-pending-count").textContent = formatNumber(data.pendingApproval);
    $("#agent-correction-count").textContent = formatNumber(data.correctionRequested);
    const root = $("#agent-list"); root.replaceChildren();
    if (!executions.length) {
      const empty = document.createElement("div"); empty.className = "card muted";
      empty.textContent = "Nenhuma execução recente registrada para esta conta."; root.append(empty); return;
    }
    for (const item of executions.slice(0, 30)) {
      const row = document.createElement("article"); row.className = "card agent-row";
      const title = document.createElement("strong"); title.textContent = agentLabel(item);
      const detail = document.createElement("p");
      detail.textContent = String(item.summary || item.action || item.status || item.result || "Execução registrada");
      const time = document.createElement("small"); time.textContent = "Última atividade: " + formatDate(executionTime(item));
      row.append(title, detail, time); root.append(row);
    }
  } catch (error) {
    notice("Agentes: " + error.message);
  }
}

async function loadPerformance() {
  try {
    const data = await api("/api/portal/agent-core");
    const radar = data.state?.radar || {};
    const root = $("#top-media"); root.replaceChildren();
    const available = radar.source === "instagram-api" && Number.isFinite(Number(radar.followersCount));
    $("#followers").textContent = available ? formatNumber(radar.followersCount) : "—";
    $("#followers-delta").textContent = available ? String(Number(radar.followersDelta || 0) >= 0 ? "+" : "") + formatNumber(radar.followersDelta) : "—";
    $("#median-engagement").textContent = available ? formatNumber(radar.metrics?.medianEngagement) : "—";
    $("#scanned-media").textContent = available ? formatNumber(radar.scannedMedia) : "—";
    for (const item of (Array.isArray(radar.topMedia) ? radar.topMedia : []).slice(0, 5)) {
      const row = document.createElement("div"); row.className = "media-row";
      const title = document.createElement("strong"); title.textContent = item.caption || item.mediaType || "Publicação";
      const count = document.createElement("small"); count.textContent = formatNumber(item.engagement) + " interações (curtidas + 2 × comentários)";
      row.append(title, count);
      const linkUrl = safeInstagramLink(item.permalink);
      if (linkUrl) { const link = document.createElement("a"); link.href = linkUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = " Abrir publicação"; row.append(link); }
      root.append(row);
    }
    $("#performance-note").textContent = available
      ? "Dados da última coleta: " + formatDate(data.state?.lastCycleAt) + ". As interações não incluem visualizações."
      : "Aguardando uma coleta válida do Instagram. Nenhum resultado foi estimado.";
  } catch (error) { notice("Desempenho: " + error.message); }
}

async function loadInstagram() {
  try {
    const data = await api("/api/portal/connections");
    const connection = data.connections?.instagram || {};
    const connected = Boolean(connection.connected && !connection.expired);
    $("#overview-instagram").textContent = connected ? (connection.label || "Conectado") : "Não conectado";
    $("#instagram-handle").textContent = connected ? (connection.label || "Instagram conectado") : "Nenhuma conta conectada";
    $("#instagram-state").textContent = connected ? "Autorizado" : connection.expired ? "Autorização expirada" : "Aguardando autorização";
    $("#instagram-expires").textContent = formatDate(connection.expiresAt);
    $("#instagram-scopes").textContent = connected ? (connection.scopes?.length ? connection.scopes.join(" · ") : "Autorização registrada") : "—";
    $("#connect-instagram").textContent = connected ? "Reconectar / trocar conta" : "Conectar Instagram";
  } catch (error) { notice("Instagram: " + error.message); }
}

async function refresh() {
  notice("");
  const data = await api("/api/portal/session");
  showDashboard(data);
  await Promise.all([
    loadPosts(),
    loadInstagram(),
    activeTab === "performance" ? loadPerformance() : Promise.resolve(),
    activeTab === "agents" ? loadAgents() : Promise.resolve()
  ]);
}

$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget; const button = form.querySelector("button[type=submit]");
  button.disabled = true; $("#login-error").textContent = "";
  try {
    const username = form.elements.namedItem("username").value.trim();
    const password = form.elements.namedItem("password").value;
    const response = await fetch("/api/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 429 ? "Muitas tentativas. Aguarde alguns minutos." : "Usuário ou senha inválidos.");
    if (data.role === "master") { location.replace(data.entryPath || "/api/master/console"); return; }
    if (data.role !== "client") throw new Error("Acesso não identificado.");
    form.elements.namedItem("password").value = ""; await refresh();
  } catch (error) { $("#login-error").textContent = error.message; }
  finally { button.disabled = false; }
});

document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => showTab(button.dataset.tab)));
document.querySelectorAll("[data-refresh]").forEach(button => button.addEventListener("click", () => { const target = button.dataset.refresh; if (target === "posts") return loadPosts(); if (target === "agents") return loadAgents(); return loadPerformance(); }));
$("#refresh").addEventListener("click", () => refresh().catch(error => notice(error.message)));
$("#logout").addEventListener("click", async () => {
  await fetch("/api/portal/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  client = null; posts = []; showLogin("");
});

$("#connect-instagram").addEventListener("click", async () => {
  const button = $("#connect-instagram"); const message = $("#instagram-message");
  const popup = window.open("about:blank", "nexus-instagram-oauth", "width=620,height=760");
  if (!popup) { message.textContent = "Permita janelas pop-up para este site e tente novamente."; return; }
  button.disabled = true; message.textContent = "Preparando autorização...";
  try {
    const data = await api("/api/portal/instagram/start");
    if (!/^https:\/\/(www\.)?instagram\.com\//.test(data.url || "")) throw new Error("Endereço de autorização inválido.");
    popup.location.href = data.url;
    message.textContent = "Autorize na janela do Instagram. O status será atualizado aqui.";
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const connection = (await api("/api/portal/connections")).connections?.instagram;
      if (connection?.connected && !connection?.expired) {
        message.textContent = "Instagram autorizado."; await loadInstagram(); popup.close(); return;
      }
      if (popup.closed) break;
    }
    message.textContent = "Autorização não confirmada. Atualize o status ou tente novamente.";
    await loadInstagram();
  } catch (error) { popup.close(); message.textContent = error.message; }
  finally { button.disabled = false; }
});

const params = new URLSearchParams(location.search);
if (params.has("error")) showLogin("Não foi possível entrar. Confira usuário e senha.");
else refresh().catch(() => showLogin("Entre para acompanhar sua conta."));

// Remove registrations left by the retired installable panel.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations =>
    Promise.all(registrations.map(registration => registration.unregister()))
  ).catch(() => {});
}
