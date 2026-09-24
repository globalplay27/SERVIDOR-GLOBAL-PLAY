# NEXUS AI App V2

Plataformas suportadas nesta versão:

- Android
- Windows

A versão iOS foi removida do escopo em 24/09/2026.

## Arquitetura

- Um único projeto Flutter para Android e Windows.
- Autenticação pelo backend NEXUS no Cloudflare.
- O app carrega perfil, permissões, biblioteca, pastas, posts, conexões e configurações após o login.
- Busca de trailers com prioridade para trailer oficial dublado em português do Brasil.
- Fluxo de corte com opção de adicionar logo, remover fundo automaticamente, ajustar posição e tamanho.
- Agendamento com geração automática de legenda de postagem, CTA e hashtags.
- Atualizações de regras e recursos preferencialmente no servidor, reduzindo a necessidade de reinstalar o app.

## Distribuição

- Android: APK para instalação direta e AAB para eventual publicação na Play Store.
- Windows: aplicativo executável/instalador com atualização automática.

## Fora de escopo

- iOS / iPhone / iPad.
- Dependências de Apple Developer, TestFlight ou App Store.
