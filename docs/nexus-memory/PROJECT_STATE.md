# Estado do Nexus 2.0

Atualizado em 2026-09-27, aproximadamente 12:24 BRT. Esta página separa constatação de código, verificação de produção e itens não confirmados.

## Incidente de 2026-09-27 — fila de publicação
- Causa confirmada em produção: jobs `lead-hunter` acumulavam a cada minuto e alguns permaneciam em `running`, mantendo dezenas de itens à frente dos publicadores.
- Correção implantada: um job pendente por tipo/cliente, recuperação de jobs presos, prioridade para Publisher/ciclo central, captação automática opt-in e drenagem da fila antiga sem executar captação desativada.
- Publisher agora ignora o backlog sem mídia/gates e seleciona no máximo um post publicável por conta/ciclo. Horários padrão fixados em 09:00, 12:00 e 18:00 BRT.
- Evidência real: `@globalplay_streaming` publicou com sucesso em 2026-09-27 12:21 BRT; `post_ledger` marcou `published`, sem erro e com execução Publisher `published:1`.
- `@ragnarplay1` não tinha post publicável vencido: o post das 09:00 estava sem mídia e com Designer rejeitado. Nenhuma imagem ruim foi forçada. Há mídia aprovada em agenda futura, mas a qualidade visual continua limitada ao gate superficial já documentado.

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
Obter acesso de leitura autorizado aos registros D1 em produção para `ragnar-one` e `globalplay-streaming`, sem enviar token em conversa. Caminhos: acesso humano ao painel Cloudflare em navegador que passe a verificação, ou uma credencial CI com permissão mínima D1 de leitura para a conta correta. Depois executar novamente o workflow de auditoria e correlacionar jobs, fiscais e postagens. Não aplicar correções de runtime antes da evidência.
