const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);
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
let activeTab = "videos";
const MAX_VIDEO_UPLOAD_BYTES = 90 * 1024 * 1024;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
  const data = await response.json().catch(() => null);
  if (response.status === 401) {
    showLogin("Sua sessão terminou. Entre novamente.");
    throw new Error("Sessão expirada");
  }
  if (!response.ok) throw new Error(data?.message || data?.error || "Não foi possível consultar o NEXUS.");
  if (!data || typeof data !== "object" || data.ok === false) throw new Error(data?.message || data?.error || "A API não retornou dados válidos. Atualize e tente novamente.");
  return data;
}

function notice(message) {
  const element = $("#notice");
  if (!element) return;
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
  const rawInstagram = String(data.instagram || "").trim();
  const instagramHandle = rawInstagram
    ? (rawInstagram.startsWith("@") ? rawInstagram : "@" + rawInstagram.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/$/, ""))
    : "";
  const accountLabel = instagramHandle || data.name || "Cliente";
  $("#client-label").textContent = accountLabel;
  $("#client-label").title = "Conta: " + data.id;
  $("#header-client-name").textContent = accountLabel;
  const logoKey = String(data.branding?.logoKey || "");
  const logo = $("#client-logo");
  if (logo && logoKey) {
    logo.src = "/media/" + logoKey;
    logo.hidden = false;
  } else if (logo) {
    logo.hidden = true;
    logo.removeAttribute("src");
  }
  if ($("#profile-name")) $("#profile-name").value = data.contact?.name || data.name || "";
  if ($("#profile-phone")) $("#profile-phone").value = data.contact?.phone || "";
  if ($("#video-whatsapp-number")) $("#video-whatsapp-number").value = data.videoTemplate?.whatsappNumber || "";
  if ($("#profile-instagram")) $("#profile-instagram").value = instagramHandle || "";
  if ($("#next-post")) $("#next-post").textContent = "Automática pelo NEXUS";
}

function showTab(name) {
  activeTab = name;
  document.querySelectorAll("[data-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === name);
  });
  document.querySelectorAll(".tab").forEach(section => {
    section.hidden = section.id !== "tab-" + name;
  });
  if (name === "videos") loadVideoJobs();
  if (name === "instagram") loadInstagram();
}

/* TRAILER SEARCH */
let trailerSearchTimer = null;
async function searchTrailers(event) {
  event.preventDefault();
  const query = $("#trailer-query")?.value.trim();
  const type = $("#trailer-type")?.value || "movie";
  const btn = $("#trailer-search-btn");
  const msg = $("#trailer-search-message");
  const resultsBox = $("#trailer-results");
  const list = $("#trailer-results-list");
  if (!query) { if (msg) msg.textContent = "Digite o nome do filme ou série."; return; }
  if (btn) { btn.disabled = true; btn.textContent = "Buscando..."; }
  if (msg) msg.textContent = "Procurando trailers oficiais dublados...";
  if (resultsBox) resultsBox.hidden = true;
  if (list) list.replaceChildren();
  if (trailerSearchTimer) clearTimeout(trailerSearchTimer);
  try {
    const data = await api("/api/portal/videos/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, type })
    });
    const searchId = data.searchId;
    if (msg) msg.textContent = "Buscando no YouTube... aguarde alguns segundos.";
    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        const status = await api("/api/portal/videos/search/" + encodeURIComponent(searchId));
        if (status.status === "searching" && attempts < 14) {
          trailerSearchTimer = setTimeout(poll, 2500);
          return;
        }
        const results = Array.isArray(status.results) ? status.results : [];
        if (!results.length) {
          if (msg) msg.textContent = "Nenhum trailer oficial dublado encontrado. Tente outro nome.";
          if (btn) { btn.disabled = false; btn.textContent = "Buscar no YouTube"; }
          return;
        }
        results.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
        if (list) list.replaceChildren();
        for (const item of results.slice(0, 12)) {
          const card = document.createElement("article");
          card.className = "card";
          const title = document.createElement("strong");
          title.textContent = item.title || "Trailer";
          const meta = document.createElement("small");
          const mins = item.duration ? Math.round(Number(item.duration) / 60) + " min" : "";
          meta.textContent = [item.channel || "Canal", mins].filter(Boolean).join(" · ");
          const actions = document.createElement("div");
          actions.className = "post-actions";
          const useBtn = document.createElement("button");
          useBtn.type = "button";
          useBtn.className = "primary";
          useBtn.textContent = "Usar este trailer";
          useBtn.addEventListener("click", () => startTrailerJob(item, type, useBtn));
          actions.append(useBtn);
          card.append(title, meta, actions);
          if (list) list.append(card);
        }
        if (resultsBox) resultsBox.hidden = false;
        if (msg) msg.textContent = results.length + " resultado(s) encontrado(s). Escolha um para gerar o 9:16.";
      } catch (err) {
        if (msg) msg.textContent = "Erro na busca: " + err.message;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Buscar no YouTube"; }
      }
    };
    trailerSearchTimer = setTimeout(poll, 2000);
  } catch (error) {
    if (msg) msg.textContent = "Erro: " + error.message;
    if (btn) { btn.disabled = false; btn.textContent = "Buscar no YouTube"; }
  }
}

