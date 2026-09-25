import fs from "node:fs";

const file = "server.js";
let source = fs.readFileSync(file, "utf8");
let changes = 0;

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`patch anchor not found: ${label}`);
  source = source.replace(before, after);
  changes += 1;
}

replaceOnce(
  '    instructions: "Traduza legendas para português brasileiro natural e curto. Preserve sentido, nomes, números e tom. Não resuma, não acrescente informação e não junte itens. Retorne somente JSON válido.",',
  '    instructions: "Traduza legendas para português brasileiro natural, curto e com ortografia correta. Preserve exatamente o sentido, nomes, números e tom. Não resuma, não acrescente informação, não junte itens e não insira letras soltas, marcadores ou artefatos de quebra de linha no meio das palavras. Retorne somente JSON válido.",',
  "translation-instructions"
);

replaceOnce(
  '  const translations = new Map((Array.isArray(parsed.translations) ? parsed.translations : [])\n    .map(item => [Number(item.i), String(item.text || "").trim()]));',
  '  const translations = new Map((Array.isArray(parsed.translations) ? parsed.translations : [])\n    .map(item => [Number(item.i), sanitizeSubtitleText(item.text)]));',
  "translation-sanitize"
);

replaceOnce(
  'function wrapSubtitleText(value, maxLine = 34, maxLines = 3) {',
  'function sanitizeSubtitleText(value) {\n  return String(value || "")\n    .normalize("NFC")\n    .replace(/\\\\[nN]/g, " ")\n    .replace(/[\\r\\n\\t]+/g, " ")\n    .replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]/g, " ")\n    .replace(/\\s+/g, " ")\n    .trim();\n}\n\nfunction wrapSubtitleText(value, maxLine = 34, maxLines = 3) {',
  "subtitle-sanitizer"
);

replaceOnce(
  '  const words = String(value || "").replace(/\\s+/g, " ").trim().split(" ").filter(Boolean);',
  '  const words = sanitizeSubtitleText(value).split(" ").filter(Boolean);',
  "wrap-sanitize"
);

replaceOnce(
  '      text: String(item.text || "").trim()',
  '      text: sanitizeSubtitleText(item.text)',
  "segment-sanitize"
);

