# Arquitetura observada

## Captação (mudança local de 2026-09-27)
O scheduler coloca `lead-hunter` no máximo uma vez por cliente, após jobs de publicação/ciclo na prioridade do executor. Para as duas contas autônomas o padrão proposto é coleta de comentários a cada 60 minutos; configurações salvas continuam prevalecendo. O Odin lê os leads salvos no D1. `/api/autonomy-health` passa a expor apenas configuração automática, última execução e contagens agregadas, sem comentários nem identificadores pessoais.

Referência: `globalplay27/SERVIDOR-GLOBAL-PLAY@292649157`. Isto descreve código ativo e deploy confirmado, não uma arquitetura desejada.

1. GitHub `main` aciona `.github/workflows/ci.yml`: checagem de sintaxe, bundle Wrangler e deploy do Worker `servidor-nexus`.
2. `cloudflare/wrangler.jsonc`: Worker com cron `* * * * *`, D1 `DB`, R2 `MEDIA` e assets de `public/`.
3. `src/index.js:scheduled` chama `runSchedulerTick` e `processDueJobs`; scheduler insere `agent-core-cycle` ou `publisher-sweep` em `scheduled_jobs` por cliente online.
4. Executor pega jobs agendados se `CLOUDFLARE_AUTOMATION_ACTIVE=true` e chama `runAgentCoreCycle`. Só códigos/logs D1 demonstrarão execução real e resultado por conta.
5. `agent-runtime.js`: Radar consulta até 25 mídias da Graph API; Estrategista calcula pauta/horários; Creator escreve três rascunhos em `post_ledger`, com legendas/URLs de pool e flags de política visual; `extended-agents.js` revê legenda e flags visuais; Publisher lê posts elegíveis e chama `publisher.js`; Auditor mede curtidas/comentários. Os nomes de agentes representam funções do mesmo Worker, não processos independentes.
   A autorrecuperação preparada em 2026-09-27 também faz o Creator reparar slots existentes sem mídia quando uma nova mídia válida entra no pool, reenviando-os aos gates.
6. `publisher.js`: resolve credenciais por cliente, faz `POST /{igUserId}/media`, consulta processamento e faz `POST /{igUserId}/media_publish`; resultado/erro volta ao `post_ledger` pelo chamador. Há ainda `posts.js:publishPostNow` manual e `executor.js:runPublisherSweep` alternativo, ambos sem gate visual/copy.
   Correção local preparada em 2026-09-27 passa a exigir os dois gates também nesses caminhos e limita retentativas a três; só vale como arquitetura ativa após deploy confirmado.
7. `instagram-credentials.js`: para Ragnar/Global Play, secrets do Worker têm precedência sobre OAuth criptografado no D1. `instagram.js` inicia autorização Instagram e armazena conexão por cliente.
8. `openai.js` disponibiliza `/api/openai/responses`, registro de tokens e limite diário; o ciclo central examinado cria pauta por regras locais e não chama `openAIResponses`. O uso exato em produção requer `token_usage` e outras rotas.
9. `public/` contém painéis. `portal.js` expõe acompanhamento, aprovação, publicação manual e conexão Instagram; `master.js` expõe rotas protegidas e diagnósticos públicos.

Fluxo pretendido no código: cron → `scheduled_jobs` → ciclo central → `post_ledger` → fiscais → Publisher → Meta Graph → `post_ledger`. Lacuna comprovada: fiscal visual verifica declarações e há caminhos alternativos sem fiscal. As rotas antigas e arquivos legados no repositório não são evidência de serviço ativo.

## Retomada — 2026-09-27 20h UTC
Nova inspeção visual preparada: extended-agents → visual-review → openAIResponses (chave do cliente e orçamento diário existentes). Modelo padrão gpt-4.1-mini, resposta estruturada, uma avaliação nova por passagem do Designer, cache por URL, backoff de 30 minutos, até três tentativas por mídia/post. Todos os publicadores exigem parecer correspondente à URL para Global Play. Ragnar permanece no fluxo anterior. URLs revisadas devem ser imutáveis; alteração de bytes na mesma URL não é detectada pelo cache.

## 2026-10-02 — entrega do portal e vídeo do cliente
- `wrangler.jsonc` força `/portal*`, `/client-lite.js` e `/client-lite.css` a executar o Worker antes dos Static Assets. `asset()` devolve esses arquivos com cache desativado, evitando alternância entre shells antigos e novos.
- Upload de mídia do portal usa R2 `MEDIA`; para o vídeo principal o Worker valida até 90 MB e grava `file.stream()` diretamente no bucket. A capa opcional continua com limite separado de 5 MB.
- O render é despachado pelo Worker para `.github/workflows/video-template-render.yml`. O resultado volta ao R2 e é servido como anexo MP4 pela rota do portal.

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

