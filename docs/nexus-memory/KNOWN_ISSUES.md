# Problemas conhecidos

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
