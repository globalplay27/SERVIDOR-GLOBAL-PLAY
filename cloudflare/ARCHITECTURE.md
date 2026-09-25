# NEXUS AI — Arquitetura GitHub + Cloudflare

## Fluxo

GitHub
→ Cloudflare Workers Build
→ Worker `servidor-nexus`
→ D1 / R2 / Cron / Static Assets
→ Meta / Instagram e OpenAI

## Responsabilidades

### GitHub
- fonte oficial do código;
- histórico e rollback;
- CI;
- workflows de build dos aplicativos.

### Cloudflare
- backend;
- autenticação;
- banco D1;
- mídia R2;
- scheduler;
- assets web;
- secrets;
- domínio e edge runtime.

### Meta / Instagram
- OAuth;
- publicação;
- comentários e mensagens conforme permissões concedidas.

### OpenAI
- inteligência dos agentes;
- chave exclusiva do Ragnar quando configurada;
- chave compartilhada para os demais clientes.

## Dados

Nenhum dado operacional depende de filesystem local. Estado persistente vive no D1 e arquivos vivem no R2.

## Clientes

O cliente não cria contas de infraestrutura. O NEXUS administra GitHub e Cloudflare centralmente. O cliente autoriza apenas integrações necessárias ao próprio negócio.

## Regra

Não adicionar runtime paralelo, bridge de hospedagem ou fallback externo sem decisão explícita de arquitetura.
