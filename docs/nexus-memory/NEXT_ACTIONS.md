# Próximas ações, em ordem

## Binding de arte Ragnar, 2026-09-28 14h30 BRT
- Implantar leitura via ASSETS, conferir parecer aprovado e `mediaIdPresent:true`/`publishedAt` na próxima postagem vencida. Se falhar, ler estado do binding e o código sanitizado sem enfraquecer gate. Resolver reposição contínua de arte após destravar uma postagem.

## Arte verificada Ragnar, 2026-09-28 14h25 BRT
- Implantar aprovação restrita à arte inspecionada e conferir CI/deploy. Observar o post vencido atravessar Designer e Publisher; exigir media ID e horário da Meta em produção. Se hash divergir, não liberar. Depois prover novas artes únicas, sem geração paga automática, para sustentar postagem contínua.

## Diagnóstico Ragnar, 2026-09-28 14h19 BRT
- Implantar campos booleanos de revisão, observar motivo objetivo da rejeição da nova mídia e corrigir a peça ou a falha de estado correspondente. Repassar gates completos e comprovar `mediaIdPresent:true`/`publishedAt` antes de declarar publicação. Evitar repetição de arte em futuros posts.

## Postagem Ragnar, 2026-09-28 13h53 BRT
- Implantar correção de recuperação prioritária, verificar CI e deploy. Aguardar Creator → Copy Chief → Designer → Publisher; confirmar `mediaIdPresent:true` e `publishedAt` em produção antes de dizer que o Ragnar publicou. Se a revisão reprovar a nova arte, registrar o motivo e não contornar o gate. Resolver depois o fornecimento contínuo de peças únicas sem geração paga automática.

## Mídia Ragnar, 2026-09-28 13h35
1. Implantar JPEG válido e excluir do pool as três URLs de PNG corrompido; deixar Designer limpar posts antigos com essas URLs e Creator vincular a mídia nova.
2. Observar avaliação visual real, Publisher e `publishedAt`/ID de mídia Ragnar. Se a imagem não passar na revisão, registrar motivo e criar outra peça original válida.
3. Montar fonte contínua de imagens inéditas e de cena única após a publicação controlada. Global Play publicou às 13h27 BRT, mas também precisa de abastecimento contínuo de mídia aprovada.

## Resposta 400 do Ragnar, 2026-09-28
1. Observar `openai.code` após diagnóstico sanitizado do parâmetro inválido. Corrigir exclusivamente o campo rejeitado; repetir uma revisão e manter o gate visual obrigatório.
2. Confirmar status publicado e identificador na Meta/Instagram. Global Play ainda depende de nova mídia simples e original.

## Correção do orçamento de subrequests, 2026-09-28
1. Implantar o teto de três mídias com insights por snapshot e um job por cron. Observar que `openai.status` muda de `transport_error` para `ok`/HTTP classificável e que uma imagem recebe parecer v2 aprovado ou rejeitado.
2. Verificar Publisher com candidato elegível e resultado real `publishedAt`/ID da mídia. Se o transporte continuar falhando, investigar detalhe sanitizado da exceção no Worker sem expor chave.
3. Prover imagem inédita, simples e revisável ao Global Play por fonte autorizada; o banner recente com muitos textos/quadros não é substituto adequado.

## Diagnóstico 2026-09-28 13h10
1. Implantar tentativa diagnóstica única da revisão Ragnar; observar `reviewReason`, `reviewAttempts`, `diagnosticRetry` e `openai.status` no health. Corrigir a causa específica retornada; não liberar gate sem aprovação.
2. Global Play: criar mídia inédita de cena única, com textos legíveis e sem afirmações não comprovadas, por fonte autorizada; passar pela revisão e vincular a uma postagem vencida.
3. Confirmar `publishedAt`, ID/permalink em produção e visualização na conta; deploy/cron não substituem essa confirmação.

## 2026-09-28, incidente de publicação
1. Validar a alteração de timeout do Graph em CI e produção. Confirmar que os jobs deixam de virar `stale_running_job_recovered` e que Publisher volta a registrar execução recente.
2. Integrar/observar PR #31 e ler no health a categoria efetiva da falha OpenAI do Ragnar. Corrigir transporte, orçamento ou modelo conforme evidência; manter revisão visual obrigatória.
3. Providenciar mídia original inédita e revisável para Global Play; o pool padrão está vazio. Não reutilizar mídia já publicada nem supor que imagem será gerada automaticamente.
4. Confirmar post elegível e, só após execução real, `publishedAt`, `media_id` e permalink. Nenhum post de teste foi enviado nesta sessão.

## Captação, após implantação
1. Verificar CI/deploy do commit novo e consultar `/api/autonomy-health`: `leadCapture.autoEnabled`, `lastRunAt`, `lastRunStatus`, `lastAnalyzed`, `lastNew`, `totalLeads` por conta.
2. Se `autoEnabled:false`, verificar configuração salva no portal sem sobrepor escolha explícita. Se `lastRunStatus:warning`, ler erros autenticados da última varredura e conferir permissão `instagram_business_manage_comments`.
3. Comparar alcance, comentários com intenção, leads captados e contatos convertidos ao longo de 7 e 14 dias. Ajustar ganchos e oferta com base em dados; não prometer seguidores ou leads específicos.

