const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const formatDate = value => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(date)
    : "—";
};
let client = null;
let activeTab = "videos";
let selectedCatalog = null;
let searchType = "movie";
let trailerSearchTimer = null;
let videoJobTimer = null;
let pendingUploadMetadata = null;
const MAX_VIDEO_UPLOAD_BYTES = 90 * 1024 * 1024;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
  const data = await response.json().catch(() => null);
  if (response.status === 401) {
    showLogin("Sua sessão terminou. Entre novamente.");
    throw new Error("Sessão expirada");
  }
  if (!response.ok) throw new Error(data?.message || data?.error || "Não foi possível consultar o NEXUS.");
  return data && typeof data === "object" ? data : {};
}

function notice(message) {
  const el = $("#notice");
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
}

function showLogin(message = "") {
  $("#dashboard").hidden = true;
  $("#login").hidden = false;
  $("#login-error").textContent = message;
}

function showDashboard(data) {
  client = data || {};
  $("#login").hidden = true;
  $("#dashboard").hidden = false;
  const raw = String(client.instagram || "").trim();
  const handle = raw ? (raw.startsWith("@") ? raw : "@" + raw.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/$/, "")) : "";
  const label = handle || client.name || "Cliente";
  $("#client-label").textContent = label;
  $("#header-client-name").textContent = label;
  const logo = $("#client-logo");
  const logoKey = String(client.branding?.logoKey || "");
  if (logo && logoKey) { logo.src = "/media/" + logoKey; logo.hidden = false; }
  else if (logo) { logo.hidden = true; logo.removeAttribute("src"); }
  if ($("#video-whatsapp-number")) $("#video-whatsapp-number").value = client.videoTemplate?.whatsappNumber || "";
}

function showTab(name) {
  activeTab = name;
  $$("[data-tab]").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === name));
  $$(".tab").forEach(section => { section.hidden = section.id !== "tab-" + name; });
  if (name === "videos") loadVideoJobs();
  if (name === "instagram") loadInstagram();
  if (name === "upload") {
    const metadata = pendingUploadMetadata || selectedCatalog;
    const complete = Boolean(metadata?.title && metadata?.overview);
    $("#upload-content-fields").hidden = complete;
    $("#upload-content-summary").hidden = !complete;
    $("#upload-content-summary").textContent = complete ? "Modelo de " + metadata.title + ". Título e sinopse já selecionados." : "";
    for (const id of ["#upload-title", "#upload-overview"]) {
      $(id).required = !complete;
      $(id).disabled = complete;
    }
  }
}

function renderCatalog(items) {
  const box = $("#catalog-box");
  const list = $("#catalog-list");
  list.replaceChildren();
  if (!items.length) { box.hidden = true; return; }
  box.hidden = false;
  items.forEach((item, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "catalog-card" + (selectedCatalog && selectedCatalog.id === item.id ? " selected" : "");
    if (item.posterUrl) {
      const img = document.createElement("img");
      img.src = item.posterUrl;
      img.alt = item.title || "";
      card.append(img);
    }
    const title = document.createElement("strong");
    title.textContent = item.title || "Título";
    const meta = document.createElement("small");
    meta.textContent = [item.mediaType || "", item.year || ""].filter(Boolean).join(" · ");
    card.append(title, meta);
    card.addEventListener("click", () => {
      selectedCatalog = item;
      pendingUploadMetadata = null;
      renderCatalog(items);
      notice("Título selecionado: " + item.title);
    });
    list.append(card);
    if (!selectedCatalog && index === 0) selectedCatalog = item;
  });
  if (selectedCatalog) {
    list.querySelectorAll(".catalog-card").forEach((el, i) => {
      if (items[i] && items[i].id === selectedCatalog.id) el.classList.add("selected");
    });
  }
}

function renderTrailers(results) {
  const box = $("#trailer-results");
  const list = $("#youtube-results");
  list.replaceChildren();
  if (!results.length) { box.hidden = true; return; }
  box.hidden = false;
  results.forEach(item => {
    const card = document.createElement("article");
    card.className = "youtube-card";
    const img = document.createElement("img");
    img.src = item.thumbnail || ("https://i.ytimg.com/vi/" + item.id + "/hqdefault.jpg");
    img.alt = item.title || "Trailer";
    const title = document.createElement("strong");
    title.textContent = item.title || "Trailer";
    const meta = document.createElement("small");
    const mins = item.duration ? Math.round(Number(item.duration) / 60) + " min" : "";
    const format = item.verticalCandidate ? "VERTICAL / SHORTS PRIORITÁRIO" : "";
    meta.textContent = [format, item.channel || "Canal", mins].filter(Boolean).join(" · ");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "primary";
    btn.textContent = item.verticalCandidate ? "Usar vertical oficial" : "Gerar vídeo 9:16";
    btn.addEventListener("click", () => startTrailerJob(item, btn));
    card.append(img, title, meta, btn);
    list.append(card);
  });
}

