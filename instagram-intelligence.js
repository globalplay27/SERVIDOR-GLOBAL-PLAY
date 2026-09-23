// NEXUS AI Instagram Intelligence Layer
// Adapted from concepts in instagram-agent-skill by Jake Schincariol (MIT).
// See THIRD_PARTY_NOTICES.md.

export const INSTAGRAM_SKILLS = Object.freeze([
  { id: "ig-viral", owner: "radar", purpose: "Descobrir sinais e conteúdos fora da curva usando desempenho relativo." },
  { id: "ig-audit", owner: "auditor", purpose: "Fazer pós-mortem e aprender com o desempenho real da conta." },
  { id: "ig-profile", owner: "radar", purpose: "Auditar perfil, bio, oferta, link e clareza de posicionamento." },
  { id: "ig-plan", owner: "estrategista", purpose: "Transformar sinais em plano editorial por objetivo e nicho." },
  { id: "ig-reel", owner: "creator", purpose: "Construir Reels com gancho, beats, payoff e CTA." },
  { id: "ig-caption", owner: "creator", purpose: "Criar e revisar legendas com primeira linha forte e um CTA." },
  { id: "ig-carousel", owner: "creator", purpose: "Planejar carrosséis com capa, progressão e conclusão." },
  { id: "ig-story", owner: "creator", purpose: "Planejar sequências de Stories com interação e DM." },
  { id: "ig-repurpose", owner: "creator", purpose: "Extrair conteúdos independentes de vídeos e materiais longos." },
  { id: "ig-human", owner: "auditor", purpose: "Remover linguagem artificial, vícios e caracteres invisíveis." },
  { id: "ig-comment", owner: "odin", purpose: "Escolher respostas úteis em comentários externos." },
  { id: "ig-reply", owner: "odin", purpose: "Classificar comentários próprios por intenção e prioridade." },
  { id: "ig-dm", owner: "odin", purpose: "Conduzir palavra-chave, primeira mensagem e follow-ups." }
]);

export const HOOK_FORMULA_NAMES = Object.freeze([
  "Cost Confession","Negative Command","Nobody Tells You","The Replacement","Time Collapse",
  "The Receipt","Wrong Way, Right Way","Insider Leak","The Steal","If This, Then Watch",
  "Numbered With A Favourite","The Objection","Before And After, On Screen","The Callout",
  "The Flop Record","The Verbatim Question","Head To Head","Cold Open Demo","The Deadline",
  "Permission","Mid-Sentence Start","Contrarian Flip","The Statistic","The Reveal",
  "Someone Else's Result","The Superlative"
]);

