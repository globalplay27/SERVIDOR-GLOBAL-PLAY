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
  if (logoKey) {
    logo.src = "/media/" + logoKey;
    logo.hidden = false;
  } else {
    logo.hidden = true;
    logo.removeAttribute("src");
  }
  $("#profile-name").value = data.contact?.name || data.name || "";
  $("#profile-phone").value = data.contact?.phone || "";
  if ($("#video-whatsapp-number")) $("#video-whatsapp-number").value = data.videoTemplate?.whatsappNumber || "";
  $("#profile-instagram").value = instagramHandle || "";
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
  if (name === "videos") loadVideoJobs();
  if (name === "campaigns") loadCampaigns();
  if (name === "performance") loadPerformance();
  if (name === "instagram") loadInstagram();
}

function postStatus(post) {
  const status = String(post.status || "scheduled");
  const approval = String(post.approvalStatus || "pending");
  if (status === "published") return ["Publicada", "published"];
  if (status === "cancelled") return ["Cancelada", "ready"];
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
    post.status === "failed" || (
      post.status !== "cancelled" && ["pending", "rejected", "correction_requested"].includes(post.approvalStatus)
    )
  ).length);

  const latest = posts.find(post => post.status === "published") || posts[0];
  $("#last-activity").textContent = latest
    ? postStatus(latest)[0] + " · " + formatDate(latest.publishedAt || latest.updatedAt || latest.scheduledFor)
    : "Nenhuma publicação registrada ainda.";

  if (!posts.length) {
    const empty = document.createElement("div");
    empty.className = "card muted";
    empty.textContent = "Nenhuma postagem registrada ainda.";
    list.append(empty);
    return;
  }

  for (const post of posts) {
    const card = document.createElement("article");
    card.className = "card post";

    const main = document.createElement("div");
    const imageUrl = String(post.imageUrl || post.publicImageUrl || "");
    if (/^https:\/\//.test(imageUrl)) {
      const preview = document.createElement("img");
      preview.className = "post-preview";
      preview.src = imageUrl;
      preview.alt = "Prévia do criativo";
      preview.loading = "lazy";
      main.append(preview);
    }

    const heading = document.createElement("strong");
    heading.textContent = post.title || (post.caption || "Publicação").split("\n")[0].slice(0, 90) || "Publicação";
    const when = document.createElement("small");
    when.textContent = "Programada: " + formatDate(post.scheduledFor)
      + (post.publishedAt ? " · Publicada: " + formatDate(post.publishedAt) : "");
    main.append(heading, document.createElement("br"), when);

    if (post.caption) {
      const caption = document.createElement("p");
      caption.textContent = post.caption;
      main.append(caption);
    }

    if (post.revisionRequest) {
      const revision = document.createElement("p");
      revision.className = "revision-note";
      revision.textContent = "Correção solicitada: " + post.revisionRequest;
      main.append(revision);
    }

    if (post.error) {
      const error = document.createElement("p");
      error.className = "error";
      error.textContent = "Detalhe: " + post.error;
      main.append(error);
    }

    const permalink = safeInstagramLink(post.permalink);
    if (permalink) {
      const link = document.createElement("a");
      link.href = permalink;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Ver no Instagram";
      main.append(link);
    }

    const approval = String(post.approvalStatus || "pending");
    const status = String(post.status || "scheduled");
    if (!["published", "publishing", "cancelled", "expired"].includes(status)) {
      const actions = document.createElement("div");
      actions.className = "post-actions";

      if (["pending", "rejected", "correction_requested"].includes(approval)) {
        const approve = document.createElement("button");
        approve.className = "primary";
        approve.type = "button";
        approve.textContent = "Aprovar";
        approve.addEventListener("click", () => decidePost(post.id, "approved", approve));

        const reject = document.createElement("button");
        reject.type = "button";
        reject.textContent = "Reprovar";
        reject.addEventListener("click", () => decidePost(post.id, "rejected", reject));

        actions.append(approve, reject);
      }

      const revise = document.createElement("button");
      revise.type = "button";
      revise.textContent = "Refazer";
      revise.addEventListener("click", () => requestRevision(post.id, revise));
      actions.append(revise);

      if (approval === "approved") {
        const publish = document.createElement("button");
        publish.className = "primary";
        publish.type = "button";
        publish.textContent = "Publicar agora";
        publish.addEventListener("click", () => publishNow(post.id, publish));
        actions.append(publish);
      }

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancelar postagem";
      cancel.addEventListener("click", () => cancelPost(post.id, cancel));
      actions.append(cancel);

      main.append(actions);
    }

    const badge = document.createElement("span");
    const [label, kind] = postStatus(post);
    badge.className = "status " + kind;
    badge.textContent = label;
    card.append(main, badge);
    list.append(card);
  }
}