async function searchTrailers(event) {
  event.preventDefault();
  const query = $("#trailer-query")?.value.trim();
  searchType = $("#trailer-type")?.value || "movie";
  const btn = $("#trailer-search-btn");
  const msg = $("#trailer-search-message");
  if (!query) { msg.textContent = "Digite o nome do filme ou série."; return; }
  selectedCatalog = null;
  pendingUploadMetadata = null;
  btn.disabled = true;
  btn.textContent = "Buscando...";
  msg.textContent = "Procurando primeiro material oficial vertical/Shorts...";
  $("#catalog-box").hidden = true;
  $("#trailer-results").hidden = true;
  if (trailerSearchTimer) clearTimeout(trailerSearchTimer);
  try {
    const data = await api("/api/portal/videos/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, type: searchType })
    });
    const catalog = Array.isArray(data.catalog) ? data.catalog : [];
    renderCatalog(catalog);
    msg.textContent = "Buscando vertical oficial e trailer oficial de reserva...";
    const searchId = data.searchId;
    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        const status = await api("/api/portal/videos/search/" + encodeURIComponent(searchId));
        if (status.status !== "search_results" && attempts < 24) {
          trailerSearchTimer = setTimeout(poll, 2500);
          return;
        }
        const results = Array.isArray(status.results) ? status.results : [];
        if (!results.length) msg.textContent = "Nenhum trailer oficial dublado encontrado. Tente outro nome.";
        else {
          renderTrailers(results);
          msg.textContent = results.some(item => item.verticalCandidate) ? "Vertical oficial priorizado. Confirme o título e escolha o resultado." : "Não apareceu vertical oficial. Mostrando trailer oficial normal como alternativa.";
        }
        btn.disabled = false;
        btn.textContent = "Buscar trailer dublado";
      } catch (err) {
        msg.textContent = "Erro na busca: " + err.message;
        btn.disabled = false;
        btn.textContent = "Buscar trailer dublado";
      }
    };
    trailerSearchTimer = setTimeout(poll, 2000);
  } catch (error) {
    msg.textContent = "Erro: " + error.message;
    btn.disabled = false;
    btn.textContent = "Buscar trailer dublado";
  }
}

