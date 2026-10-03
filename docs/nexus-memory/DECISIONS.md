# Decisões e limites

- 2026-09-27: ligar coleta automática apenas nas duas contas autônomas existentes, em frequência horária e com prioridade inferior ao Publisher; respeitar `autoRun:false` já salvo. Não disparar DMs não solicitadas. Medir alcance, comentários e leads reais antes de atribuir queda de conversão ao criativo.

- Fonte operacional identificada em 2026-09-27: `globalplay27/SERVIDOR-GLOBAL-PLAY`, pasta `cloudflare/`. Revalidar GitHub e deploy em toda sessão.
- Manter inteligência/orquestração em um Nexus central com configuração e credenciais por cliente.
- Escopo: autorização Instagram, postagens automáticas, acompanhamento de postagens e desempenho.
- Não restaurar edição/corte de vídeo, trailer, instalador/aplicativo, upload de logo, Railway ou Claire/Ragnar como runtimes paralelos.
- Não fazer publicações repetidas para testar. Priorizar teste local/simulação; uma publicação controlada apenas quando indispensável.
- Custo: verificações determinísticas primeiro; gerar → validar → aprovar/publicar ou reprovar com motivo; limite finito de tentativas; falha terminal registrada.
- Não declarar corrigido com base em commit ou health. Exigir evidência de etapa e resultado em produção.
- Não gravar senhas, tokens ou valores secretos nestes documentos.
- Nesta auditoria não foi tomada decisão de alterar runtime sem examinar as linhas de produção do Ragnar e do post ruim.
- Autorizada em 2026-09-27 a conclusão do ciclo dos agentes no runtime existente. Primeira mudança escolhida: política única, fail-closed, para todos os caminhos de publicação e teto de três tentativas por post.
- A recuperação automática pode preencher somente mídia já autorizada/configurada no pool; não reativar geração paga nem repetir mídia publicada para mascarar falta de conteúdo.

## Retomada — 2026-09-27 20h UTC
Implementação incremental da visão somente no Global Play, conforme prioridade do proprietário. Não reativada geração paga de imagens. A análise visual usa API e limite diário existentes; falta de saldo/erro impede aprovação e é registrada. Nenhuma postagem de teste disparada.

## 2026-10-02 — decisão atual sobre vídeo no painel
- A instrução antiga de 2026-09-27 para “não restaurar edição/corte de vídeo” não representa mais o escopo atual do painel. Entre 01 e 02/10 o proprietário voltou a solicitar explicitamente a área `Vídeos`, upload local, geração e download do MP4; os commits recentes do `main` implementam esse fluxo. Não remover a aba ou o render por causa daquela decisão histórica.
- Continua proibido reintroduzir Railway. O fluxo de vídeo vigente usa Worker/R2 + GitHub Actions/FFmpeg.
- Limite escolhido para upload principal: 90 MB, abaixo do teto total de 100 MB da requisição no plano Cloudflare Free, para deixar margem a capa e multipart.

## 2026-10-03 — modelo completo Michael, preparado localmente
- Proprietário forneceu nexus-video.mp4 e d508edaee92dab30f7a2e822192dde70.mp4 e pediu as cinco partes do modelo: celular, lançamento/pipoca, elenco, avaliações e filmes parecidos. Confirmou Michael como filme do teste; capa oficial e sinopse dentro do celular; remover Slim e marcas repetidas.
- Causa da capa vazia confirmada no código: /media/library exige sessão de portal, mas o workflow fazia download sem cookies. Preparada rota /api/internal/video-render/poster protegida pelo token do job, com isolamento de cliente e rejeição de traversal.
- Preparado renderizador Python/Pillow/FFmpeg com cinco partes e preset Michael/2026. Pôster oficial de michael.movie; nove retratos e créditos verificados no Rotten Tomatoes; avaliações são sínteses em português de relatos reais, com atribuição; relacionados são sugestões editoriais, não resultados de recomendação automática.
- Celular/mão e pipoca são novos assets gerados pelo ImageGen com referência; composição segue a sequência do modelo, mas não é cópia idêntica quadro a quadro dos elementos gráficos originais. Não afirmar fidelidade exata sem conferência do proprietário.
- Render local real: outputs/michael-modelo-nexus.mp4, 30s, H.264/AAC, 1080x1920, 4687983 bytes. Cinco partes inspecionadas visualmente e decodificação completa sem erro. 102 testes existentes e dois novos testes do callback passaram; sintaxe JS aprovada.
- Primeira renderização foi descartada após sobrescrita concorrente dos PNGs durante leitura FFmpeg; refeita em pasta separada com playlist concat e verificada sem erro.
- Workflow novo seleciona o preset para Michael/2026. Outros títulos seguem o renderizador anterior; ainda não há catálogo automático genérico de elenco, avaliações e relacionados.
- Produção atual main 14a89ab62f793b058dac09c11fa4e9de55e6144a. Nenhuma renderização autenticada R2/GitHub executada nesta sessão; alteração ainda não implantada. Consulta HTTP do host a /health foi recusada com 403 e não é prova de serviço indisponível.
- Próximo passo: publicar a alteração para revisão, validar CI e implantação, depois executar upload -> render -> download autenticado do Michael no painel. Registrar evidência de produção separada do MP4 local.