async function startTrailerJob(item, type, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Iniciando...";
  try {
    const body = {
      url: "https://www.youtube.com/watch?v=" + (item.id || ""),
      title: item.title || "Trailer",
      type: type,
      logoEnabled: $("#video-use-logo")?.checked !== false,
      endContact: $("#video-whatsapp-number")?.value.trim() || ""
    };
    const data = await api("/api/portal/videos/youtube", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    notice(data.message || "Trailer enviado para download e conversão 9:16 com template cinematográfico.");
    const resultsBox = $("#trailer-results");
    if (resultsBox) resultsBox.hidden = true;
    await loadVideoJobs();
  } catch (error) {
    notice("Trailer: " + error.message);
    button.disabled = false;
    button.textContent = original;
  }
}

let videoJobTimer;
async function loadVideoJobs() {
  const root = $("#video-job-list");
  if (!root) return;
  try {
    const data = await api("/api/portal/videos");
    let jobs = Array.isArray(data.jobs) ? data.jobs : [];
    if (!Array.isArray(data.jobs)) throw new Error("A API não confirmou a lista de vídeos.");
    if (jobs.some(job => job.status === "failed")) {
      await api("/api/portal/videos/failed", { method: "DELETE" });
      jobs = jobs.filter(job => job.status !== "failed");
    }
    clearTimeout(videoJobTimer);
    if (jobs.some(job => ["importing","cutting"].includes(job.status))) {
      videoJobTimer = setTimeout(loadVideoJobs, 5000);
    }
    root.replaceChildren();
    if (!jobs.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Nenhum vídeo registrado.";
      root.append(empty);
      return;
    }
    for (const job of jobs) {
      const card = document.createElement("article");
      card.className = "card media-card video-render-job";
      const title = document.createElement("strong");
      title.textContent = job.contentTitle || job.filename || "Vídeo";
      const status = document.createElement("span");
      const labels = { importing: "BAIXANDO", awaiting_configuration: "PRONTO", cutting: "GERANDO", ready: "CONCLUÍDO", failed: "FALHOU" };
      status.className = "status " + (job.status === "ready" ? "published" : job.status === "failed" ? "failed" : "ready");
      status.textContent = labels[job.status] || String(job.status || "AGUARDANDO").toUpperCase();
      const meta = document.createElement("small");
      meta.textContent = "Atualizado: " + formatDate(job.updatedAt || job.createdAt);
      card.append(title, status, meta);
      if (job.message && ["importing","cutting"].includes(job.status)) {
        const message = document.createElement("p");
        message.className = "muted";
        message.textContent = job.message;
        card.append(message);
      }
      const actions = document.createElement("div");
      actions.className = "post-actions";
      if (job.status === "awaiting_configuration" && job.sourceReady === true) {
        const generate = document.createElement("button");
        generate.type = "button";
        generate.className = "primary";
        generate.textContent = "Gerar agora";
        generate.addEventListener("click", async () => {
          generate.disabled = true;
          try {
            await api("/api/portal/videos/" + encodeURIComponent(job.id) + "/process", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                endContact: $("#video-whatsapp-number")?.value.trim() || "",
                logoEnabled: $("#video-use-logo")?.checked !== false
              })
            });
            await loadVideoJobs();
          } catch (error) {
            notice("Vídeos: " + error.message);
            generate.disabled = false;
          }
        });
        actions.append(generate);
      }
      const readyClip = (job.clips || []).find(clip => clip.status === "ready" && clip.previewUrl);
      if (job.status === "ready" && readyClip) {
        const download = document.createElement("a");
        download.className = "primary";
        download.href = readyClip.previewUrl;
        download.download = "nexus-video.mp4";
        download.textContent = "Baixar MP4";
        actions.append(download);
      }
      if (actions.children.length) card.append(actions);
      root.append(card);
    }
  } catch (error) {
    notice("Vídeos: " + error.message);
  }
}

