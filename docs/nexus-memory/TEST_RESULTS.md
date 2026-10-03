# Testes e evidências

## 2026-09-28 — leitura interna da arte Ragnar
- Os sete testes de revisão passaram com ASSETS simulado; chamada externa dentro do Worker retornou `pinned_asset_unavailable` em produção, por isso esta mudança ainda exige validação após deploy.

## 2026-09-28 — arte Ragnar inspecionada
- JPEG extraído de `main`, 900×1125, SHA-256 `93ec7bbe06be6783beb197e1bcfd838ef66064b4fe3f66d9a37a0b7bf7ae68e2`; inspecionado visualmente. Sete testes `visual-review.test.mjs` passaram, incluindo aprovação com bytes idênticos e bloqueio após troca dos bytes mesmo quando existia aprovação anterior. Ainda sem evidência de publicação real.

## 2026-09-28 ~13h BRT — timeout Graph
- PR #32: 15/15 testes locais, `node --check` e `git diff --check` aprovados; CI do PR 36447459567 aprovado. Merge `922c65b`; deploy workflow 36447607442 concluído com sucesso.
- Após deploy, primeira leitura pública ainda mostrou última execução Publisher ~09h44 BRT e jobs em `running`/`stale_running_job_recovered`; consulta posterior ao endpoint expirou em 15 segundos. Não há publicação nova confirmada. A correção do timeout não está validada como solução suficiente.
- PR #31 de diagnóstico de transporte OpenAI permanece separado e aberto nesta observação. Nenhuma postagem de teste ou chamada Meta de publicação foi enviada nesta sessão.

## 2026-09-27 23h BRT — alteração de captação
- Antes: resposta pública de `/api/autonomy-health` mostrou cron saudável, 13 agentes por conta e `leadHunterRuns:0` no tick observado. Não havia resumo público das coletas.
- Local: `node --test cloudflare/test/*.test.mjs` passou 15/15 após atualizar testes antigos para o fiscal visual v2 e o estado atual do Suporte; `node --check` passou em todos os módulos; Wrangler dry-run gerou bundle. Nenhum comentário sintético, publicação ou mensagem Meta foi enviado.
- Pendente: CI/deploy da mudança e verificação da primeira varredura Meta real de cada conta.

