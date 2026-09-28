# Estado do Nexus 2.0

## 2026-09-28 13h10 BRT — confirmação do bloqueio
- Proprietário verificou Instagram sem postagem. Produção às 13h06: Ragnar voltou a completar ciclos e executar Publisher, mas `candidates:0`; mídia presente e revisões `visual_review_unavailable` ou ausentes. Global Play continua com mídia ausente e Publisher sem execução recente.
- PR #31 implantado com diagnóstico de transporte OpenAI. Postagens antigas com três tentativas esgotadas não fazem nova chamada, logo a causa continua `unknown`. Preparada uma única tentativa diagnóstica por mídia antiga com erro genérico, sujeita ao limite de uma chamada visual por ciclo e sem relaxar aprovação.
- Banner recente do Global Play examinado: muitos quadros e textos pequenos, inadequado para contornar a revisão visual. Não foi posto no pool nem publicado.

## 2026-09-28 ~13h BRT — implantação parcial
- PR #32 integrado como `922c65b`; GitHub Actions 36447607442 concluiu deploy com sucesso. Isso limita as chamadas Graph do Radar/Auditor a 8 segundos; primeira leitura do Worker após deploy ainda mostrou Publisher antigo, e uma consulta subsequente expirou. Não declarar publicação restaurada.
- Próximo diagnóstico: observar execução recente de Publisher e falha categorizada da revisão Ragnar após PR #31; prover fonte de mídia original e única Global Play. Manter gates.

## 2026-09-28 12h50 BRT — publicação parada
- Produção: heartbeat do cron atualizado, mas Publisher das duas contas sem nova execução havia cerca de três horas; vários `agent-core-cycle` e `lead-hunter` marcados `stale_running_job_recovered`. Global Play tem posts aprovados sem mídia e `designer_replacement_queued`; Ragnar tem posts com imagem, mas revisão visual indisponível ou parecer ausente. `candidates:0` não significa publicação bem-sucedida.
- Correção preparada nesta sessão: limite de 8 segundos em cada consulta Graph do Radar/Auditor; não altera gates nem envia posts. A hipótese de requisições Graph presas como causa dos jobs longos exige validação após deploy.
- Há PR #31 simultâneo para distinguir falhas de transporte/orçamento OpenAI; ainda não integrado na leitura inicial. Global Play segue sem fonte comprovada de mídia inédita; não reativar geração paga ou repetir imagem usada.

## 2026-09-27 23h BRT — captação de leads (em implantação)
- Produção antes da alteração: `/api/autonomy-health` respondeu cron saudável, 13 agentes vistos nas duas contas e `leadHunterRuns:0` no último minuto. Isso não comprova zero leads totais, apenas ausência de varredura naquele tick.
- Código identificado: Lead Hunter automático desligado por padrão; Odin podia registrar sucesso ao classificar uma lista vazia. A última leitura de produção da configuração efetiva, contagem de leads e erros Meta ainda depende do novo diagnóstico sanitizado.
- Correção local: padrão de varredura horária para `globalplay-streaming` e `ragnar-one`, respeitando desligamento explícito; timeouts nas chamadas Meta; diagnóstico público agregado de execução/volume; CTA de intenção comercial em cada pauta e formato real de imagem.
- Testes locais: 15/15 e sintaxe dos módulos aprovada; bundle Wrangler dry-run aprovado. Deploy e execução real ainda não confirmados neste registro.

Atualizado em 2026-09-27, aproximadamente 12:24 BRT. Esta página separa constatação de código, verificação de produção e itens não confirmados.

## Incidente de 2026-09-27 — fila de publicação
- Causa confirmada em produção: jobs `lead-hunter` acumulavam a cada minuto e alguns permaneciam em `running`, mantendo dezenas de itens à frente dos publicadores.
- Correção implantada: um job pendente por tipo/cliente, recuperação de jobs presos, prioridade para Publisher/ciclo central, captação automática opt-in e drenagem da fila antiga sem executar captação desativada.
- Publisher agora ignora o backlog sem mídia/gates e seleciona no máximo um post publicável por conta/ciclo. Horários padrão fixados em 09:00, 12:00 e 18:00 BRT.
- Evidência real: `@globalplay_streaming` publicou com sucesso em 2026-09-27 12:21 BRT; `post_ledger` marcou `published`, sem erro e com execução Publisher `published:1`.
- `@ragnarplay1` não tinha post publicável vencido: o post das 09:00 estava sem mídia e com Designer rejeitado. Nenhuma imagem ruim foi forçada. Há mídia aprovada em agenda futura, mas a qualidade visual continua limitada ao gate superficial já documentado.
- Em seguida foram adicionadas três mídias verticais próprias para Ragnar em `public/assets/ragnar/`, com cena única, TV preenchida e tema nórdico, sem texto/logos/colagem. O perfil Ragnar usa esse conjunto como pool padrão quando não há URLs configuradas no painel.

