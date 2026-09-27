# NEXUS AI 2.0

Painel do cliente para acompanhar postagens, desempenho e autorização do Instagram. O administrador gerencia clientes e automações pelo painel Master.

## Operação

- Runtime: Cloudflare Workers (`cloudflare/src/`), D1 e R2.
- Painel do cliente: `public/portal.html`, `public/client-lite.js` e `public/client-lite.css`.
- Instagram: OAuth oficial no painel, com configuração central no Master.
- Postagens: agenda, aprovação, publicação e histórico no D1.
- Desempenho: dados da última coleta válida da conta profissional no Instagram.

## Validação e publicação

`npm run check` valida o pacote do Worker. A workflow `.github/workflows/ci.yml` publica na Cloudflare após alterações na branch principal.

A antiga pipeline de cortes, trailers e instalação de aplicativo foi removida. Dados já salvos no D1/R2 permanecem guardados; nenhuma migração apaga contas ou arquivos. O serviço legado fora da Cloudflare deve ser desativado somente depois de confirmar a implantação da versão atual.
