# Testes e evidências

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
