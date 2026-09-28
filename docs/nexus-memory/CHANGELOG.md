# Histórico de alterações feitas pelo Work

## 2026-09-28 — diagnóstico objetivo do bloqueio visual (preparado)
- Designer persiste os seis pareceres booleanos quando rejeita uma mídia. Health expõe apenas estado, campos booleanos e indicador da URL antiga corrompida; não expõe imagem, texto livre da avaliação nem credenciais. Necessário para saber por que a nova imagem de Ragnar segue sem aprovação.

## 2026-09-28 — priorizar recuperação de postagem Ragnar vencida (preparado)
- `postingProfile` ignora as três URLs PNG corrompidas também quando gravadas na configuração, permitindo fallback ao JPEG válido. O Creator agora procura uma postagem aprovada e vencida do dia sem imagem antes de distribuir mídia a horários futuros; tenta a antiga imagem bloqueada somente se ela for válida e ainda não tiver sido reavaliada. Mantidos os gates de Copy Chief, Designer e revisão visual.

## 2026-09-28 — trocar mídia Ragnar corrompida (preparado)
- Identificados três PNGs com checksum de IDAT inválido. Adicionado JPEG decodificável derivado de arte própria do usuário. Pool padrão aponta para o novo arquivo; Designer descarta URLs antigas e Creator impede sua reutilização. Mantidos gates e antirrepetição.

## 2026-09-28 — parâmetro OpenAI sanitizado (preparado)
- Falha HTTP agora registra somente `code` e nome do parâmetro estruturado ou categoria fixa. Mensagem livre do provedor não aparece no health, prevenindo vazamento de URLs e dados.

## 2026-09-28 — orçamento de requisições externas (preparado)
- Limitada a três mídias por snapshot a coleta das cinco métricas de insights, preservando os dados básicos de até 25. Executor passa a processar um job por invocação do cron, que roda a cada minuto. Destina-se a ficar abaixo das 50 subrequests externas do plano gratuito mesmo com Radar, Auditor e revisão no mesmo ciclo.

## 2026-09-28 — diagnóstico limitado de revisão antiga (preparado)
- Erros antigos `visual_review_unavailable` com tentativas esgotadas poderão ser diagnosticados uma vez adicional após PR #31, com no máximo uma chamada visual no ciclo e marca persistente. Health passa a mostrar contagem de tentativas e marca diagnóstica sem expor imagem/token.

## 2026-09-28 — limites nas consultas Graph (preparado)
- Acrescentado timeout de 8 segundos nas leituras de mídia, insights e perfil do Radar/Auditor. Essas consultas antes aguardavam rede indefinidamente. Sem alteração no gate visual ou na seleção de posts; efeito em produção ainda não confirmado.

## 2026-09-27 — captação observável (local, aguardando deploy)
- Coleta horária por padrão para Global Play e Ragnar; desligamento explícito preservado. Timeouts Meta e indicadores agregados de captação adicionados ao health. CTA de comentário QUERO em todas as pautas e formato rotulado como imagem real.
- Testes antigos alinhados ao fiscal visual v2; novo teste cobre padrão e opt-out. 15 testes e checagem sintática passaram. Sem postagem ou DM de teste.

## 2026-09-27 — Autorrecuperação de post sem mídia
- Corrigido o Creator para não ignorar um slot diário já existente quando ele está sem mídia.
- Quando surge uma mídia válida no pool, o Creator a vincula ao post incompleto, zera tentativas/erro, redefine os gates como pendentes e devolve o post ao fluxo Copy Chief → Designer → Publisher.
- Validação local aprovada com checagem de sintaxe e bundle Wrangler; aguarda CI/deploy para confirmação em produção.

## 2026-09-27 — Fechamento uniforme do Publisher
- Preparada correção para exigir Copy Chief e Designer aprovados também no envio manual e no `publisher-sweep`, eliminando os dois desvios que podiam contornar os fiscais.
- Limitadas a três as tentativas por post nos três caminhos de publicação; falhas manuais agora incrementam `retryCount`.
- Validação local concluída: `node --check` em todos os módulos do Worker e bundle `wrangler deploy --dry-run` sem erro.
- A correção ainda requer commit, CI/deploy e evidência de produção antes de ser considerada implantada.

## 2026-09-27 — Auditoria inicial
- Identificado repositório operacional `globalplay27/SERVIDOR-GLOBAL-PLAY`, branch `main`, commit `292649157`.
- Conferidos GitHub Actions, health público e diagnósticos públicos.
- Rastreado fluxo de código de cron a Meta e três rotas de publicação.
- Identificada aprovação visual baseada em flags, sem inspeção da imagem, além de caminhos que ignoram gates; limite de retentativas de posts ausente.
- Criada memória permanente de sete documentos, sem mudanças no runtime e sem novas publicações.
- Estado da falha específica do Ragnar continua pendente da leitura de logs/linhas D1 de produção.
- Adicionado `AGENTS.md` na raiz para orientar sessões futuras a ler a memória e registrar resultados; commit `5951333904b076d04a9ca179745fe3f3e868a1e7`, deploy GitHub Actions bem-sucedido.

## 2026-09-27 — Diagnóstico de acesso ao D1
- Criados `.github/workflows/nexus-audit.yml` e `.github/scripts/nexus-audit.mjs`: consultas SELECT, saída reduzida sem legendas, mídia ou tokens, falha explícita quando a leitura falha. Workflow é disparado ao mudar esses dois arquivos e pode ser executado manualmente.
- Teste em [Actions 36321480825](https://github.com/globalplay27/SERVIDOR-GLOBAL-PLAY/actions/runs/36321480825) retornou código Cloudflare `7403` em todas as consultas, nenhuma linha operacional lida. CI/deploy passou. Não houve mudança do Worker, postagens ou permissões.

## 2026-09-27 — Destravamento do agendador/publicador
- Confirmada inundação da fila por `lead-hunter` e jobs presos em `running`.
- Adicionados deduplicação de jobs pendentes, recuperação de execução presa, prioridade de Publisher/ciclo, captação automática opt-in e descarte controlado do backlog desativado.
- Publisher passou a selecionar somente posts com mídia e dois gates aprovados, no máximo um por conta/ciclo; backlog inválido não bloqueia conteúdo válido.
- Horários padrão consolidados em 09:00, 12:00 e 18:00 BRT.
- Publicação real de `@globalplay_streaming` confirmada às 12:21 BRT. Ragnar permaneceu sem publicação porque o conteúdo vencido estava sem mídia e reprovado pelo Designer.
- Rota temporária de diagnóstico sanitizado criada para a investigação e removida ao final.

## 2026-09-27 — Pool de mídia Ragnar
- Geradas e revisadas três imagens 9:16, de cena única e tema nórdico, com TV preenchida, sem texto, logos, colagens ou símbolos esportivos.
- Assets adicionados em `public/assets/ragnar/nordic-cinema-01.png` até `03.png`.
- `postingProfile` passa a fornecer esse pool ao `ragnar-one` quando o painel não possui mídia configurada, preservando URLs personalizadas quando existirem.

## Retomada — 2026-09-27 20h UTC
Preparada fiscalização visual real para Global Play e exigência do parecer nos publicadores principal, manual e sweep. Adicionados seis testes sem rede e timeout de 20s na chamada OpenAI. Mantidas credenciais por cliente, orçamento diário e exclusões de escopo. Nenhuma geração de imagem ou publicação de teste.
