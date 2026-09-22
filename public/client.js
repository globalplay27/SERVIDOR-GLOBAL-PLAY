const $ = selector => document.querySelector(selector);
let sessionAuth = null;

function nextPostTime(times = []) {
  if (!Array.isArray(times) || !times.length) return "—";
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const hour = Number(parts.find(part => part.type === "hour")?.value || 0);
  const minute = Number(parts.find(part => part.type === "minute")?.value || 0);
  const nowMinutes = hour * 60 + minute;
  const normalized = times
    .map(value => {
      const [h, m] = String(value).split(":").map(Number);
      return { value, minutes: h * 60 + m };
    })
    .filter(item => Number.isFinite(item.minutes))
    .sort((a, b) => a.minutes - b.minutes);
  const next = normalized.find(item => item.minutes > nowMinutes);
  return next ? next.value : normalized[0]?.value || "—";
}

function usageRow(label, value) {
  const safe = Math.min(Number(value) || 0, 100);
  return `<div class="usage-row"><div><span>${label}</span><strong>${safe}%</strong></div><div class="bar"><i style="width:${safe}%"></i></div></div>`;
}

function showPortal(client) {
  $("#login-view").hidden = true;
  $("#portal-view").hidden = false;
  document.documentElement.style.setProperty("--accent", client.primaryColor || "#24e27a");
  $("#client-name").textContent = client.name;
  $("#client-meta").textContent = `${client.niche || "Outro"} · ambiente exclusivo`;
  $("#leads-total").textContent = client.leads?.total || 0;
  $("#leads-hot").textContent = client.leads?.hot || 0;
  $("#next-post").textContent = nextPostTime(client.postTimes);
  $("#odin-status").textContent = client.odin ? "Ativo" : "Pausado";
  $("#instagram").textContent = client.instagram || "Pendente";
  $("#niche").textContent = client.niche || "Outro";
  $("#agent-status").textContent = client.status === "online" ? "Online" : "Em configuração";
  $("#post-times").textContent = (client.postTimes || []).join(" · ") || "—";
  $("#usage").innerHTML = usageRow("OpenAI", client.usage?.openaiPercent) + usageRow("Railway", client.usage?.railwayPercent);
}

$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  $("#login-error").textContent = "Verificando…";
  const form = new FormData(event.currentTarget);
  sessionAuth = `Basic ${btoa(`${form.get("username")}:${form.get("password")}`)}`;
  try {
    const response = await fetch("/api/portal/session", { headers: { authorization: sessionAuth } });
    if (!response.ok) throw new Error("Usuário ou senha inválidos.");
    showPortal(await response.json());
    event.currentTarget.reset();
  } catch (error) {
    sessionAuth = null;
    $("#login-error").textContent = error.message;
  }
});

$("#logout").addEventListener("click", () => {
  sessionAuth = null;
  $("#portal-view").hidden = true;
  $("#login-view").hidden = false;
  $("#login-error").textContent = "";
});
