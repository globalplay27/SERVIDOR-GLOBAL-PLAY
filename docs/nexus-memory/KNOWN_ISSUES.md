# Problemas conhecidos

## 2026-09-28 — três mídias padrão Ragnar inválidas
- `PIL.Image.verify()` falhou nos três PNGs `nordic-cinema-01..03.png` com checksum IDAT inválido. A revisão OpenAI retornou HTTP 400 `invalid_value`; o Publisher não vê candidatos. A substituição por mídia válida do proprietário está preparada, mas post real ainda pendente.
- O novo pool possui só uma mídia inédita confirmada. Depois da primeira publicação, será necessária uma fonte contínua de outras imagens originais; não repetir o mesmo criativo nem liberar revisão.

## 2026-09-28 — resposta 400 na revisão Ragnar
- Reduzido o consumo de requisições externas; status OpenAI mudou de `openai_transport_error` para HTTP 400 `invalid_value` às 16:17:59 UTC. Imagem pública Ragnar respondeu HTTP 200 / image/png a HEAD. O campo rejeitado não é exposto pelo diagnóstico atual; correção preparada para expor apenas parâmetro sanitizado.

## 2026-09-28 — limite de chamadas externas do Worker gratuito
- A revisão visual do Ragnar passou a registrar `openai_transport_error` após o PR #33. O ciclo fazia até 250 consultas de insights para Radar e Auditor juntos, além de outras chamadas; o executor podia executar três jobs na mesma invocação, acima do limite externo de 50 do Worker gratuito. Redução preparada, resultado real ainda pendente.
- Mesmo se a revisão Ragnar passar, Global Play não possui mídia nova válida e não publica até suprir essa dependência.

## 2026-09-28 13h10 — revisão Ragnar esgotada
- PR #31 foi implantado, mas `openai.status: unknown` persistia; imagens de Ragnar continuaram sem parecer aprovado. A lógica anterior vedava diagnóstico adicional ao chegar a três tentativas. Correção limitada a uma nova tentativa por mídia antiga com falha genérica, com `diagnosticRetry` persistido. Resultado real pendente.

## 2026-09-28 — dois bloqueios de publicação
- Health ao vivo às ~12h45 BRT: cron saudável, Publisher das duas contas com última execução ~09h44 BRT, jobs de ciclo recuperados como obsoletos repetidamente. Consultas Graph do Radar/Auditor sem timeout identificadas no código; timeout de 8 segundos preparado, efeito em produção ainda pendente.
- Global Play: posts aprovados sem `imageUrl` e Designer pendente (`designer_replacement_queued`); não há pool padrão Global Play. Correção de timeout não cria mídia.
- Ragnar: imagens presentes, mas parte dos posts tem `visual_review_unavailable` e parte tem Designer aprovado sem parecer v2 correspondente. O publicador exige parecer visual efetivo; investigar razão sanitizada da OpenAI após o PR #31. Não liberar o gate à força.

## Captação de leads ainda sem comprovação ponta a ponta
O health anterior exibia Odin `success`, mas não indicava coleta automática, qualidade do acesso Meta ou leads. A mudança local habilita coleta horária padrão e expõe números agregados; falta observar `lastRunStatus`, `lastAnalyzed`, `lastNew` e `totalLeads` em produção. O coletor contempla comentários recentes da própria conta, não DMs; sem comentários de intenção não pode gerar leads genuínos. Configuração explicitamente desligada no D1 continuará desligada.

## P0 — Ragnar não publica consistentemente
- Causa operacional de fila confirmada e corrigida em 2026-09-27: captação automática inundava a fila e jobs presos impediam o Publisher de avançar.
- O post Ragnar das 09:00 de 2026-09-27 também não era publicável: mídia ausente e Designer rejeitado. O sistema agiu corretamente ao não enviá-lo.
- Hipóteses a verificar com D1/logs: cliente offline, jobs falhos, mídia única indisponível, gates pendentes, secret Meta e IG ID divergentes, token/escopos, erro no container ou publicação, cron não executado.
- Evidência de código: `instagram-credentials.js` prioriza secret Ragnar com ID IG fixo; `agent-runtime.js` bloqueia mídia ausente/repetida; `scheduled_jobs` registra erro. Nenhuma dessas hipóteses equivale ao erro efetivo.
- Nova causa de código corrigida localmente: o Creator ignorava slots já existentes sem mídia; agora reaproveita mídia nova do pool e reabre o fluxo de fiscalização. Permanece aberto até deploy e evidência real.

