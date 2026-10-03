// A database key alone is not proof that the uploaded source exists.
export async function confirmedVideoSource(env, clientId, key, expectedSize = 0) {
  if (!env.MEDIA) throw new Error("r2_unavailable");
  const value = String(key || "");
  const client = String(clientId);
  const safeClient = client.replace(/[^a-zA-Z0-9_-]+/g, "-");
  if (!value || value.includes("..") || !(
    value.startsWith("library/" + client + "/") ||
    value.startsWith("videos/" + safeClient + "/sources/")
  )) throw new Error("video_source_missing");
  const object = await env.MEDIA.head(value);
  if (!object || !Number(object.size)) throw new Error("video_source_missing");
  if (expectedSize && Number(object.size) !== Number(expectedSize)) throw new Error("video_source_size_mismatch");
  if (!/^video\/(mp4|webm|quicktime)$/.test(object.httpMetadata?.contentType || "")) throw new Error("video_source_invalid");
  if (object.customMetadata?.clientId && object.customMetadata.clientId !== client) throw new Error("video_source_invalid");
  return object;
}

export function isMp4Header(bytes) {
  const data = new Uint8Array(bytes);
  return data.length >= 12 && String.fromCharCode(...data.slice(4, 8)) === "ftyp";
}

export const videoErrorMessages = {
  r2_unavailable: "O armazenamento R2 está indisponível. Tente novamente.",
  video_source_missing: "O vídeo original não foi confirmado no R2. Envie um arquivo válido antes de abrir o Laboratório.",
  video_source_invalid: "O arquivo original não é um vídeo válido para esta conta.",
  video_source_size_mismatch: "O arquivo salvo está incompleto. Envie o vídeo novamente.",
  youtube_downloader_not_configured: "O importador do YouTube não está configurado. Use Enviar arquivo.",
  youtube_downloader_timeout: "O importador não respondeu no prazo. Use Enviar arquivo ou tente novamente.",
  youtube_downloader_transport_failed: "Não foi possível conectar ao importador. Use Enviar arquivo.",
  youtube_downloader_invalid_response: "O importador não confirmou o recebimento do trabalho.",
  youtube_ingest_timeout: "A importação não confirmou o MP4 no R2 dentro do prazo. Use Enviar arquivo.",
  youtube_download_blocked: "O YouTube bloqueou o download automático. Envie o MP4 original pela opção Enviar arquivo.",
  youtube_download_failed: "O download do YouTube falhou. Envie o MP4 original pela opção Enviar arquivo.",
  video_render_in_progress: "Este vídeo já está em processamento. Aguarde o resultado.",
  video_render_timeout: "A geração não concluiu no prazo e foi marcada como falha. Tente gerar novamente."
};
