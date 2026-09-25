# NEXUS AI

Central multiagente para automação, conteúdo, leads, atendimento e publicação no Instagram.

## Arquitetura oficial

O NEXUS AI opera somente com:

- **GitHub** — código-fonte, histórico, revisão e CI.
- **Cloudflare Workers** — backend e APIs.
- **Cloudflare D1** — clientes, sessões, configurações, filas, histórico e estado dos agentes.
- **Cloudflare R2** — logos, mídia e arquivos.
- **Cloudflare Cron Triggers** — scheduler e rotinas automáticas.
- **Cloudflare Static Assets** — painéis Master e Cliente.
- **Meta / Instagram OAuth** — autorização das contas de Instagram.
- **OpenAI API** — inteligência dos agentes, com roteamento por cliente.

Não existe runtime secundário. Não existe fallback para outro provedor de hospedagem.

## Agentes

- **RADAR** — pesquisa, sinais, outliers e auditoria de perfil.
- **ESTRATEGISTA** — plano editorial e estratégia.
- **CREATOR** — pautas, ganchos, legendas e conteúdo.
- **PUBLISHER** — agenda, publicação, retries e confirmação.
- **AUDITOR** — qualidade e desempenho.
- **ODIN** — comentários, DMs, leads e qualificação.

## Aplicativos

Os aplicativos Windows, Android e o painel Web usam o mesmo backend Cloudflare.

O cliente não configura infraestrutura. Ele recebe acesso ao NEXUS e autoriza apenas as integrações necessárias ao negócio, como Instagram.

## Produção

A branch de produção atual é `cloudflare-migration`.

O deploy do Worker usa:

```bash
cd cloudflare
npm install
npx wrangler deploy
```

Consulte `cloudflare/README.md` e `cloudflare/ARCHITECTURE.md`.

## Segurança

Nunca salve tokens, senhas, App Secrets ou chaves de API no GitHub. Credenciais reais ficam em Cloudflare Secrets ou, quando são específicas de um cliente, criptografadas no D1 pelo NEXUS.