async function loadPosts() {
  try {
    const data = await api("/api/portal/posts");
    if (!Array.isArray(data.posts)) throw new Error("A API não confirmou a lista de postagens.");
    posts = [...new Map(data.posts.map(post => [post.id, post])).values()];
    renderPosts();
  } catch (error) {
    notice("Postagens: " + error.message);
  }
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
    if (activeTab === "agents") await loadAgents();
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
    if (activeTab === "agents") await loadAgents();
  } catch (error) {
    notice("Correção: " + error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function cancelPost(postId, button) {
  if (!window.confirm("Cancelar esta postagem? Ela não será enviada ao Instagram.")) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Cancelando...";
  try {
    const data = await api("/api/portal/posts/" + encodeURIComponent(postId) + "/cancel", {
      method: "POST"
    });
    notice(data.message || "Postagem cancelada.");
    await loadPosts();
    if (activeTab === "agents") await loadAgents();
  } catch (error) {
    notice("Cancelamento: " + error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function publishNow(postId, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Publicando...";
  try {
    const data = await api("/api/portal/posts/" + encodeURIComponent(postId) + "/manual", {
      method: "POST"
    });
    notice(data.message || "Postagem enviada.");
    await loadPosts();
    if (activeTab === "performance") await loadPerformance();
  } catch (error) {
    notice("Publicação: " + error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function normalizeAgentKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function agentDisplayName(value) {
  const raw = typeof value === "string"
    ? value
    : (value?.name || value?.agent || value?.id || value?.module || "Agente");
  return String(raw)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function executionTime(item) {
  return item?.finishedAt || item?.completedAt || item?.updatedAt || item?.createdAt || item?.startedAt || null;
}
let agentTimer;

async function loadAgents() {
  try {
    const data = await api("/api/portal/agent-core");
    clearTimeout(agentTimer);
    const pendingCycle = ["scheduled", "running"].includes(data.cycle?.status);
    if (pendingCycle && activeTab === "agents") agentTimer = setTimeout(loadAgents, 7000);
    $("#run-agent-cycle").disabled = pendingCycle;
    $("#agent-cycle-status").textContent = data.cycle
      ? "Último ciclo: " + data.cycle.status + " · " + formatDate(data.cycle.updatedAt) + (data.cycle.error ? " · " + data.cycle.error : "")
      : "Ainda não há ciclo registrado para esta conta.";
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
      const key = normalizeAgentKey(execution.agent || execution.module || execution.name);
      if (key && !latestByAgent.has(key)) latestByAgent.set(key, execution);
    }

    const rows = modules.length ? modules : [...latestByAgent.keys()];
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "card muted";
      empty.textContent = "Nenhuma execução de agente registrada ainda.";
      root.append(empty);
      return;
    }

    for (const module of rows) {
      const moduleKey = normalizeAgentKey(
        typeof module === "string" ? module : (module.id || module.name || module.agent)
      );
      const saved = Object.entries(data.state?.modules || {}).find(([key]) => normalizeAgentKey(key) === moduleKey)?.[1] || {};
      const execution = latestByAgent.get(moduleKey) || { ...saved, finishedAt: saved.lastExecutionAt };
      const card = document.createElement("article");
      card.className = "card agent-card";

      const title = document.createElement("strong");
      title.textContent = agentDisplayName(module);

      const status = document.createElement("span");
      const disabled = data.config?.enabled === false || data.config?.modules?.[moduleKey] === false;
      const state = disabled ? "disabled" : String(execution.status || "not_run").toLowerCase();
      const failed = state === "failed" || state === "error" || state === "blocked";
      const warning = state === "warning";
      status.className = "status " + (state === "success" ? "published" : failed ? "failed" : "ready");
      status.textContent = state === "success"
        ? "Concluído"
        : failed
          ? "Falha"
          : warning
            ? "Atenção"
            : state === "disabled" ? "Desativado" : state === "running" ? "Em execução" : "Sem execução registrada";

      const detail = document.createElement("p");
      detail.className = "muted";
      detail.textContent = String(
        execution.message || execution.summary || execution.function || "Sem atividade recente detalhada."
      );

      const when = document.createElement("small");
      const at = executionTime(execution);
      when.textContent = at ? "Última execução: " + formatDate(at) : "Ainda sem execução registrada.";

      card.append(title, status, detail, when);
      root.append(card);
    }
  } catch (error) {
    notice("Agentes: " + error.message);
  }
}

async function loadMedia() {
  try {
    const data = await api("/api/portal/media");
    const items = Array.isArray(data.media) ? data.media : [];
    const root = $("#media-list");
    root.replaceChildren();

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "card muted";
      empty.textContent = "Nenhuma mídia enviada ainda.";
      root.append(empty);
      return;
    }

    for (const item of items) {
      const card = document.createElement("article");
      card.className = "card media-card";
      const type = String(item.contentType || "");
      if (type.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = item.url;
        img.alt = item.name || "Mídia";
        img.loading = "lazy";
        card.append(img);
      } else if (type.startsWith("video/")) {
        const video = document.createElement("video");
        video.src = item.url;
        video.controls = true;
        video.preload = "metadata";
        card.append(video);
      }

      const title = document.createElement("strong");
      title.textContent = item.name || "Mídia";
      const purpose = document.createElement("small");
      purpose.textContent = item.purpose === "reference" ? "Referência de estilo" : "Mídia própria";
      card.append(title, purpose);

      if (item.note) {
        const note = document.createElement("p");
        note.textContent = item.note;
        card.append(note);
      }

      if (item.purpose === "publish" && type.startsWith("image/")) {
        const candidates = posts.filter(post => String(post.status || "") !== "published");
        const useBox = document.createElement("div");
        useBox.className = "post-actions";
        const select = document.createElement("select");
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = candidates.length ? "Escolha uma postagem" : "Nenhuma postagem disponível";
        select.append(placeholder);

        for (const post of candidates) {
          const option = document.createElement("option");
          option.value = post.id;
          option.textContent = (post.title || (post.caption || "Publicação").split("\n")[0] || "Publicação").slice(0, 70)
            + " · " + formatDate(post.scheduledFor);
          select.append(option);
        }

        const use = document.createElement("button");
        use.type = "button";
        use.className = "primary";
        use.textContent = "Usar nesta postagem";
        use.disabled = !candidates.length;
        use.addEventListener("click", async () => {
          if (!select.value) {
            notice("Mídias: escolha a postagem que receberá esta imagem.");
            return;
          }
          use.disabled = true;
          const original = use.textContent;
          use.textContent = "Aplicando...";
          try {
            const data = await api("/api/portal/media/use", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ key: item.key, postId: select.value })
            });
            notice(data.message || "Mídia aplicada à postagem.");
            await loadPosts();
          } catch (error) {
            notice("Mídias: " + error.message);
          } finally {
            use.disabled = false;
            use.textContent = original;
          }
        });
        useBox.append(select, use);
        card.append(useBox);
      }

      if (item.purpose === "publish" && type.startsWith("video/")) {
        const note = document.createElement("small");
        note.className = "muted";
        note.textContent = "Vídeo armazenado. A publicação automática de Reels ainda não usa arquivos da biblioteca.";
        card.append(note);
      }

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Excluir";
      remove.addEventListener("click", async () => {
        if (!window.confirm("Excluir esta mídia da biblioteca?")) return;
        remove.disabled = true;
        try {
          await api("/api/portal/media/" + encodeURIComponent(item.key), { method: "DELETE" });
          await loadMedia();
        } catch (error) {
          notice("Mídias: " + error.message);
          remove.disabled = false;
        }
      });
      card.append(remove);
      root.append(card);
    }
  } catch (error) {
    notice("Mídias: " + error.message);
  }
}


let youtubeCatalog = [];
let videoSearchTimer;
let videoJobTimer;
async function generateYouTubeVideo(url) {
  const selected = youtubeCatalog.find(x => x.id === $("#youtube-catalog").value);
  const message = $("#youtube-search-message");
  message.textContent = "Preparando o vídeo completo...";
  try {
    await api("/api/portal/videos/youtube", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, title: selected?.title || $("#youtube-query").value.trim(), type: $("#youtube-type").value, catalogId: selected?.id || "", endContact: $("#video-whatsapp-number")?.value.trim() || "", overview: $("#youtube-overview").value.trim(), logoEnabled: $("#video-use-logo")?.checked !== false }) });
    message.textContent = "Importação iniciada. Acompanhe abaixo: IMPORTANDO → PRONTO PARA GERAR → GERANDO → CONCLUÍDO.";
    await loadVideoJobs();
  } catch (error) {
    message.textContent = "Falha ao iniciar: " + error.message;
    await loadVideoJobs().catch(() => {});
  }
}
async function searchYouTube(event) {
  event.preventDefault(); clearTimeout(videoSearchTimer);
  const button = event.currentTarget.querySelector('button');
  const message = $("#youtube-search-message");
  button.disabled = true; message.textContent = "Buscando título e vídeos no YouTube...";
  $("#youtube-results").replaceChildren();
  try {
    const data = await api("/api/portal/videos/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: $("#youtube-query").value.trim(), type: $("#youtube-type").value }) });
    youtubeCatalog = data.catalog || [];
    $("#youtube-catalog").replaceChildren(...youtubeCatalog.map(item => { const o = document.createElement('option'); o.value = item.id; o.textContent = item.title + ' (' + item.year + ')'; return o; }));
    $("#youtube-overview").value = youtubeCatalog[0]?.overview || '';
    const poll = async () => {
      try {
        const state = await api('/api/portal/videos/search/' + encodeURIComponent(data.searchId));
        if (state.status === 'searching') { videoSearchTimer = setTimeout(poll, 5000); return; }
        if (state.status !== 'search_results') throw new Error('A busca do YouTube falhou. Você pode informar um link abaixo.');
        message.textContent = state.results.length ? 'Somente canais oficiais verificados. O áudio em português será conferido antes da geração.' : 'Nenhum trailer oficial dublado em português encontrado. Um link informado também precisa passar pela verificação.';
        for (const result of state.results) {
          const card = document.createElement('article'); card.className = 'card media-card';
          const image = document.createElement('img'); image.src = result.thumbnail; image.alt = result.title;
          const title = document.createElement('strong'); title.textContent = result.title;
          const info = document.createElement('p'); info.className = 'muted'; info.textContent = result.channel + (result.duration ? ' · ' + Math.floor(result.duration / 60) + ' min ' + Math.round(result.duration % 60) + ' s' : '');
          const choose = document.createElement('button'); choose.textContent = 'Gerar vídeo completo'; choose.className = 'primary';
          choose.addEventListener('click', async () => { choose.disabled = true; await generateYouTubeVideo(result.url); choose.disabled = false; });
          const view = document.createElement('a'); view.href = result.url; view.target = '_blank'; view.rel = 'noopener'; view.textContent = 'Ver no YouTube';
          card.append(image, title, info, view, choose); $("#youtube-results").append(card);
        }
      } catch (error) { message.textContent = error.message; }
    };
    videoSearchTimer = setTimeout(poll, 5000);
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
}
async function loadVideoJobs() {
  const root = $("#video-job-list");
  if (!root) return;
  try {
    const data = await api("/api/portal/videos");
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    if (!Array.isArray(data.jobs)) throw new Error("A API não confirmou a lista de vídeos.");
    clearTimeout(videoJobTimer);
    if (jobs.some(job => ["importing","cutting"].includes(job.status))) videoJobTimer = setTimeout(loadVideoJobs, 5000);
    root.replaceChildren();
    if (!jobs.length) { const empty = document.createElement("p"); empty.textContent = "Nenhum vídeo registrado. Envie um MP4 para começar."; root.append(empty); return; }

    const summary = document.createElement("div");
    summary.className = "video-status-summary";
    const counts = {
      processing: jobs.filter(job => ["importing","cutting"].includes(job.status)).length,
      waiting: jobs.filter(job => job.status === "awaiting_configuration").length,
      ready: jobs.filter(job => job.status === "ready").length,
      failed: jobs.filter(job => job.status === "failed").length
    };
    [
      ["Em andamento", counts.processing, "processing"],
      ["Prontos para gerar", counts.waiting, "waiting"],
      ["Concluídos", counts.ready, "done"],
      ["Falharam", counts.failed, "failed"]
    ].forEach(([label, value, kind]) => {
      const item = document.createElement("div");
      item.className = "video-summary-item " + kind;
      const strong = document.createElement("strong"); strong.textContent = String(value);
      const small = document.createElement("small"); small.textContent = label;
      item.append(strong, small); summary.append(item);
    });
    root.append(summary);

    const rank = { cutting: 0, importing: 1, awaiting_configuration: 2, failed: 3, ready: 4 };
    const orderedJobs = [...jobs].sort((a, b) => {
      const ar = rank[a.status] ?? 9, br = rank[b.status] ?? 9;
      if (ar !== br) return ar - br;
      return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
    });

    for (const job of orderedJobs) {
      const card = document.createElement("article");
      card.className = "card media-card video-render-job";

      const title = document.createElement("strong");
      title.textContent = job.contentTitle || job.filename || "Vídeo";

      const status = document.createElement("span");
      const labels = {
        importing: "IMPORTANDO",
        awaiting_configuration: "PRONTO PARA GERAR",
        cutting: "GERANDO",
        ready: "CONCLUÍDO",
        failed: "FALHOU"
      };
      const statusKind = job.status === "ready" ? "published" : job.status === "failed" ? "failed" : "ready";
      status.className = "status " + statusKind;
      status.textContent = labels[job.status] || String(job.status || "AGUARDANDO").toUpperCase();

      const meta = document.createElement("small");
      const progress = Number(job.progress || 0);
      const progressText = ["importing","cutting"].includes(job.status) && progress ? " · " + progress + "%" : "";
      meta.textContent = "Atualizado: " + formatDate(job.updatedAt || job.createdAt) + progressText;
      card.append(title, status, meta);

      if (job.message) {
        const message = document.createElement("p");
        message.className = job.status === "failed" ? "error" : "muted";
        message.textContent = job.message;
        card.append(message);
      }

      if (job.overview) {
        const synopsis = document.createElement("p");
        synopsis.className = "muted";
        synopsis.textContent = job.overview;
        card.append(synopsis);
      }
      if (job.error || job.sourceError) {
        const detail = document.createElement("p"); detail.className = "error";
        detail.textContent = "Detalhe: " + (job.error || job.sourceError);
        card.append(detail);
      }

      const actions = document.createElement("div");
      actions.className = "post-actions";

      if (job.sourceReady === true && ["awaiting_configuration", "failed", "ready"].includes(job.status)) {
        const laboratory = document.createElement("details");
        const open = document.createElement("summary"); open.textContent = "Abrir Laboratório";
        const fields = document.createElement("div"); fields.className = "media-upload";
        const field = (label, value, multiline = false) => {
          const wrapper = document.createElement("label"); wrapper.textContent = label;
          const input = document.createElement(multiline ? "textarea" : "input"); input.value = value || "";
          wrapper.append(input); fields.append(wrapper); return input;
        };
        const contentTitle = field("Título", job.contentTitle);
        const overview = field("Sinopse dentro do smartphone", job.overview, true);
        const year = field("Ano", job.releaseYear);
        const sourceNote = document.createElement("p"); sourceNote.className = "muted";
        sourceNote.textContent = "Original confirmado no R2 · Resultado vertical 9:16";
        laboratory.append(open, sourceNote, fields);
        const generate = document.createElement("button");
        generate.type = "button";
        generate.className = "primary";
        generate.textContent = job.status === "awaiting_configuration" ? "Gerar MP4" : "Gerar novamente";
        generate.addEventListener("click", async () => {
          generate.disabled = true;
          const original = generate.textContent;
          generate.textContent = "Iniciando...";
          try {
            await api("/api/portal/videos/" + encodeURIComponent(job.id) + "/process", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ title: contentTitle.value.trim(), overview: overview.value.trim(), year: year.value.trim(), endContact: $("#video-whatsapp-number")?.value.trim() || "", logoEnabled: $("#video-use-logo")?.checked !== false })
            });
            notice("Vídeo enviado para renderização.");
            await loadVideoJobs();
            setTimeout(() => loadVideoJobs(), 5000);
          } catch (error) {
            notice("Vídeos: " + error.message);
            generate.disabled = false;
            generate.textContent = original;
          }
        });
        laboratory.append(generate); actions.append(laboratory);
      } else if (!job.sourceReady && job.status !== "importing") {
        const blocked = document.createElement("p");
        blocked.className = job.status === "failed" ? "error" : "muted";
        blocked.textContent = job.status === "failed"
          ? "Este trabalho falhou antes de receber o vídeo original. Use “Enviar arquivo” para criar uma nova geração."
          : "Laboratório bloqueado: envie um vídeo original válido para continuar.";
        actions.append(blocked);
      }

      const readyClip = (job.clips || []).find(clip => clip.status === "ready" && clip.previewUrl);
      if (readyClip && job.status === "ready") {
        const download = document.createElement("a");
        download.className = "primary";
        download.href = readyClip.previewUrl;
        download.download = "nexus-video.mp4";
        download.textContent = "Baixar MP4";
        actions.append(download);
      }

      if (job.status === "cutting") {
        const refresh = document.createElement("button");
        refresh.type = "button";
        refresh.textContent = "Atualizar status";
        refresh.addEventListener("click", loadVideoJobs);
        actions.append(refresh);
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
  const file = $("#media-file").files?.[0];
  if (!file) {
    message.textContent = "Selecione um vídeo.";
    return;
  }
  if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
    message.textContent = "O vídeo deve ter no máximo 90 MB.";
    return;
  }

  const body = new FormData();
  body.append("file", file);
  const poster = $("#video-poster-file")?.files?.[0];
  if (poster) body.append("poster", poster);
  body.append("title", $("#video-title")?.value?.trim() || "");
  body.append("overview", $("#video-overview")?.value?.trim() || "");
  body.append("year", $("#video-year")?.value?.trim() || "");
  body.append("mediaType", $("#video-media-type")?.value || "FILME");
  body.append("purpose", $("#media-purpose").value);
  body.append("note", $("#media-note").value.trim());

  button.disabled = true;
  message.textContent = "Enviando...";
  try {
    const data = await api("/api/portal/media", { method: "POST", body });
    message.textContent = data.message || "Mídia enviada.";
    form.reset();
    await loadVideoJobs();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function processLogo(file) {
  if (!$("#logo-remove-bg").checked) return file;
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const corners = [
    0,
    (canvas.width - 1) * 4,
    ((canvas.height - 1) * canvas.width) * 4,
    ((canvas.height * canvas.width) - 1) * 4
  ];
  const bg = [0,1,2].map(k => corners.reduce((sum,p) => sum + d[p+k], 0) / corners.length);
  for (let p = 0; p < d.length; p += 4) {
    const dist = Math.hypot(d[p]-bg[0], d[p+1]-bg[1], d[p+2]-bg[2]);
    if (dist < 42) d[p+3] = 0;
    else if (dist < 78) d[p+3] = Math.round(255 * (dist - 42) / 36);
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Não foi possível processar a logo.");
  return new File([blob], "logo.png", { type: "image/png" });
}

async function previewLogo() {
  const file = $("#logo-file")?.files?.[0];
  if (!file) return;
  try {
    const processed = await processLogo(file);
    const preview = $("#logo-preview");
    if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
    const url = URL.createObjectURL(processed);
    preview.dataset.url = url;
    preview.src = url;
    $("#logo-preview-wrap").hidden = false;
    $("#logo-message").textContent = "";
  } catch (error) {
    $("#logo-message").textContent = error.message;
  }
}

async function submitLogo(event) {
  event.preventDefault();
  const file = $("#logo-file")?.files?.[0];
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const message = $("#logo-message");
  if (!file) { message.textContent = "Selecione uma logo."; return; }
  button.disabled = true;
  message.textContent = $("#logo-remove-bg").checked ? "Removendo fundo e salvando..." : "Salvando logo...";
  try {
    const processed = await processLogo(file);
    const body = new FormData();
    body.append("logo", processed, processed.name || "logo.png");
    const data = await api("/api/portal/branding/logo", { method: "POST", body });
    message.textContent = data.message || "Logo atualizada.";
    const logo = $("#client-logo");
    logo.src = data.logoUrl + "?v=" + Date.now();
    logo.hidden = false;
    const fresh = await api("/api/portal/session");
    showDashboard(fresh);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function submitProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const message = $("#profile-message");
  const payload = {
    name: $("#profile-name").value.trim(),
    phone: $("#profile-phone").value.trim(),
    instagram: $("#profile-instagram").value.trim()
  };
  button.disabled = true;
  message.textContent = "Salvando...";
  try {
    const data = await api("/api/portal/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    message.textContent = data.message || "Dados atualizados.";
    showDashboard(data.client);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function loadPerformance() {
  try {
    const data = await api("/api/portal/agent-core");
    const radar = data.state?.radar || {};
    const root = $("#top-media"); root.replaceChildren();
    const hasSnapshot = radar.source === "instagram-api" && !radar.error;
    const hasFollowers = hasSnapshot && radar.followersCount != null && Number.isFinite(Number(radar.followersCount));
    const hasMedia = hasSnapshot && radar.scannedMedia != null && Number.isFinite(Number(radar.scannedMedia));
    $("#followers").textContent = hasFollowers ? formatNumber(radar.followersCount) : "—";
    $("#followers-delta").textContent = hasFollowers && radar.followersDelta != null ? String(Number(radar.followersDelta) >= 0 ? "+" : "") + formatNumber(radar.followersDelta) : "—";
    $("#median-engagement").textContent = hasMedia && radar.metrics?.medianEngagement != null ? formatNumber(radar.metrics.medianEngagement) : "—";
    $("#scanned-media").textContent = hasMedia ? formatNumber(radar.scannedMedia) : "—";
    for (const item of (Array.isArray(radar.topMedia) ? radar.topMedia : []).slice(0, 5)) {
      const row = document.createElement("div"); row.className = "media-row";
      const title = document.createElement("strong"); title.textContent = item.caption || item.mediaType || "Publicação";
      const count = document.createElement("small"); count.textContent = formatNumber(item.engagement) + " interações ponderadas";
      row.append(title, count);
      const linkUrl = safeInstagramLink(item.permalink);
      if (linkUrl) { const link = document.createElement("a"); link.href = linkUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = " Abrir publicação"; row.append(link); }
      root.append(row);
    }
    const diagnostic = Array.isArray(radar.diagnosis) ? radar.diagnosis[0] : "";
    const scannedAt = radar.scannedAt || data.state?.lastCycleAt;
    $("#performance-note").textContent = hasSnapshot
      ? "Última coleta do Instagram: " + formatDate(scannedAt) + ". " + (diagnostic || "Métricas recebidas da conta conectada.")
      : (diagnostic || "O RADAR ainda não conseguiu uma coleta válida do Instagram. Verifique a autorização e aguarde a próxima rodada.");
  } catch (error) { notice("Desempenho: " + error.message); }
}

async function loadCampaigns() {
  try {
    const data = await api("/api/portal/workspace");
    const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
    const directives = Array.isArray(data.directives) ? data.directives : [];
    const campaignList = $("#campaign-list");
    const directiveList = $("#directive-list");
    campaignList.replaceChildren();
    directiveList.replaceChildren();

    if (!campaigns.length) {
      const empty = document.createElement("div");
      empty.className = "card muted";
      empty.textContent = "Nenhuma campanha criada ainda.";
      campaignList.append(empty);
    } else {
      for (const item of campaigns) {
        const card = document.createElement("article");
        card.className = "card";
        const title = document.createElement("strong");
        title.textContent = item.title || "Campanha";
        const meta = document.createElement("small");
        meta.textContent = "Início: " + (item.startDate || "—") + " · " + (item.durationDays || 7) + " dias · " + (item.status || "Status indisponível");
        const brief = document.createElement("p");
        brief.textContent = item.brief || "";
        card.append(title, document.createElement("br"), meta, brief);
        campaignList.append(card);
      }
    }

    if (!directives.length) {
      const empty = document.createElement("div");
      empty.className = "card muted";
      empty.textContent = "Nenhuma orientação salva ainda.";
      directiveList.append(empty);
    } else {
      for (const item of directives) {
        const card = document.createElement("article");
        card.className = "card";
        const title = document.createElement("strong");
        title.textContent = item.author === "CLIENT" ? "Sua orientação" : "Orientação do NEXUS";
        const meta = document.createElement("small");
        meta.textContent = formatDate(item.createdAt);
        const text = document.createElement("p");
        text.textContent = item.text || "";
        card.append(title, document.createElement("br"), meta, text);
        directiveList.append(card);
      }
    }
  } catch (error) {
    notice("Campanhas: " + error.message);
  }
}

async function submitCampaign(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const message = $("#campaign-message");
  button.disabled = true;
  message.textContent = "Enviando campanha...";
  try {
    const data = await api("/api/portal/campaigns", { method: "POST", body: new FormData(form) });
    message.textContent = data.ok ? "Campanha enviada aos seus agentes." : "Campanha salva.";
    form.reset();
    await loadCampaigns();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function submitDirective(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const message = $("#directive-message");
  button.disabled = true;
  message.textContent = "Salvando orientação...";
  try {
    const textValue = form.elements.namedItem("text").value.trim();
    const data = await api("/api/portal/directives", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: textValue, appliesTo: ["all"] })
    });
    message.textContent = data.ok ? "Orientação salva para os seus agentes." : "Orientação salva.";
    form.reset();
    await loadCampaigns();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function loadAIUsage() {
  try {
    const data = await api("/api/portal/provider-usage");
    const usage = data.openai || {};
    $("#ai-used-tokens").textContent = formatNumber(usage.usedTokens || 0);
    $("#ai-limit-tokens").textContent = formatNumber(usage.limitTokens || 0);
    $("#ai-remaining-tokens").textContent = formatNumber(usage.remainingTokens || 0);
    $("#ai-estimated-cost").textContent = "US$ " + Number(usage.estimatedCostUsd || 0).toFixed(4);
    const pct = Number(usage.percent || 0);
    $("#ai-usage-note").textContent = usage.blocked
      ? "Limite diário atingido. Novas chamadas pagas ficam bloqueadas até o próximo dia."
      : pct + "% do limite diário utilizado · custo estimado pelo NEXUS.";
  } catch (error) {
    $("#ai-usage-note").textContent = "Não foi possível carregar o consumo agora.";
  }
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
    loadInstagram(),
    activeTab === "videos" ? Promise.all([loadMedia(), loadVideoJobs()])
      : activeTab === "agents" ? loadAgents() : activeTab === "posts" ? loadPosts()
      : activeTab === "campaigns" ? loadCampaigns() : activeTab === "performance" ? loadPerformance() : Promise.resolve()
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
document.querySelectorAll("[data-refresh]").forEach(button => button.addEventListener("click", () => {
  const target = button.dataset.refresh;
  if (target === "posts") return loadPosts();
  if (target === "agents") return loadAgents();
  if (target === "campaigns") return loadCampaigns();
  if (target === "videos") return Promise.all([loadMedia(), loadVideoJobs()]);
  if (target === "instagram") return loadInstagram();
  return loadPerformance();
}));
$("#refresh").addEventListener("click", () => refresh().catch(error => notice(error.message)));
$("#run-agent-cycle")?.addEventListener("click", async event => {
  event.currentTarget.disabled = true;
  try {
    const data = await api("/api/portal/agent-core/run", { method: "POST" });
    notice(data.message); await loadAgents();
  } catch (error) { notice("Agentes: " + error.message); event.currentTarget.disabled = false; }
});
$("#profile-form")?.addEventListener("submit", submitProfile);
$("#logo-form")?.addEventListener("submit", submitLogo);
$("#logo-file")?.addEventListener("change", previewLogo);
$("#logo-remove-bg")?.addEventListener("change", previewLogo);
$("#media-upload-form")?.addEventListener("submit", uploadMedia);
$("#video-whatsapp-form")?.addEventListener("submit", async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    await api('/api/portal/videos/preferences', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ whatsappNumber: $("#video-whatsapp-number").value.trim() }) });
    $("#video-whatsapp-message").textContent = 'Número salvo para os próximos vídeos.';
  } catch (error) { $("#video-whatsapp-message").textContent = error.message; }
  finally { button.disabled = false; }
});
$("#video-search-form")?.addEventListener("submit", searchYouTube);
$("#youtube-catalog")?.addEventListener("change", () => { $("#youtube-overview").value = youtubeCatalog.find(x => x.id === $("#youtube-catalog").value)?.overview || ''; });
$("#youtube-link-form")?.addEventListener("submit", event => { event.preventDefault(); generateYouTubeVideo($("#youtube-url").value.trim()); });
$$('[data-video-source]').forEach(button => button.addEventListener('click', () => {
  const youtube = button.dataset.videoSource === 'youtube';
  $("#video-youtube-panel").hidden = !youtube; $("#media-upload-form").hidden = youtube;
  $$('[data-video-source]').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)));
}));
$("#campaign-form")?.addEventListener("submit", submitCampaign);
$("#directive-form")?.addEventListener("submit", submitDirective);
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
