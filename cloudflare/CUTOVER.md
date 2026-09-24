# Cutover Railway → Cloudflare

Objetivo: ativar o Cloudflare somente depois de validar a nova infraestrutura, mantendo rollback simples.

## Fase A — Preparação paralela

- Manter Railway ativo.
- Criar Worker `servidor-nexus`.
- Criar D1 `servidor-nexus`.
- Criar R2 `servidor-nexus-media`.
- Configurar `OPENAI_API_KEY_SHARED`, `OPENAI_API_KEY_RAGNAR` e `NEXUS_SECRET_KEY` como Secrets.
- Aplicar migrations D1.
- Validar `/api/health`, roteamento OpenAI e persistência D1.

## Fase B — Migração funcional

- Portar clientes e configurações do armazenamento legado para D1.
- Portar sessões/configurações necessárias para o painel.
- Enviar logos, vídeos e anexos necessários para R2.
- Migrar rotas do painel Master e portal do cliente.
- Migrar agentes e tarefas agendadas para modelo compatível com Workers/Cron/Queues.
- Manter Ragnar no mesmo projeto, identificado por `ragnar-one`, usando exclusivamente `OPENAI_API_KEY_RAGNAR`.
- Demais clientes usam `OPENAI_API_KEY_SHARED`.

## Fase C — Teste de pré-produção

Validar no endereço Cloudflare sem alterar o domínio atual:

- login Master;
- login cliente;
- leitura/gravação de cliente;
- biblioteca/mídia R2;
- OpenAI compartilhada;
- OpenAI exclusiva do Ragnar;
- Meta/Instagram;
- jobs/agendamento;
- token dashboard;
- pesquisa e importação de vídeo;
- fluxo de corte sem dependência do filesystem do Worker;
- healthchecks.

## Fase D — Virada

Somente depois de todos os testes acima passarem:

1. Congelar alterações administrativas no Railway por alguns minutos.
2. Executar sincronização final dos dados mutáveis para D1/R2.
3. Apontar domínio/painel para o Worker do Servidor Nexus.
4. Executar smoke tests no domínio real.
5. Confirmar Meta webhooks e callbacks no novo endereço.
6. Manter Railway sem receber tráfego durante uma janela curta de rollback.
7. Desativar Railway apenas depois de confirmar estabilidade.

## Rollback

Se qualquer smoke test crítico falhar antes da desativação definitiva:

- restaurar o apontamento do domínio para o Railway;
- manter Cloudflare em modo de migração;
- corrigir o problema sem perda de dados;
- repetir a Fase D.

## Regra de segurança

Nunca salvar chaves OpenAI, tokens Meta, senhas ou `NEXUS_SECRET_KEY` no GitHub. Valores reais ficam somente em Cloudflare Secrets.
