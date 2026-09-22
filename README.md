# Global Play Agent Central — V1

Central em modo escuro para organizar implantação e administração de agentes de clientes.

## O que já existe nesta V1

- Dashboard administrativo.
- Cadastro de clientes.
- Ragnar incluído como cliente-modelo.
- Onboarding com GitHub, Railway, OpenAI, Instagram, Facebook Business e Meta.
- Biblioteca de temas visuais.
- Escolha de cor/tema pelo cliente.
- Upload local de banner de referência para pré-visualização.
- Área Odin / Leads.
- Gráfico de leads.
- Área de consumo OpenAI e Railway.
- Alertas visuais de consumo alto.
- Persistência simples em JSON.
- Login administrativo via Basic Auth.
- Pronto para Railway.
- Interface responsiva.

## Importante

Esta é a base funcional da Central. A automação de autorização das contas via OAuth
(GitHub/Railway) será a próxima fase. O cliente não deve fornecer senha, e-mail ou código 2FA
para a Global Play. A integração correta é autorização OAuth/API com permissões explícitas.

A Meta/Facebook continuará com uma etapa acompanhada pela Global Play, como planejado.

## Como subir no GitHub

1. Crie um repositório novo, por exemplo: `globalplay-agent-central`.
2. Extraia este ZIP.
3. Envie TODO o conteúdo da pasta para a raiz do repositório.
4. Não envie um arquivo `.env` com chaves reais.
5. Conecte esse repositório a um projeto Railway.

## Variáveis no Railway

Configure:

- `ADMIN_PASSWORD` = senha forte para entrar na Central.
- `DATA_DIR` = `/data`

Depois adicione um Volume no Railway montado em `/data`.

As seguintes variáveis ficam vazias por enquanto e serão usadas na fase de integrações:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `RAILWAY_API_TOKEN`
- `OPENAI_ADMIN_KEY`

## Execução local

Node.js 20+:

```bash
npm start
```

Abra:

`http://localhost:3000`

Na primeira chamada da API o navegador pedirá a senha administrativa.

## Próximas fases já previstas

1. OAuth GitHub: cliente autoriza, Central cria/configura repositório.
2. Railway: criação e administração do projeto sem pedir senha do cliente.
3. Geração automática do pacote Agent Core por nicho/configuração.
4. Sincronização real do Odin de cada cliente.
5. Métricas reais de consumo quando a API do provedor permitir.
6. Alertas de saldo/limite.
7. Atualização em massa do Agent Core.
8. Portal separado do cliente e painel Master Global Play.