const INVISIBLE_RE = /[\u200B-\u200D\u2060\uFEFF\u00AD\u2061-\u2064\u00A0\u202F]/g;
const SLOP = [
  [/\bmergulh(?:e|ar|ando)\b/gi, "veja"],
  [/\bno mundo acelerado de hoje\b/gi, "hoje"],
  [/\bdesbloque(?:ie|ar) o potencial\b/gi, "use melhor"],
  [/\beleve (?:seu|sua) .{1,40} ao próximo nível\b/gi, "melhore"],
  [/\brevolucion(?:e|ar)\b/gi, "mude"],
  [/\bgame[- ]?changer\b/gi, "mudança importante"],
  [/\bin today's (?:video|post)\b/gi, ""],
  [/\bstop scrolling\b/gi, ""],
  [/\bfollow for more\b/gi, ""],
  [/\btag someone who needs this\b/gi, ""],
  [/\bthe algorithm loves\b/gi, ""],
  [/\brun don'?t walk\b/gi, ""]
];

function cleanSpace(value) {
  return String(value || "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function humanizeText(value) {
  let text = String(value || "")
    .replace(INVISIBLE_RE, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/—/g, ", ")
    .replace(/–/g, "-")
    .replace(/…/g, "...");
  const changes = [];
  for (const [pattern, replacement] of SLOP) {
    const before = text;
    text = text.replace(pattern, replacement);
    if (text !== before) changes.push(String(pattern));
  }
  text = cleanSpace(text).replace(/\s+([,.!?;:])/g, "$1");
  const structuralFlags = [];
  if (/\bnão é (?:só|apenas).{0,60}, é\b/i.test(text)) structuralFlags.push("not-just-x");
  if ((text.match(/^[•✅🔥🚀👉]/gm) || []).length >= 3) structuralFlags.push("emoji-list");
  if ((text.match(/#[\p{L}\p{N}_]+/gu) || []).length > 5) structuralFlags.push("hashtag-wall");
  if (/\b(?:segue|siga).{0,20}(?:mais|dicas|conteúdo)\b/i.test(text)) structuralFlags.push("follow-bait");
  return { text, changes, structuralFlags, score: Math.max(0, 100 - changes.length * 5 - structuralFlags.length * 12) };
}

function concreteMarkers(text) {
  const t = String(text || "");
  const numbers = (t.match(/(?:R\$|US\$|\$)?\s?\d+[\d.,%]*/g) || []).length;
  const names = (t.match(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]{2,}\b/g) || []).length;
  const time = (t.match(/\b\d+\s*(?:s|segundos?|minutos?|horas?|dias?|semanas?|meses?|anos?)\b/gi) || []).length;
  return numbers + Math.min(names, 2) + time;
}

export function scoreHook(text) {
  const raw = cleanSpace(text);
  const words = raw.split(/\s+/).filter(Boolean);
  const length = words.length;
  const first = words.slice(0, 8).join(" ");
  let frontload = 100 - Math.max(0, length - 14) * 3;
  if (/^(oi|olá|fala|e aí|bom dia|boa tarde|boa noite|pessoal|galera)\b/i.test(raw)) frontload = 5;
  const specificity = Math.min(100, 35 + concreteMarkers(raw) * 22 + (/\b(?:você|seu|sua|cliente|perfil|reel|instagram)\b/i.test(raw) ? 12 : 0));
  const stakes = Math.min(100, 35 + (/\b(?:perde|ganha|erro|evite|custa|venda|resultado|tempo|dinheiro|trav|falha|segredo|verdade|melhor|pior)\b/i.test(raw) ? 35 : 0) + (/[?!]/.test(raw) ? 10 : 0));
  const address = Math.min(100, 40 + (/\b(?:você|seu|sua|quem|se)\b/i.test(raw) ? 40 : 0));
  const curiosity = Math.min(100, 35 + (/\b(?:por que|como|ninguém|segredo|isso|este|essa|verdade|antes|depois|qual|o que)\b/i.test(raw) ? 40 : 0));
  const penalties = [];
  if (/\b(?:pare de rolar|pare de scroll|stop scrolling)\b/i.test(raw)) penalties.push("pede atenção em vez de merecê-la");
  if (/^(oi|olá|fala|pessoal|galera)\b/i.test(raw)) penalties.push("abre com saudação");
  if (length > 22) penalties.push("gancho longo demais");
  const score = Math.max(0, Math.min(100, (frontload * .24 + specificity * .22 + stakes * .22 + address * .14 + curiosity * .18) - penalties.length * 12));
  return { score: Math.round(score * 10) / 10, frontload, specificity, stakes, address, curiosity, penalties, visible: first };
}

export function buildHookCandidates(context = {}) {
  const niche = String(context.niche || "seu negócio");
  const audience = String(context.audience || "seu público");
  const topic = String(context.topic || context.focus || "o resultado");
  const question = String(context.question || "").trim();
  const candidates = [
    { formula: "The Verbatim Question", text: question || `O que mais atrapalha quem busca ${topic}?` },
    { formula: "Nobody Tells You", text: `Ninguém te conta isso sobre ${topic}.` },
    { formula: "If This, Then Watch", text: `Se você quer ${topic}, olha isso antes.` },
    { formula: "Permission", text: `Você não precisa complicar ${topic}.` },
    { formula: "The Callout", text: `${audience}: este detalhe muda ${topic}.` },
    { formula: "Cold Open Demo", text: `Olha o que acontece quando ${topic} é feito direito.` },
    { formula: "The Superlative", text: `O jeito mais simples de melhorar ${topic}.` },
    { formula: "Head To Head", text: `Improviso ou estratégia: o que funciona melhor em ${niche}?` }
  ];
  return candidates
    .map(item => ({ ...item, ...scoreHook(item.text) }))
    .sort((a,b) => b.score - a.score)
    .slice(0, 5);
}

export function captionAudit(caption, keywords = []) {
  const text = humanizeText(caption).text;
  const hashtags = text.match(/#[\p{L}\p{N}_]+/gu) || [];
  const visible = text.slice(0, 125);
  const asks = [
    /\bcomente\b/gi,/\bsalve\b/gi,/\bcompartilhe\b/gi,/\bmande\b/gi,/\bchame\b/gi,
    /\bclique\b/gi,/\bacesse\b/gi,/\bsiga\b/gi,/\benvie\b/gi
  ].reduce((sum,re) => sum + (text.match(re) || []).length, 0);
  const missingKeywords = keywords.filter(k => k && !text.toLowerCase().includes(String(k).toLowerCase()));
  return {
    text,
    visible,
    length: text.length,
    firstLine: (text.split("\n")[0] || "").trim(),
    hashtagCount: hashtags.length,
    oneAsk: asks <= 1,
    missingKeywords,
    score: Math.max(0, 100 - Math.max(0, hashtags.length - 5) * 8 - Math.max(0, asks - 1) * 15 - (visible.length < 25 ? 12 : 0) - missingKeywords.length * 5)
  };
}

export function estimateBeats(script, targetSeconds = 30) {
  const text = cleanSpace(script);
  const lines = text.split(/\n+|(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
  let cursor = 0;
  const beats = lines.map((line,index) => {
    const words = line.split(/\s+/).filter(Boolean).length;
    const seconds = Math.max(.8, words / 165 * 60);
    const beat = { index:index + 1, text:line, start:cursor, end:cursor + seconds, seconds, role:index===0?"HOOK":index===lines.length-1?"CTA":"MID" };
    cursor += seconds;
    return beat;
  });
  const issues = [];
  if (beats[0]?.seconds > 3.2) issues.push("hook-over-3s");
  for (const beat of beats) if (beat.seconds > 5) issues.push(`beat-${beat.index}-long`);
  if (Math.abs(cursor - targetSeconds) > Math.max(4, targetSeconds * .25)) issues.push("duration-off-target");
  return { beats, seconds:cursor, targetSeconds, issues };
}

export function profileAudit(profile = {}) {
  const name = String(profile.brandName || profile.agentName || "");
  const niche = String(profile.niche || "");
  const audience = String(profile.audience || "");
  const offer = String(profile.offer || "");
  const differentials = String(profile.differentials || "");
  const cta = String(profile.cta || "");
  const website = String(profile.website || "");
  const whatsapp = String(profile.whatsapp || "");
  const services = String(profile.services || "");
  const rows = [
    ["name-field",12, Math.min(12, (name?5:0)+(niche?7:0))],
    ["bio-first-line",12, Math.min(12, (audience?6:0)+(offer?6:0))],
    ["offer-clarity",10, offer.length>25?10:offer?5:0],
    ["proof-differential",8, differentials.length>20?8:differentials?4:0],
    ["cta",8, cta?8:0],
    ["link",8, website?8:whatsapp?5:0],
    ["highlights",8, 0],
    ["pinned-three",10, 0],
    ["grid-legibility",8, 0],
    ["search-terms",6, niche?6:0],
    ["contact-path",5, whatsapp||website?5:0],
    ["content-clarity",5, services||offer?5:0]
  ];
  const total = rows.reduce((sum,row)=>sum+row[2],0);
  return {
    score: total,
    rows: rows.map(([id,max,score])=>({id,max,score,missing:max-score})),
    priorities: rows.filter(row=>row[2]<row[1]).sort((a,b)=>(b[1]-b[2])-(a[1]-a[2])).slice(0,5).map(row=>row[0])
  };
}

export function median(values = []) {
  const nums = values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if (!nums.length) return 0;
  const m = Math.floor(nums.length/2);
  return nums.length%2 ? nums[m] : (nums[m-1]+nums[m])/2;
}

export function performanceAudit(items = []) {
  const scored = items.map(item => {
    const likes = Number(item.likeCount || item.likes || 0);
    const comments = Number(item.commentsCount || item.comments || 0);
    const saves = Number(item.saved || item.saves || 0);
    const shares = Number(item.shares || 0);
    const reach = Number(item.reach || 0);
    const engagement = likes + comments*2 + saves*3 + shares*4;
    return { ...item, engagement, normalized:reach>0?engagement/reach:engagement };
  });
  const baseline = median(scored.map(x=>x.normalized).filter(v=>v>0));
  for (const row of scored) row.outlierMultiple = baseline>0 ? row.normalized/baseline : (row.normalized>0?1:0);
  scored.sort((a,b)=>b.outlierMultiple-a.outlierMultiple);
  return { baseline, ranked:scored, top:scored.slice(0,5), weak:[...scored].reverse().slice(0,3) };
}

export function classifyInteraction(text, keyword = "QUERO") {
  const raw = cleanSpace(text);
  const low = raw.toLowerCase();
  if (!raw) return "NOISE";
  const key = String(keyword || "QUERO").replace(/[^A-Za-zÀ-ÿ0-9_-]/g, "");
  if (key && new RegExp("\\b" + key + "\\b", "i").test(raw)) return "KEYWORD";
  if (/\b(?:preço|valor|quanto|comprar|assinar|contratar|quero|preciso|interessad|orçamento|whatsapp)\b/i.test(low)) return "LEAD";
  if (/\?$/.test(raw) || /^(como|qual|quando|onde|por que|porque|posso|tem|voc[eê])/i.test(low)) return "QUESTION";
  if (/\b(?:erro|não funciona|nao funciona|problema|ajuda|suporte|caiu|travou|falha)\b/i.test(low)) return "SUPPORT";
  if (/^(🔥|👏|❤️|😍|top|show|massa|legal|boa|parabéns|parabens)[! .🔥👏❤️😍]*$/i.test(raw)) return "SUPPORT";
  if (/\b(?:http|www\.|me chama no meu|ganhe seguidores|divulgue aqui|promoção imperdível)\b/i.test(low)) return "NOISE";
  return raw.length > 35 ? "SUBSTANCE" : "SUPPORT";
}

export function suggestFormat({ goal="", topic="", leadQuestion="", hasLongVideo=false } = {}) {
  const g=String(goal).toLowerCase(), t=String(topic).toLowerCase();
  if (hasLongVideo) return { format:"reel", skill:"ig-repurpose", reason:"material longo disponível para extrair momentos independentes" };
  if (leadQuestion) return { format:"reel", skill:"ig-reel", reason:"pergunta real pode virar gancho verbatim" };
  if (/educ|ensinar|passo|lista|dica/.test(g+" "+t)) return { format:"carousel", skill:"ig-carousel", reason:"conteúdo estruturado favorece salvamentos" };
  if (/relacion|bastidor|dia|enquete|dm/.test(g+" "+t)) return { format:"story", skill:"ig-story", reason:"interação leve e abertura para DM" };
  return { format:"reel", skill:"ig-reel", reason:"formato forte para descoberta e alcance" };
}

export function repurposeCandidates(segments = [], targetSeconds = 30, count = 8) {
  if (!Array.isArray(segments) || !segments.length) return [];
  const desired=Math.max(8,Number(targetSeconds||30));
  const minLen=Math.max(6,desired-4), maxLen=Math.min(95,desired+10);
  const candidates=[];
  for(let i=0;i<segments.length;i++){
    let text="",end=segments[i].end;
    for(let j=i;j<segments.length;j++){
      const len=segments[j].end-segments[i].start;
      if(len>maxLen) break;
      text+=(text?" ":"")+String(segments[j].text||"");
      end=segments[j].end;
      if(len>=minLen && (/[.!?…]["')\]]?$/.test(String(segments[j].text||"").trim()) || len>=desired)){
        const hook=scoreHook(text.slice(0,180));
        const density=text.split(/\s+/).filter(Boolean).length/Math.max(1,len);
        const score=Math.min(100,hook.score*.65+Math.min(35,density*12)+concreteMarkers(text)*2);
        candidates.push({start:Number(segments[i].start||0),end:Number(end||0),text:cleanSpace(text),score:Math.round(score),hookScore:hook.score});
        break;
      }
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const selected=[];
  for(const candidate of candidates){
    if(selected.some(x=>Math.max(x.start,candidate.start)<Math.min(x.end,candidate.end))) continue;
    selected.push(candidate);
    if(selected.length>=count) break;
  }
  return selected;
}

export function skillCoverageForAgent(agentId) {
  return INSTAGRAM_SKILLS.filter(skill=>skill.owner===String(agentId||"").toLowerCase());
}
