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

## 2026-10-03 — retomada desktop: card ausente no upload direto
- Pedido retomado: Reacher, card inspirado na referência Predador, sem SLIM e menor tempo de preparação; não alterar velocidade/duração.
- main conferido: 0654757da204e603b73cdca13859b9de58bc582e. Painel autenticado mostrou job video_24f685fcd852426a8236038e pronto. Download real: 1080x1920, H.264/AAC, 125.527007s, 29889081 bytes; frame aos 10s sem card. Usuário confirmou Reacher.
- Causa: upload direto não coletava título/sinopse, usando nome UUID do arquivo; workflow permitia sucesso sem card. Correção local exige metadados, reaproveita seleção existente, permite gerar novamente usando original confirmado e rejeita render sem sinopse antes de dispatch.
- Validação: 114/114 testes Node, sintaxe e integração HTTP/SQLite/R2 emulado (oito casos) passaram. Render local completo com card: 1080x1920, 30fps, duração preservada 125.527007s. Isso não comprova implantação nem novo render no R2 remoto.
- PR/deploy e validação autenticada após implantação ainda pendentes. Referência Predador original não está anexada nesta sessão; não afirmar fidelidade exata. Nenhuma postagem Instagram enviada.