async function startTrailerJob(item, button) {
  if (!selectedCatalog) {
    notice("Selecione o filme ou série na lista de títulos antes de gerar o vídeo.");
    return;
  }
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Gerando...";
  try {
    const data = await api("/api/portal/videos/youtube", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: item.url || ("https://www.youtube.com/watch?v=" + item.id),
        title: selectedCatalog.title,
        catalogId: selectedCatalog.id,
        type: searchType,
        overview: selectedCatalog.overview || "",
        logoEnabled: $("#video-use-logo")?.checked !== false,
        endContact: $("#video-whatsapp-number")?.value.trim() || ""
      })
    });
    notice(data.message || "Trailer enviado. O vídeo completo 9:16 está sendo gerado.");
    await loadVideoJobs();
    $("#video-job-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    notice("Trailer: " + error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function loadVideoJobs() {
  const root = $("#video-job-list");
  if (!root) return;
  try {
    const data = await api("/api/portal/videos");
    let jobs = Array.isArray(data.jobs) ? data.jobs : [];
    clearTimeout(videoJobTimer);
    if (jobs.some(job => ["importing", "cutting", "searching"].includes(job.status))) {
      videoJobTimer = setTimeout(loadVideoJobs, 4000);
    }
    root.replaceChildren();
    const visible = jobs
      .filter(job => job.status !== "searching" && job.status !== "search_results")
      .sort((a, b) => {
        const priority = { cutting: 0, importing: 1, awaiting_configuration: 2, ready: 3, failed: 4 };
        const pa = priority[a.status] ?? 9;
        const pb = priority[b.status] ?? 9;
        if (pa !== pb) return pa - pb;
        return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
      });

    const headingRow = document.createElement("div");
    headingRow.className = "video-status-heading";
    const heading = document.createElement("h2");
    heading.textContent = visible.length ? "Seu vídeo" : "Status da geração";
    const hint = document.createElement("small");
    hint.textContent = visible.length ? "Acompanhe aqui. Não precisa rolar a página." : "Quando você gerar um vídeo, ele aparece aqui.";
    headingRow.append(heading, hint);
    root.append(headingRow);

    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "video-empty-state";
      empty.textContent = "Nenhum vídeo em geração.";
      root.append(empty);
      return;
    }

    const renderJobCard = job => {
      const card = document.createElement("article");
      card.className = "card media-card video-render-job";
      const top = document.createElement("div");
      top.className = "video-job-top";
      const title = document.createElement("strong");
      title.textContent = job.contentTitle || job.filename || "Vídeo";
      const status = document.createElement("span");
      const labels = { importing: "BAIXANDO", awaiting_configuration: "PRONTO PARA GERAR", cutting: "GERANDO", ready: "PRONTO", failed: "FALHOU" };
      status.className = "status " + (job.status === "ready" ? "published" : job.status === "failed" ? "failed" : "ready");
      status.textContent = labels[job.status] || String(job.status || "").toUpperCase();
      top.append(title, status);
      card.append(top);

      const progressValue = Math.max(0, Math.min(100, Number(job.progress || 0)));
      if (["importing", "cutting"].includes(job.status)) {
        const progress = document.createElement("progress");
        progress.max = 100;
        progress.value = progressValue || (job.status === "cutting" ? 35 : 10);
        progress.className = "video-progress";
        card.append(progress);
      }

      const meta = document.createElement("small");
      meta.textContent = (job.message || "") + " · " + formatDate(job.updatedAt || job.createdAt);
      card.append(meta);

      const actions = document.createElement("div");
      actions.className = "post-actions";
      if (job.status === "failed" && /^youtube_(authentication_required|challenge_failed|download_failed)/.test(String(job.error || ""))) {
        const uploadFallback = document.createElement("button");
        uploadFallback.type = "button";
        uploadFallback.className = "primary";
        uploadFallback.textContent = "Enviar MP4 e gerar";
        uploadFallback.addEventListener("click", () => {
          pendingUploadMetadata = {
            title: job.contentTitle || job.filename || "",
            overview: job.overview || "",
            year: job.releaseYear || "",
            mediaType: job.mediaType || "",
            catalogId: "",
            catalogType: /s[eé]rie|series|tv/i.test(String(job.mediaType || "")) ? "series" : "movie"
          };
          showTab("upload");
          notice("Envie o MP4. O NEXUS mantém título e sinopse.");
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
        actions.append(uploadFallback);
      }
      if (["ready", "failed", "awaiting_configuration"].includes(job.status) && job.sourceReady === true) {
        let titleInput, overviewInput, typeInput;
        if (!job.overview) {
          const titleLabel = document.createElement("label");
          titleLabel.textContent = "Título do filme ou série";
          titleInput = document.createElement("input");
          titleInput.value = job.overview ? job.contentTitle : "";
          titleInput.maxLength = 180;
          titleLabel.append(titleInput);
          const overviewLabel = document.createElement("label");
          overviewLabel.textContent = "Sinopse";
          overviewInput = document.createElement("textarea");
          overviewInput.maxLength = 1800;
          overviewLabel.append(overviewInput);
          const typeLabel = document.createElement("label");
          typeLabel.textContent = "Tipo";
          typeInput = document.createElement("select");
          for (const [value, label] of [["FILME", "Filme"], ["SÉRIE", "Série"]]) {
            const option = document.createElement("option");
            option.value = value; option.textContent = label; typeInput.append(option);
          }
          typeLabel.append(typeInput);
          card.append(titleLabel, overviewLabel, typeLabel);
        }
        const generate = document.createElement("button");
        generate.type = "button";
        generate.className = "primary";
        generate.textContent = job.status === "ready" ? "Gerar novamente com card" : "Gerar vídeo agora";
        generate.addEventListener("click", async () => {
          if (titleInput && (!titleInput.value.trim() || !overviewInput.value.trim())) {
            notice("Informe título e sinopse para aplicar o card.");
            return;
          }
          generate.disabled = true;
          try {
            await api("/api/portal/videos/" + encodeURIComponent(job.id) + "/process", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                ...(titleInput ? { title: titleInput.value.trim(), overview: overviewInput.value.trim(), mediaType: typeInput.value } : {}),
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
      const clip = (job.clips || []).find(c => c.status === "ready" && c.previewUrl);
      if (job.status === "ready" && clip) {
        const a = document.createElement("a");
        a.className = "primary";
        a.href = clip.previewUrl;
        a.download = "nexus-video-9x16.mp4";
        a.textContent = "Baixar vídeo 9:16";
        actions.append(a);
      }
      if (["ready", "failed", "awaiting_configuration"].includes(job.status)) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger";
        remove.textContent = "Excluir";
        remove.addEventListener("click", async () => {
          const label = job.contentTitle || job.filename || "este vídeo";
          if (!window.confirm("Excluir " + label + " definitivamente?")) return;
          remove.disabled = true;
          remove.textContent = "Excluindo...";
          try {
            await api("/api/portal/videos/" + encodeURIComponent(job.id), { method: "DELETE" });
            notice("Vídeo excluído.");
            await loadVideoJobs();
          } catch (error) {
            notice("Não foi possível excluir: " + error.message);
            remove.disabled = false;
            remove.textContent = "Excluir";
          }
        });
        actions.append(remove);
      }
      if (actions.children.length) card.append(actions);
      return card;
    };

    root.append(renderJobCard(visible[0]));
    if (visible.length > 1) {
      const history = document.createElement("details");
      history.className = "video-history";
      const summary = document.createElement("summary");
      summary.textContent = "Histórico (" + (visible.length - 1) + ")";
      history.append(summary);
      visible.slice(1, 6).forEach(job => history.append(renderJobCard(job)));
      root.append(history);
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
  if (!file) { message.textContent = "Selecione um vídeo."; return; }
  if (file.size > MAX_VIDEO_UPLOAD_BYTES) { message.textContent = "O vídeo deve ter no máximo 90 MB."; return; }
  const body = new FormData();
  body.append("file", file);
  body.append("purpose", "publish");
  if ($("#media-note")?.value) body.append("note", $("#media-note").value);
  const existingMetadata = pendingUploadMetadata || selectedCatalog;
  const uploadMetadata = existingMetadata?.title && existingMetadata?.overview ? existingMetadata : {
    ...existingMetadata,
    title: $("#upload-title")?.value.trim(), overview: $("#upload-overview")?.value.trim(),
    catalogType: $("#upload-type")?.value || "movie"
  };
  if (!uploadMetadata.title || !uploadMetadata.overview) {
    message.textContent = "Informe título e sinopse para aplicar o modelo.";
    return;
  }
  if (uploadMetadata) {
    body.append("title", String(uploadMetadata.title || ""));
    body.append("overview", String(uploadMetadata.overview || ""));
    body.append("year", String(uploadMetadata.year || ""));
    body.append("mediaType", String(uploadMetadata.mediaType || ""));
    body.append("catalogId", String(uploadMetadata.id || uploadMetadata.catalogId || ""));
    body.append("catalogType", String(uploadMetadata.catalogType || (searchType === "series" ? "series" : "movie")));
  }
  body.append("logoEnabled", $("#video-use-logo")?.checked === false ? "0" : "1");
  body.append("endContact", $("#video-whatsapp-number")?.value.trim() || "");
  button.disabled = true;
  message.textContent = "Enviando...";
  try {
    const data = await api("/api/portal/media", { method: "POST", body });
    message.textContent = data.message || "Vídeo enviado. Convertendo para 9:16...";
    form.reset();
    showTab("videos");
    if (uploadMetadata?.title) notice("Convertendo " + uploadMetadata.title + " para 9:16.");
    pendingUploadMetadata = null;
    await loadVideoJobs();
    $("#video-job-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    message.textContent = "Erro: " + error.message;
  } finally {
    button.disabled = false;
  }
}

async function loadInstagram() {
  try {
    const data = await api("/api/portal/connections");
    const ig = data.connections?.instagram || data.instagram || data.connection || {};
    $("#instagram-handle").textContent = ig.handle || ig.username || ig.instagram || ig.label || (ig.connected ? "Instagram conectado" : "Nenhuma conta conectada");
    $("#instagram-state").textContent = ig.connected || ig.status === "connected" ? "Conectado" : (ig.status || "Não conectado");
    $("#instagram-expires").textContent = ig.expiresAt ? formatDate(ig.expiresAt) : "—";
    $("#instagram-scopes").textContent = Array.isArray(ig.scopes) ? ig.scopes.join(", ") : (ig.scopes || "—");
  } catch (error) {
    notice("Instagram: " + error.message);
  }
}

async function boot() {
  try {
    const data = await api("/api/portal/session");
    showDashboard(data.client || data);
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");
    showTab(requestedTab === "instagram" ? "instagram" : "videos");
    if (params.get("oauth") === "success") {
      notice("Instagram conectado com sucesso.");
      history.replaceState({}, "", window.location.pathname);
    } else if (params.get("oauth")) {
      notice("A conexão com o Instagram não foi concluída. Tente novamente.");
      history.replaceState({}, "", window.location.pathname);
    }
  } catch {
    showLogin();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("#login-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
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
  $$("[data-tab]").forEach(btn => btn.addEventListener("click", () => showTab(btn.dataset.tab)));
  $$("[data-refresh]").forEach(btn => btn.addEventListener("click", () => showTab(btn.dataset.refresh || activeTab)));
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
      $("#video-whatsapp-message").textContent = "Número salvo.";
    } catch (error) {
      $("#video-whatsapp-message").textContent = error.message;
    }
  });
  $("#connect-instagram")?.addEventListener("click", async () => {
    try {
      const data = await api("/api/portal/instagram/start");
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
      const data = await api("/api/portal/branding/logo", { method: "POST", body });
      $("#logo-message").textContent = data.message || "Logo salva.";
    } catch (error) {
      $("#logo-message").textContent = error.message;
    }
  });
  boot();
});