| Horário (UTC, 2026-09-27) | Componente | Resultado | Evidência / limite |
|---|---|---|---|
| ~17:48 | Autorrecuperação do Creator | Validação local aprovada | Post diário existente sem mídia passa a receber mídia nova do pool, volta a `ready` e exige nova fiscalização. Sintaxe e bundle Wrangler aprovados; produção ainda não observada. |
| ~17:35 | Política uniforme de publicação | Validação local aprovada | Todos os arquivos `cloudflare/src/*.js` passaram em `node --check`; `npm run check` gerou o bundle Wrangler. Ainda não prova deploy ou execução em produção. |
| ~12:37 | GitHub | Repositório operacional identificado | `SERVIDOR-GLOBAL-PLAY/main@292649157`; estrutura `cloudflare/`. O README do outro `nexus-ai-2.0` o descreve como não migrado. |
| 11:11 (conclusão do run) | CI/deploy | Sucesso | [Actions 36314891089](https://github.com/globalplay27/SERVIDOR-GLOBAL-PLAY/actions/runs/36314891089), inclusive etapa de deploy. Não comprova funcionamento de cron/Meta. |
| 12:38:31 | `GET /health` | HTTP 200 | `ok:true`, runtime Cloudflare, `d1-ready`, `r2-bound`, assets bound, indicadores de chave OpenAI configurada. |
| ~12:39 | `GET /api/portal/diagnostic` | HTTP 200 | `clients:3`, `portalUsers:2`, D1 acessível. Não identifica quais clientes estão online. |
| ~12:39 | `GET /api/master/diagnostic` | HTTP 200 | `masterUsers:1`, credenciais Master configuradas. Não houve login. |
| ~12:42 | Cloudflare Dashboard | Acesso bloqueado | Página `Executando verificação de segurança` / `Confirme que é humano`, persistiu após uma recarga. Nenhuma tentativa de contornar. |
| ~12:40 | Inspeção estática dos gates | Falha de desenho confirmada | `agent-runtime.js:480-493` seta flags; `extended-agents.js:runDesigner` só confere URL/flags; `posts.js:220-291` e `executor.js:runPublisherSweep` não conferem gates. |
| ~12:40 | Inspeção do limite de publicação | Ausente | `agent-runtime.js:520-615` lê `failed` e incrementa `retryCount` sem teto; `executor.js` também relê `failed`. |
| ~12:40 | Postagem real / Meta | Não executada | Pedido expresso de não publicar na primeira auditoria. Falha do Ragnar ainda não localizada em linha/log real. |
| ~12:45 | Documentação e continuidade | Deploy bem-sucedido | Commit `5951333904b076d04a9ca179745fe3f3e868a1e7`, [Actions 36319976227](https://github.com/globalplay27/SERVIDOR-GLOBAL-PLAY/actions/runs/36319976227). Apenas documentos/`AGENTS.md`; cron/Meta não testados. |
| 13:00–13:10 | Leitura D1 via GitHub Actions | Falha | [Execução 36321480825](https://github.com/globalplay27/SERVIDOR-GLOBAL-PLAY/actions/runs/36321480825): código Cloudflare `7403` em consultas somente SELECT; nenhuma linha retornou. Deploy do commit passou. Sem teste de publicação. |
| 15:16–15:23 | Diagnóstico sanitizado pelo Worker | Causa confirmada | Cron ativo; jobs `lead-hunter` por minuto, jobs presos em `running`, dezenas em `scheduled`; Publisher ficava atrás do backlog. Nenhum token, legenda ou URL de mídia foi retornado. |
| 15:21:12 | Publicação Global Play | Sucesso real | `agentcore:globalplay-streaming:2026-09-27:1100` passou a `published`; Publisher registrou 1 publicada, 0 falhas. |
| 15:23 | Fila após correção | Recuperada | Heartbeat continuou a cada minuto, sem novos jobs de captação; somente publicadores antigos em conclusão. Post Ragnar vencido continuou bloqueado por mídia ausente/Designer rejeitado. |
| ~15:28 | Pool de mídia Ragnar | Validado localmente | 3 PNGs RGB 941×1672, proporção vertical próxima de 9:16, arquivos distintos por SHA-256; revisão visual confirmou uma cena, TV preenchida e ausência de texto/colagem. |

Próximo teste necessário: consultas de leitura D1 aos últimos jobs, execuções e posts de cada cliente, mascarando URLs privadas/tokens e registrando IDs, horários, erros e gates. Nenhum teste sintético deve enviar conteúdo à Meta.

## Retomada — 2026-09-27 20h UTC
Retomada: seis testes locais de visão passaram (imagem enviada, reprovação de TV/colagem/marca, JSON inválido, cache/invalidação por URL, backoff/teto de tentativas, barreira nos publicadores). Todos os módulos passaram node --check. GET /health retornou ok/D1/R2. Nenhuma chamada real à Meta/OpenAI foi feita pelos testes. Bundle e deploy devem ser registrados após conclusão.

Bundle Wrangler dry-run aprovado nesta retomada. Testes adicionados ao CI antes do deploy.

## Implantação confirmada — revisão visual Global Play
- Commit `cbe562ced29a3e644104ac64fe816190acf58979`, [CI 36347542955](https://github.com/globalplay27/SERVIDOR-GLOBAL-PLAY/actions/runs/36347542955): seis testes, sintaxe, bundle e etapa de deploy concluídos com sucesso.
- Health após deploy: ok, D1 pronto, R2 e assets vinculados.
- Navegador do portal exibe login, sem sessão autenticada. Execução real do Designer e post_ledger ainda não consultados. Nenhuma postagem de teste disparada.

## 2026-10-02 — estabilidade da área Vídeos
- PR #72: testes de JS/Worker/Node passaram. Primeiro dry-run falhou porque `/portal*` tornava `/portal-login` redundante em `run_worker_first`; a regra duplicada foi removida e o run 37020749427 passou.
- Merge `e824ac47`, run 37020915371: migrations, deploy Cloudflare, verificação do workspace de vídeo, Master e recuperação passaram. O job terminou vermelho apenas em `Verify Nexus production autonomy`, problema já existente e fora deste escopo.
- PR #73, run 37021212788: limite seguro de 90 MB passou em sintaxe, testes e bundle. Merge `ede028ed` implantou com sucesso; a checagem imediata do workspace falhou.
- PR #74, run 37021511042: verificador com retentativas passou nos testes de PR. Merge `3f934cf1` implantou; a checagem pós-deploy ainda falhou. Revisão do script encontrou falso negativo determinístico: com `set -o pipefail`, `printf ... | grep -q` pode falhar quando o grep encerra o pipe cedo. A correção troca pipes por here-strings; precisa ser confirmada no próximo run de `main`.
- Nenhuma postagem Instagram foi usada para testar estas mudanças.

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

