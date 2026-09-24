# Servidor Nexus — Cloudflare

Esta pasta contém a nova infraestrutura do NEXUS para Cloudflare. Ela é preparada e testada em paralelo; o Railway atual continua ativo até o cutover final.

## Arquitetura

- **Worker `servidor-nexus`**: API/orquestração central.
- **D1 `servidor-nexus`**: clientes, estado, sessões, consumo de tokens, tickets e jobs.
- **R2 `servidor-nexus-media`**: vídeos, logos, anexos e mídia.
- **OpenAI compartilhada**: `OPENAI_API_KEY_SHARED` para todos os clientes, exceto Ragnar.
- **OpenAI exclusiva Ragnar**: `OPENAI_API_KEY_RAGNAR` somente para `ragnar-one`.
- **Segredo interno**: `NEXUS_SECRET_KEY` protege APIs administrativas.
- **Master**: `NEXUS_ADMIN_USERNAME` e `NEXUS_ADMIN_PASSWORD` ficam somente em Secrets.
- **Assets**: o Worker serve os painéis atuais diretamente da pasta `public/`, mantendo a interface existente durante a migração.

Nenhuma chave real deve ser salva no GitHub.

## Primeira configuração

Execute a partir desta pasta:

```bash
npm install
npx wrangler login
```

Crie o D1 e peça ao Wrangler para atualizar a configuração com o ID real:

```bash
npx wrangler d1 create servidor-nexus --binding DB --update-config
```

Crie o bucket R2:

```bash
npx wrangler r2 bucket create servidor-nexus-media
```

Configure os Secrets interativamente:

```bash
npx wrangler secret put OPENAI_API_KEY_SHARED
npx wrangler secret put OPENAI_API_KEY_RAGNAR
npx wrangler secret put NEXUS_SECRET_KEY
npx wrangler secret put NEXUS_ADMIN_USERNAME
npx wrangler secret put NEXUS_ADMIN_PASSWORD
```

Aplique o banco:

```bash
npx wrangler d1 migrations apply servidor-nexus --remote
```

Faça o primeiro deploy paralelo:

```bash
npx wrangler deploy
```

## Validação mínima antes da virada

1. `GET /api/health` deve retornar `ok: true`, `database: d1-ready` e `media: r2-bound`.
2. `GET /api/system/openai-routing?clientId=ragnar-one` com Bearer `NEXUS_SECRET_KEY` deve retornar `source: ragnar-exclusive` e `configured: true`.
3. O mesmo endpoint com outro cliente deve retornar `source: shared`.
4. Teste `PUT` e `GET` em `/api/state` para confirmar persistência D1.
5. Só depois portar/apontar o painel e as rotas de cliente para o Worker.

## Regra de cutover

Railway não é desligado durante preparação ou testes. A virada só acontece quando painel, APIs, D1, R2, autenticação e agentes estiverem validados no endereço Cloudflare. Depois do domínio apontado e dos smoke tests aprovados, o Railway pode ser desativado. Consulte `CUTOVER.md`.

## Vídeo

O Worker não deve executar `ffmpeg` nem depender de filesystem persistente. Arquivos ficam no R2; processamento pesado é desacoplado do Worker. Isso evita portar para Cloudflare código que depende de processos do sistema e volume local.


## Estado atual da migração

Já estão preparados no branch `cloudflare-migration`:

- Worker central **Servidor Nexus**;
- D1 para clientes, estado, sessões, consumo, tickets, postagens, vídeos e jobs;
- R2 para mídia;
- roteamento OpenAI por cliente;
- Ragnar integrado ao mesmo núcleo por `clientId=ragnar-one`;
- autenticação Master persistida em D1;
- autenticação de cliente persistida em D1;
- compatibilidade inicial das APIs usadas pelos painéis atuais;
- Static Assets para reutilizar os painéis Master/Cliente existentes sem reconstruí-los;
- Railway continua intocado até o cutover final.

### Limitação importante do plano grátis

O painel, D1, autenticação, APIs leves, R2 e orquestração podem operar no modelo Workers. O processamento pesado de vídeo não deve rodar dentro de um Worker Free: o limite de CPU por invocação é baixo e não existe o mesmo ambiente de processo do Railway para `ffmpeg`/`yt-dlp`. Por isso a migração mantém o fluxo de vídeo desacoplado até a etapa específica de substituição do processador, sem remover o Railway antecipadamente.
