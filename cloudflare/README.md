# Servidor Nexus — Cloudflare

Esta pasta contém o runtime oficial do NEXUS AI.

## Componentes

- Worker `servidor-nexus`: API, autenticação, agentes e orquestração.
- D1 `servidor-nexus`: clientes, sessões, conexões, posts, leads, jobs e estado.
- R2 `servidor-nexus-media`: logos e mídia.
- Cron Triggers: scheduler e filas.
- Static Assets: painéis Master e Cliente.
- GitHub: código-fonte e CI.

## Secrets

Configure valores reais somente no Cloudflare:

```bash
npx wrangler secret put OPENAI_API_KEY_SHARED
npx wrangler secret put OPENAI_API_KEY_RAGNAR
npx wrangler secret put NEXUS_SECRET_KEY
npx wrangler secret put NEXUS_ADMIN_USERNAME
npx wrangler secret put NEXUS_ADMIN_PASSWORD
npx wrangler secret put INSTAGRAM_APP_ID
npx wrangler secret put INSTAGRAM_APP_SECRET
npx wrangler secret put INSTAGRAM_ACCESS_TOKEN_RAGNAR
npx wrangler secret put INSTAGRAM_ACCOUNT_ID_RAGNAR
npx wrangler secret put INSTAGRAM_ACCESS_TOKEN_GLOBALPLAY
npx wrangler secret put INSTAGRAM_ACCOUNT_ID_GLOBALPLAY
```

O OAuth do Instagram grava tokens por cliente no D1 de forma criptografada usando `NEXUS_SECRET_KEY`.

## Banco

```bash
npx wrangler d1 migrations apply servidor-nexus --remote
```

## Validação

```bash
npm install
npm run check
```

## Deploy

```bash
npx wrangler deploy
```

Configuração de produção:

- branch: `cloudflare-migration`
- root directory: `cloudflare`
- Worker: `servidor-nexus`
- D1 binding: `DB`
- R2 binding: `MEDIA`
- Media binding: `VIDEO_MEDIA`

## Regra de arquitetura

O NEXUS não possui runtime alternativo. Código fica no GitHub e toda execução de produção fica no Cloudflare.

Para detalhes, consulte `ARCHITECTURE.md`.

<!-- deploy-sync: live-post-20260925-1 -->

<!-- production-sync: growth-30d-v1 -->
