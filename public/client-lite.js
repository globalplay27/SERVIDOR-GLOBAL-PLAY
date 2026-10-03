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