## P0 — Controle visual deixa passar arte ruim
- Causa de código identificada: `runCreator` grava flags `visualPolicy` sempre verdadeiras; `runDesigner` confere essas flags e presença de URL, não o conteúdo da imagem. `runPublisher` aceita `designer: approved`.
- Caminhos adicionais: `publishPostNow` e `runPublisherSweep` não verificam `qualityGates`.
- Falta correlacionar o post específico por ID e origem para dizer por qual caminho ele passou.

## P1 — Retentativas sem teto
- `runPublisher` incrementa `retryCount` após falha mas seleciona `failed` indefinidamente. `runPublisherSweep` faz o mesmo. O job da fila tem teto de 3, porém isso não limita novas tentativas do post nos ciclos futuros.
- Efeito de custo depende de onde ocorre a falha; a geração atual do ciclo é local, mas chamadas Meta e rotas OpenAI existem.
- Correção local preparada: filtros e bloqueios com teto de três tentativas no Publisher principal, sweep e envio manual. Permanece aberto até CI/deploy e evidência de produção.

## P1 — Evidência de fiscais em produção ausente
- Código registra `agent_executions`; não houve leitura autenticada da tabela nesta sessão. Existência de arquivos e `SKILL.md` não prova execução.
- `COPY CHIEF` valida comprimento/CTA; `DESIGNER` valida metadados; `AUDITOR` compara métricas. Não equiparar estes registros a avaliação visual real.

## P2 — Engajamento baixo
- Relato do proprietário; métricas atuais, alcance, salvamentos, impressões e base comparativa não foram lidos. O Radar do código calcula principalmente curtidas e comentários de até 25 mídias; análise causal pendente de dados.

## Bloqueio de investigação
- `dash.cloudflare.com` neste navegador mostrou verificação humana persistente em 2026-09-27. Conector Cloudflare/D1 não está disponível nesta sessão. Diagnósticos públicos não expõem logs/linhas de posts.
- Contornado apenas durante o incidente por uma rota temporária sanitizada no Worker; rota removida após colher a evidência.