## Confirmado funcionando
- Workflow GitHub Actions [36314891089](https://github.com/globalplay27/SERVIDOR-GLOBAL-PLAY/actions/runs/36314891089) terminou com sucesso, inclusive a etapa `Deploy servidor-nexus to Cloudflare` para o commit citado.
- `GET /health` respondeu 200 em 2026-09-27 12:38:31 UTC: Worker, D1, R2 e assets disponíveis; indicador de chave OpenAI compartilhada e Ragnar = configurada (sem teste de chamada).
- `GET /api/portal/diagnostic`: D1 acessível, 3 clientes e 2 usuários de portal. `GET /api/master/diagnostic`: D1 acessível, 1 usuário Master e credenciais Master configuradas. Não são provas de login funcional, conexão Meta, cron ou publicação.
- Há rotas de OAuth Instagram, cron, ledger de posts e publicação implementadas no repositório operacional.

## Quebrado ou insuficiente conforme código
- Fiscal visual aprova flags declaradas pelo Creator; não examina pixels da mídia. Uma imagem ruim pode receber `designer: approved`.
- `posts.js:publishPostNow` e `executor.js:runPublisherSweep` não exigem os dois pareceres `qualityGates` antes da Meta API. `agent-runtime.js:runPublisher` exige, mas confia no parecer superficial do Designer.
- Post `failed` é elegível em ciclos posteriores sem limite de `retryCount` no Publisher; o sweep também seleciona `failed`.
- Declarações de `format: reel/carousel/story` no Creator são publicadas com `publishInstagramImage`; rótulos de formato não comprovam formato entregue.

## Infraestrutura atual
- Fonte operacional: [globalplay27/SERVIDOR-GLOBAL-PLAY](https://github.com/globalplay27/SERVIDOR-GLOBAL-PLAY), branch `main`, diretório `cloudflare/`.
- Worker `servidor-nexus` em `https://servidor-nexus.diamantehinode2015.workers.dev`; D1 `servidor-nexus`; R2 `servidor-nexus-media`; cron configurado para cada minuto; GitHub Actions CI/deploy.
- `globalplay27/nexus-ai-2.0` é outro repositório: seu README o descreve como construção separada e diz que o Nexus atual não seria alterado até migração. Não confundir com runtime ativo.
- O repositório operacional ainda contém artefatos legados como `server.js`, `render.yaml` e `services/youtube-downloader`. Sua presença não comprova execução. Não reativar Railway.

## Contas integradas
- Código e migração semeiam `ragnar-one` / `@ragnarplay1` e `globalplay-streaming` / `@globalplay_streaming`. D1 reporta 3 clientes, mas seus IDs e status atuais não foram lidos. Tokens, escopos, validade, identidade Meta e publicação de cada conta permanecem não confirmados.
- Para Ragnar, `instagram-credentials.js` prefere secret do Worker e usa ID IG fixado no código; para Global Play prefere secrets. OAuth em D1 é fallback. Essa prioridade deve ser comparada com as conexões reais.

## Último teste e resultado confirmado
- 2026-09-27 13:10 UTC: [auditoria de leitura D1](https://github.com/globalplay27/SERVIDOR-GLOBAL-PLAY/actions/runs/36321480825) falhou antes de retornar qualquer linha; resposta estruturada da Cloudflare com código `7403`. O CI/deploy do mesmo commit passou. Código 7403 aponta para conta inválida ou não autorizada para esse serviço; o token de deploy não comprova permissão de leitura D1.
- O health e os diagnósticos públicos continuam provando Worker/D1 acessíveis; a leitura temporária do Worker confirmou a fila e uma publicação real posterior confirmou o caminho até a Meta para Global Play. Para Ragnar, a ausência de mídia publicável foi confirmada, mas a próxima publicação válida ainda precisa ser observada.
- Uma rota temporária e sanitizada do próprio Worker permitiu ler o estado operacional sem tokens, legendas ou URLs; ela foi removida após a investigação.

## Próximo passo exato
Implantar a autorrecuperação do Creator e observar se os posts incompletos do Ragnar recebem as novas mídias e atravessam Copy Chief → Designer → Publisher. Depois obter leitura autorizada dos registros D1 para correlacionar jobs, fiscais, publicações e métricas das duas contas.

## Retomada — 2026-09-27 20h UTC
Retomada em 27/09/2026: main 45de28b; CI/deploy 36338210500 concluído com sucesso. Health atual responde ok/D1/R2. Correção preparada: inspeção real da imagem para Global Play, bloqueio uniforme nos três publicadores, cache por URL e até três tentativas. Sem chamada real de visão nem consulta autenticada ao ledger nesta sessão; execução em produção ainda não comprovada.

## Implantação observada — 2026-09-27 23:12 BRT
- PR #25 integrado em `main` (merge `252d5bb93bcb4ecff8442aa4b5908be113a77568`). Workflow 36368885402 aprovou testes, bundle, deploy Cloudflare e verificação pública de autonomia.
- `/api/autonomy-health` após deploy: cron saudável, `leadHunterRuns:2` naquele tick; Global Play e Ragnar com `leadCapture.autoEnabled:true`, última varredura `success`, `lastAnalyzed:0`, `lastNew:0`, `totalLeads:0`. Portanto a coleta opera, mas não encontrou comentários utilizáveis; não há lead captado. A causa da ausência de interações exige métricas de alcance e conversão antes de atribuição.
- O teste demonstra coleta de comentários, não leitura de DMs, respostas automáticas nem geração de nova mídia. Próximo passo: analisar alcance, comentários e criativos por publicação e habilitar um funil de resposta aos contatos recebidos com rastreio de conversão.
