# NEXUS YouTube Downloader

Microserviço isolado para importar vídeos públicos do YouTube para o NEXUS.

Fluxo:
1. Cloudflare Worker cria o job.
2. Worker chama POST /ingest.
3. Este serviço executa yt-dlp/FFmpeg fora do GitHub Actions.
4. O MP4 é enviado diretamente ao endpoint interno do Worker.
5. O Worker grava o original no R2 e deixa o item aguardando ação do cliente.

Variáveis:
- NEXUS_DOWNLOADER_SECRET
- MAX_VIDEO_MB (padrão 95)
- YOUTUBE_COOKIES_FILE (opcional)
- YOUTUBE_USER_AGENT (opcional)

O endpoint /ingest exige Authorization: Bearer <NEXUS_DOWNLOADER_SECRET>.