## P0 — Leitura de produção D1 indisponível pelo CI
- Workflow [36321480825](https://github.com/globalplay27/SERVIDOR-GLOBAL-PLAY/actions/runs/36321480825): cada `wrangler d1 execute --remote --json` falhou com código Cloudflare `7403` antes de devolver linhas. CI/deploy passou no mesmo commit. Hipótese principal: token permite Worker deploy, mas não D1 direto, ou conta associada ao token não autoriza D1. Não foi feita alteração de permissão.
- O workflow `nexus-audit.yml` e script executam apenas SELECT, omitem legendas/tokens/URLs, e agora falham corretamente quando as consultas falham. Seu último status vermelho representa ausência de acesso diagnóstico, não um teste do cron/Instagram.

## Retomada — 2026-09-27 20h UTC
Pendências desta retomada: fonte contínua de mídia nova continua ausente; Global Play usa URLs configuradas/rascunhos existentes. Visão real ainda precisa de evidência de execução e saldo disponível. Cache identifica URL, não hash dos pixels. Métricas reais e replicação ao Ragnar não concluídas. Sem acesso autenticado ao D1 nesta sessão.

## 2026-10-02 — painel de vídeos
- Causa de código para uploads locais falharem: frontend e backend impunham 25 MB. Corrigido para 90 MB com streaming R2; ainda falta prova ponta a ponta com um arquivo real autenticado.
- Causa provável para a aba parecer alternar/sumir: rotas do portal e seus assets podiam ser servidas diretamente como Static Assets, fora do Worker. Agora passam por `run_worker_first` e recebem `no-store`; confirmar no navegador do cliente após novo login/reload.
- A checagem externa `Workers Builds: servidor-nexus` já aparecia vermelha no `main` antes destas mudanças. A implantação oficial de `.github/workflows/ci.yml` consegue executar `wrangler deploy`; investigar o build externo separadamente para não confundi-lo com o deploy canônico.
- A checagem `Verify Nexus production autonomy` também já falhava depois de deploys bem-sucedidos e é independente do workspace de vídeos.

## 2026-10-02 — redirecionamento circular do portal confirmado
- Sessão desktop retomou os chats sobre painel do cliente, aba Vídeos e render MP4. Fonte operacional main c664e44a58b695a710df70cac68da35873fa9a69.
- Produção: GET /portal e /portal.html retornaram HTTP 307 Location: /portal; fetch seguindo redirects terminou em redirect count exceeded. /client-lite.js respondeu 200/no-store.
- Run 37022109435: deploy Cloudflare passou, Verify client video workspace falhou. Não era apenas propagação/cache.
- Correção: ASSETS busca /portal, caminho canônico de portal.html, evitando devolver redirect para a própria rota. Cache no-store preservado.
- Validação local: 102/102 testes passaram, incluindo seis testes GET/HEAD para /portal, /portal.html e /login simulando canonicalização Cloudflare. Produção corrigida ainda depende de implantação; upload/render/download autenticados continuam pendentes.


## 2026-10-02 — correção implantada e abertura confirmada
- PR #76 integrada como 27ef7a925d8f6bf735a54268e0d9ab0af70e2574. CI do PR 37087267048 aprovado.
- Run 37087333583: migrations, bundle, deploy Cloudflare e Verify client video workspace passaram. A verificação de autonomia estava em execução na consulta; seu resultado não é prova do fluxo de vídeo.
- Verificação HTTP independente após deploy: /portal, /portal.html e /login responderam 200, sem Location, com no-store, data-tab="videos" e video-job-list presentes.
- A abertura do painel está corrigida. Próximo passo: entrar com sessão de cliente e validar upload de MP4, renderização e download; essas etapas autenticadas não foram executadas nesta sessão.

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

## 2026-10-03 — implantação e teste autenticado
- PR #77 integrada; merge ff0e04f33cdea75746700b4d8bbe5f5c4496413a. Deploy Cloudflare run 37121419546: implantação e verificação da área de vídeos aprovadas. CI: 104 testes e render Linux aprovados.
- Cliente entrou no painel. Gerar novamente em Michael iniciou run 37121597001; render e upload R2 concluídos. Painel exibiu MP4 pronto 100%; download autenticado funcionou (90s, 1080x1920, H264/AAC), decodificação integral sem erro.
- Conferência detectou capa antiga de trailer substituindo pôster oficial. Corrigido em 7e6f18bb4cb3ea24bce09534c02632893a307454: preset Michael sempre usa o pôster oficial verificado. Nova geração run 37121790617 em andamento. Registrar download e inspeção final separadamente.

## 2026-10-03 — ampliação autorizada do modelo
- Proprietário determinou que o modelo seja padrão para todos os próximos filmes e séries; pediu aba de busca YouTube e Reacher como exemplo. Determinou editar a fonte completa, sem corte em 90 segundos.
- Implementados busca assíncrona YouTube via yt-dlp, seleção de catálogo, importação por link, modelo genérico data-driven e duração integral. Upload multipart R2 remove o limite de 95 MiB do resultado.
- Catálogo de séries: TVmaze, elenco real, nota atribuída e sugestões por gênero. Filmes: Apple/iTunes; informações ausentes aparecem como indisponíveis, sem inventar depoimentos/elenco. Michael mantém preset com pôster oficial. Créditos TVmaze CC BY-SA no vídeo.
- Primeiro smoke genérico Reacher detectou sinopse maior que a tela; corrigido trecho legível com reticências. Render real de 3s sem duration explícita preservou 3s. Testes novos de domínio YouTube, seleção exata de catálogo e isolamento multipart passaram.
- Ainda falta CI, implantação e teste autenticado de busca/importação/edição integral Reacher; não considerar essa ampliação concluída apenas pelo código local.


## 2026-10-03 — trailers oficiais em português e WhatsApp
- Pedido expresso: todos os filmes e séries devem usar somente trailers oficiais dublados em português; resultado em inglês foi reportado pelo proprietário.
- Busca ampliada para 20 resultados, filtro exige canal verificado de distribuidor reconhecido e indícios de português; rejeita inglês/legendado. Geração por busca ou link confere idioma do áudio em três amostras via Whisper e interrompe se não confirmado. Prefere faixa de áudio pt quando disponível.
- Campo de WhatsApp e asset oficial Meta adicionados; número salvo por cliente e aplicado nas cinco partes.
- 108 testes Node passaram e sintaxe client-lite aprovada. CI, implantação desta correção e conferência real do áudio ainda pendentes; não afirmar produção validada.
- Continuidade: PR78 já integrou modelo genérico e duração integral; resta concluir biblioteca de vídeos e campanha semanal com publicação automática. Não confundir com campanhas de imagens existentes.



## 2026-10-03 — evidência atual e pendências reais
- PR79 integrada em f229fcaa1cb238492f85ff72e31a4dfd504d4c1d. Run37124002993: deploy e verificação da área de vídeos aprovados. 108 testes Node e 4 testes Python aprovados; render smoke de 91s preservado.
- Ajuste seguinte identifica Prime Video Brasil pelo channel_id UCuNjvqjTzw9LcD9PVpTVWRA, pois yt-dlp retorna channel_is_verified=null para esse canal real. ID confirmado pelo trailer htlUwNs2AjQ publicado em artigo oficial About Amazon Brasil. Run37124467288: deploy e verificação do painel aprovados.
- Busca autenticada Reacher agora mostra trailers do Prime Video Brasil e não os resultados ingleses anteriores. Screenshot salvo em outputs/nexus-busca-oficial-portugues.png. Ainda apareceu um título não correspondente; próximo ajuste deve filtrar correspondência do título consultado sem liberar canais não oficiais.
- Teste real Reacher run37124512978 falhou no download: YouTube pediu Sign in to confirm you are not a bot no GitHub runner. Não houve render nem upload desse job; não afirmar que geração YouTube funciona. Metadados consultados do computador local confirmaram faixa pt e duração122s para htlUwNs2AjQ, mas não comprovam MP4 renderizado.
- Não exportar cookies ou credenciais para contornar o bloqueio. Próximos passos: resolver importação automática com acesso autorizado; conferir idioma real e MP4 completo; implementar botão Enviar para biblioteca e integrar campanha semanal/publicação automática. Usuário pediu agilidade e perguntou o que falta; esses três itens foram informados claramente.


## 2026-10-03 — confirmação do original e validação do painel
Correção incremental sobre main 469eff9. Ingestão utiliza o endpoint existente /ingest do serviço Render; /ingest respondeu 400 invalid_source_url para corpo vazio, confirmando a rota. Falhas de transporte/timeout deixavam jobs em importing 10%; agora persistem failed, liberam token e apresentam erro. Upload e callback verificam HEAD, tamanho e propriedade do objeto R2. Laboratório e render só liberam com original confirmado; ingestão não dispara render automaticamente. Resultado só é ready após confirmação R2. MP4 local exige assinatura ftyp. Estados, isolamento e decisões de postagens preservam campos D1; RADAR corrigido de followersDelta inexistente para followerDelta; ciclo manual usa scheduler existente; métricas ausentes não viram zeros reais.
Evidência local: 113 testes unitários aprovados. Integração HTTP com SQLite real e emulador R2: upload 514422 bytes, render FFmpeg 1080x1920 / 5s, download 1331908 bytes com hash íntegro, acesso sem sessão 401, MP4 falso 415, campanhas por cliente, aprovar/reprovar e ciclo dos 13 agentes aprovados. Dispatch GitHub simulado nesse teste; produção ainda não validada nesta etapa. Novo teste reproduzível scripts/test-client-workspace.mjs integrado no CI Node22. Layout existente preservado; removidas duas decorações sem conteúdo (emoji/círculo).
Próximo passo: CI Linux (bundle local Windows bloqueado por leitura de diretório ancestral), deploy e E2E autenticado em produção. Não afirmar R2 remoto/render remoto comprovados até executar.