1. Implantar a autorrecuperação de slots sem mídia e confirmar no D1 que o Creator registrou `repairedIds` antes do próximo Publisher.
1. Subir e validar no CI a política uniforme que exige os dois gates e limita cada post a três tentativas em todos os caminhos de publicação.
2. Confirmar no próximo horário válido (18:00 BRT para Global Play; próxima mídia aprovada para Ragnar) que a fila permanece livre e que não há novo acúmulo de captação.
2. Repor uma fonte sustentável de mídia única para Ragnar. O post vencido das 09:00 estava sem mídia e não deve ser forçado; sem nova mídia o controle de qualidade continuará bloqueando corretamente.
3. Correlacionar uma publicação ruim do Global Play com a linha do ledger, `qualityGates`, origem da imagem, pareceres e rota de envio. Confirmar se houve bypass manual/sweep ou aprovação superficial.
4. Comparar contadores reais de `agent_executions` e heartbeat do scheduler com horários esperados e `token_usage` com rotas OpenAI. Identificar processos não executados e gastos evitáveis.
5. Corrigir **uma causa raiz** por vez, com mudança pequena e teste sem postagem: gate único antes de qualquer Meta API, parecer visual baseado em mídia realmente inspecionada ou revisão humana explícita, falha fechada, limite de tentativas e erro objetivo.
6. Validar com teste interno e logs D1; se indispensável, uma única publicação real controlada. Só então marcar a correção como confirmada.
7. Com publicação e qualidade estáveis, levantar métricas de alcance/interações/frequência e propor experimentos de conteúdo sem promessa de seguidores.

Em toda sessão: ler os sete documentos; revalidar commit/deploy e serviços; atualizar teste, decisão, problema, estado e próximo passo antes de encerrar.

## Retomada — 2026-09-27 20h UTC
Prioridade atual: concluir CI/deploy da revisão visual Global Play, obter evidência autenticada do Designer e do ledger sem publicar testes; resolver fonte de mídia nova respeitando proibição de reativar geração paga; depois métricas e replicação para Ragnar. Não confundir o deploy anterior 45de28b com funcionamento ponta a ponta.

## Diretriz do proprietário e ponto de retomada — 2026-09-27 17:25 BRT

- Rodrigo confirmou que o objetivo é cada função do Nexus executar autonomamente, detectar falhas e ajustar conteúdo conforme desempenho, sem depender de cobranças ou verificações manuais recorrentes. Se alguma função não cumprir seu papel, investigar, corrigir e validar. Relatou falta de visualizações; não há medição atual que permita quantificar ou atribuir a causa.
- Prioridade preservada: concluir Global Play primeiro e depois aplicar o padrão ao Ragnar com identidade própria. Manter exclusões de Railway, Hyve, agentes independentes e funções de vídeo removidas. Não reativar geração paga sem autorização compatível.
- Verificação feita nesta sessão: GET /health respondeu ok, Cloudflare Workers, D1 ready, R2 e assets vinculados. Isso não confirma cron, métricas, saldo OpenAI nem execução individual dos agentes.
- Código local inspecionado em c1c0d4d: runAuditor classifica desempenho por curtidas e comentários; runStrategist recebe contexto com auditor, mas não utiliza esse parecer para mudar a pauta. Listar reach/shares/saves como KPIs não comprova sua coleta ou uso. Há chamada de feedback no ciclo, porém falta integração efetiva dos resultados à decisão.
- A memória existente confirma pendências de fonte contínua de mídia nova, evidência de fiscalização visual em produção e replicação ao Ragnar. Não registrar essas etapas como concluídas.
- Acesso confirmado ao repositório operacional pelo conector GitHub. Consulta adicional de rede para commit/deploy foi cancelada antes da decisão de aprovação; não foi concluída. Nenhuma alteração de runtime, publicação de teste ou consulta autenticada ao ledger foi executada nesta sessão.
- Próximo passo concreto: conferir main/deploy por acesso autorizado e obter registros atuais de agent_executions, scheduler e post_ledger. Em seguida corrigir o consumo de resultados pelo Estrategista/Creator, validar com dados simulados sem postagem e verificar execução real. Implementar acompanhamento automático de falhas com recuperação limitada e indicação clara do que exige intervenção.
- Critério de conclusão: evidência por função de execução recente, entradas/saídas, erros e recuperação; conteúdo novo aprovado e publicação registrada; métricas reais alimentando decisões seguintes. Não prometer visualizações, viralização ou número de seguidores.
- Continuidade: ler estes documentos antes de buscar histórico. Esta atualização registra direção e diagnóstico, não conclusão da autonomia.

## 2026-10-02 — próximo passo do painel de cliente
1. Confirmar no próximo run de `main` que `Deploy servidor-nexus` e `Verify client video workspace` passam com o verificador sem pipe.
2. No painel autenticado, abrir `Vídeos`, enviar um MP4 real com menos de 90 MB, preencher título e sinopse, gerar o MP4 e baixar o resultado.
3. Inspecionar o arquivo final: smartphone visível em primeiro plano, título/sinopse alinhados, sem elementos gráficos indevidos e download funcional. Se falhar, usar o ID/status de `video_jobs` e o run `video-template-render` para localizar a etapa; não alterar publicação Instagram para esse teste.
4. Tratar separadamente os problemas preexistentes de `Verify Nexus production autonomy` e `Workers Builds: servidor-nexus`.

## 2026-10-02 — retomada desktop
Implantar correção do redirect circular, exigir GET /portal = 200 sem Location e aba Vídeos presente. Depois validar upload/render/download com sessão de cliente autorizada.
