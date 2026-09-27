# Próximas ações, em ordem

1. Resolver acesso de leitura D1: workflow oficial de auditoria retorna Cloudflare `7403` apesar do deploy funcionar. Usar painel Cloudflare com verificação humana concluída pelo proprietário ou credencial restrita D1 de leitura para a conta correta; não transmitir token no chat. Então obter sem acionar agentes: últimas linhas de `scheduled_jobs`, `agent_executions`, `post_ledger`, `nexus_state` e estado da conexão Meta de Ragnar e Global Play. O Dashboard Cloudflare está em verificação humana neste navegador. Não solicitar segredos em chat.
2. Reconstruir para Ragnar a linha do tempo cron → job → Creator → fiscais → Publisher → Graph API → ledger, com o primeiro erro concreto, estado atual da conta e credenciais/ID verificados sem revelar token. Registrar em `KNOWN_ISSUES` e `TEST_RESULTS`.
3. Correlacionar uma publicação ruim do Global Play com a linha do ledger, `qualityGates`, origem da imagem, pareceres e rota de envio. Confirmar se houve bypass manual/sweep ou aprovação superficial.
4. Comparar contadores reais de `agent_executions` e heartbeat do scheduler com horários esperados e `token_usage` com rotas OpenAI. Identificar processos não executados e gastos evitáveis.
5. Corrigir **uma causa raiz** por vez, com mudança pequena e teste sem postagem: gate único antes de qualquer Meta API, parecer visual baseado em mídia realmente inspecionada ou revisão humana explícita, falha fechada, limite de tentativas e erro objetivo.
6. Validar com teste interno e logs D1; se indispensável, uma única publicação real controlada. Só então marcar a correção como confirmada.
7. Com publicação e qualidade estáveis, levantar métricas de alcance/interações/frequência e propor experimentos de conteúdo sem promessa de seguidores.

Em toda sessão: ler os sete documentos; revalidar commit/deploy e serviços; atualizar teste, decisão, problema, estado e próximo passo antes de encerrar.
