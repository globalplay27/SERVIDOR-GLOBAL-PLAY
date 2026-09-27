# Decisões e limites

- Fonte operacional identificada em 2026-09-27: `globalplay27/SERVIDOR-GLOBAL-PLAY`, pasta `cloudflare/`. Revalidar GitHub e deploy em toda sessão.
- Manter inteligência/orquestração em um Nexus central com configuração e credenciais por cliente.
- Escopo: autorização Instagram, postagens automáticas, acompanhamento de postagens e desempenho.
- Não restaurar edição/corte de vídeo, trailer, instalador/aplicativo, upload de logo, Railway ou Claire/Ragnar como runtimes paralelos.
- Não fazer publicações repetidas para testar. Priorizar teste local/simulação; uma publicação controlada apenas quando indispensável.
- Custo: verificações determinísticas primeiro; gerar → validar → aprovar/publicar ou reprovar com motivo; limite finito de tentativas; falha terminal registrada.
- Não declarar corrigido com base em commit ou health. Exigir evidência de etapa e resultado em produção.
- Não gravar senhas, tokens ou valores secretos nestes documentos.
- Nesta auditoria não foi tomada decisão de alterar runtime sem examinar as linhas de produção do Ragnar e do post ruim.
- Autorizada em 2026-09-27 a conclusão do ciclo dos agentes no runtime existente. Primeira mudança escolhida: política única, fail-closed, para todos os caminhos de publicação e teto de três tentativas por post.
- A recuperação automática pode preencher somente mídia já autorizada/configurada no pool; não reativar geração paga nem repetir mídia publicada para mascarar falta de conteúdo.
