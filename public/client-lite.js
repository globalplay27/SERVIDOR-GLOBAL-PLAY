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
    if (post.caption) { const caption = document.createElement("p"); caption.textContent = post.caption; main.append(caption); }
    if (post.error) { const error = document.createElement("p"); error.className = "error"; error.textContent = "Detalhe: " + post.error; main.append(error); }
    const permalink = safeInstagramLink(post.permalink);
    if (permalink) { const link = document.createElement("a"); link.href = permalink; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Ver no Instagram"; main.append(link); }
    const badge = document.createElement("span"); const [label, kind] = postStatus(post);
    badge.className = "status " + kind; badge.textContent = label; card.append(main, badge); list.append(card);
  }
}

async function loadPosts() {
  try { posts = (await api("/api/portal/posts")).posts || []; renderPosts(); }
  catch (error) { notice("Postagens: " + error.message); }
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
  await Promise.all([loadPosts(), loadInstagram(), activeTab === "performance" ? loadPerformance() : Promise.resolve()]);
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
document.querySelectorAll("[data-refresh]").forEach(button => button.addEventListener("click", () => button.dataset.refresh === "posts" ? loadPosts() : loadPerformance()));
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