replaceOnce(
`function subtitleFontSizeForFormat(spec, sizeKey = "auto") {
  const auto = Math.round(Math.min(spec.width * 0.042, spec.height * 0.035));
  const multiplier = sizeKey === "small" ? 0.82 : sizeKey === "medium" ? 1 : sizeKey === "large" ? 1.28 : 1;
  return Math.max(28, Math.min(72, Math.round(auto * multiplier)));
}

function subtitleLayoutForFormat(spec, fontSize) {
  const horizontalSafe = spec.key === "reel" ? 0.80 : spec.key === "feed" ? 0.86 : 0.84;
  const safeWidth = Math.round(spec.width * horizontalSafe);
  const estimatedGlyphWidth = Math.max(1, fontSize * 0.62);
  const charsPerLine = Math.max(18, Math.min(30, Math.floor(safeWidth / estimatedGlyphWidth)));
  const yRatio = spec.key === "reel" ? 0.72 : spec.key === "feed" ? 0.79 : 0.77;
  return { safeWidth, charsPerLine, maxLines: 2, y: Math.round(spec.height * yRatio) };
}

function splitSubtitleCueForScreen(cue, charsPerLine, maxLines = 2) {
  const text = String(cue?.text || "").replace(/\\s+/g, " ").trim();
  const start = Number(cue?.start || 0);
  const end = Number(cue?.end || start);
  if (!text || !(end > start)) return [];
  const words = text.split(" ").filter(Boolean);
  const maxChunkChars = Math.max(charsPerLine + 4, charsPerLine * maxLines - 3);
  const chunks = [];
  let current = "";
  for (const word of words) {
    const next = current ? current + " " + word : word;
    if (next.length <= maxChunkChars || !current) current = next;
    else { chunks.push(current); current = word; }
  }
  if (current) chunks.push(current);
  if (chunks.length === 1) return [{ start, end, text: wrapSubtitleText(chunks[0], charsPerLine, maxLines) }];

  const weights = chunks.map(item => Math.max(1, item.length));
  const totalWeight = weights.reduce((sum,item)=>sum+item,0);
  const duration = end - start;
  let cursor = start;
  return chunks.map((chunk,index) => {
    const nextEnd = index === chunks.length - 1 ? end : cursor + duration * (weights[index] / totalWeight);
    const row = { start: cursor, end: nextEnd, text: wrapSubtitleText(chunk, charsPerLine, maxLines) };
    cursor = nextEnd;
    return row;
  });
}`,
`function subtitleFontSizeForFormat(spec, sizeKey = "auto") {
  const auto = Math.round(Math.min(spec.width * 0.045, spec.height * 0.034));
  const multiplier = sizeKey === "small" ? 0.84 : sizeKey === "medium" ? 1 : sizeKey === "large" ? 1.20 : 1;
  return Math.max(38, Math.min(64, Math.round(auto * multiplier)));
}

function subtitleLayoutForFormat(spec, fontSize) {
  const horizontalSafe = spec.key === "reel" ? 0.84 : spec.key === "feed" ? 0.86 : 0.84;
  const safeWidth = Math.round(spec.width * horizontalSafe);
  const estimatedGlyphWidth = Math.max(1, fontSize * 0.62);
  const charsPerLine = Math.max(18, Math.min(30, Math.floor(safeWidth / estimatedGlyphWidth)));
  const yRatio = spec.key === "reel" ? 0.61 : spec.key === "feed" ? 0.63 : 0.64;
  return { safeWidth, charsPerLine, maxLines: 1, y: Math.round(spec.height * yRatio) };
}

function splitSubtitleCueForScreen(cue, charsPerLine, maxLines = 1) {
  const text = sanitizeSubtitleText(cue?.text);
  const start = Number(cue?.start || 0);
  const end = Number(cue?.end || start);
  if (!text || !(end > start)) return [];
  const words = text.split(" ").filter(Boolean);
  const maxChunkChars = Math.max(18, charsPerLine);
  const chunks = [];
  let current = "";
  for (const word of words) {
    const next = current ? current + " " + word : word;
    if (next.length <= maxChunkChars || !current) current = next;
    else { chunks.push(current); current = word; }
  }
  if (current) chunks.push(current);
  if (!chunks.length) return [];
  if (chunks.length === 1) return [{ start, end, text: chunks[0] }];

  const weights = chunks.map(item => Math.max(1, item.length));
  const totalWeight = weights.reduce((sum,item)=>sum+item,0);
  const duration = end - start;
  let cursor = start;
  return chunks.map((chunk,index) => {
    const nextEnd = index === chunks.length - 1 ? end : cursor + duration * (weights[index] / totalWeight);
    const row = { start: cursor, end: nextEnd, text: chunk };
    cursor = nextEnd;
    return row;
  });
}`,
  "subtitle-layout"
);

replaceOnce(
  '      const shouldSubtitle = Boolean(initial.autoSubtitles) && !isPortugueseLanguage(transcription.language);\n      const translatedSubtitles = shouldSubtitle ? await translateClipSegmentsToPtBr(sourceSegments, initial.clientId) : [];',
  '      const shouldSubtitle = Boolean(initial.autoSubtitles);\n      const translatedSubtitles = shouldSubtitle\n        ? (isPortugueseLanguage(transcription.language) ? sourceSegments : await translateClipSegmentsToPtBr(sourceSegments, initial.clientId))\n        : [];',
  "subtitle-portuguese-source"
);

replaceOnce(
  '  const shouldSubtitle = Boolean(found.job.autoSubtitles) && !isPortugueseLanguage(found.job.detectedLanguage);\n  const translatedSubtitles = shouldSubtitle ? await translateClipSegmentsToPtBr(sourceSegments, clientId) : [];',
  '  const shouldSubtitle = Boolean(found.job.autoSubtitles);\n  const translatedSubtitles = shouldSubtitle\n    ? (isPortugueseLanguage(found.job.detectedLanguage) ? sourceSegments : await translateClipSegmentsToPtBr(sourceSegments, clientId))\n    : [];',
  "subtitle-portuguese-adjust"
);

if (changes !== 8) throw new Error(`unexpected patch count: ${changes}`);
fs.writeFileSync(file, source);
console.log(`Applied ${changes} subtitle fixes to ${file}`);
