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