async function uploadMedia(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const message = $("#media-upload-message");
  const file = $("#media-file")?.files?.[0];
  if (!file) { if (message) message.textContent = "Selecione um vídeo."; return; }
  if (file.size > MAX_VIDEO_UPLOAD_BYTES) { if (message) message.textContent = "O vídeo deve ter no máximo 90 MB."; return; }
  const body = new FormData();
  body.append("file", file);
  body.append("purpose", "publish");
  if ($("#media-note")?.value) body.append("note", $("#media-note").value);
  if (button) { button.disabled = true; button.textContent = "Enviando..."; }
  if (message) message.textContent = "Enviando vídeo...";
  try {
    const data = await api("/api/portal/media", { method: "POST", body });
    if (message) message.textContent = data.message || "Vídeo enviado. Gerando 9:16...";
    form.reset();
    await loadVideoJobs();
  } catch (error) {
    if (message) message.textContent = "Erro: " + error.message;
  } finally {
    if (button) { button.disabled = false; button.textContent = "Enviar e gerar 9:16"; }
  }
}

async function loadInstagram() {
  try {
    const data = await api("/api/portal/instagram");
    if ($("#instagram-handle")) $("#instagram-handle").textContent = data.handle || data.username || "Nenhuma conta conectada";
    if ($("#instagram-state")) $("#instagram-state").textContent = data.connected ? "Conectado" : "Não conectado";
    if ($("#instagram-expires")) $("#instagram-expires").textContent = data.expiresAt ? formatDate(data.expiresAt) : "—";
    if ($("#instagram-scopes")) $("#instagram-scopes").textContent = (data.scopes || []).join(", ") || "—";
  } catch (error) {
    notice("Instagram: " + error.message);
  }
}

async function boot() {
  try {
    const data = await api("/api/portal/me");
    showDashboard(data);
    showTab(activeTab);
  } catch {
    showLogin();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("#login-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      const data = await api("/api/portal/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      showDashboard(data.client || data);
      showTab("videos");
    } catch (error) {
      $("#login-error").textContent = error.message;
    }
  });
  $("#logout")?.addEventListener("click", async () => {
    try { await api("/api/portal/logout", { method: "POST" }); } catch {}
    showLogin();
  });
  $("#refresh")?.addEventListener("click", () => showTab(activeTab));
  document.querySelectorAll("[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });
  document.querySelectorAll("[data-refresh]").forEach(btn => {
    btn.addEventListener("click", () => showTab(btn.dataset.refresh || activeTab));
  });
  $("#trailer-search-form")?.addEventListener("submit", searchTrailers);
  $("#media-upload-form")?.addEventListener("submit", uploadMedia);
  $("#video-whatsapp-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await api("/api/portal/videos/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ whatsappNumber: $("#video-whatsapp-number")?.value.trim() || "" })
      });
      if ($("#video-whatsapp-message")) $("#video-whatsapp-message").textContent = "Número salvo para os próximos vídeos.";
    } catch (error) {
      if ($("#video-whatsapp-message")) $("#video-whatsapp-message").textContent = error.message;
    }
  });
  $("#connect-instagram")?.addEventListener("click", async () => {
    try {
      const data = await api("/api/portal/instagram/connect", { method: "POST" });
      if (data.url) window.location.href = data.url;
      else notice(data.message || "Não foi possível iniciar a conexão.");
    } catch (error) {
      notice("Instagram: " + error.message);
    }
  });
  $("#logo-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const file = $("#logo-file")?.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append("logo", file);
    body.append("removeBg", $("#logo-remove-bg")?.checked ? "1" : "0");
    try {
      const data = await api("/api/portal/logo", { method: "POST", body });
      if ($("#logo-message")) $("#logo-message").textContent = data.message || "Logo salva.";
    } catch (error) {
      if ($("#logo-message")) $("#logo-message").textContent = error.message;
    }
  });
  boot();
});
