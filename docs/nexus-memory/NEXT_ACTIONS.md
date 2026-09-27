# Próximas ações, em ordem

1. Implantar a autorrecuperação de slots sem mídia e confirmar no D1 que o Creator registrou `repairedIds` antes do próximo Publisher.
1. Subir e validar no CI a política uniforme que exige os dois gates e limita cada post a três tentativas em todos os caminhos de publicação.
2. Confirmar no próximo horário válido (18:00 BRT para Global Play; próxima mídia aprovada para Ragnar) que a fila permanece livre e que não há novo acúmulo de captação.
2. Repor uma fonte sustentável de mídia única para Ragnar. O post vencido das 09:00 estava sem mídia e não deve ser forçado; sem nova mídia o controle de qualidade continuará bloqueando corretamente.
3. Correlacionar uma publicação ruim do Global Play com a linha do ledger, `qualityGates`, origem da imagem, pareceres e rota de envio. Confirmar se houve bypass manual/sweep ou aprovação superficial.
4. Comparar contadores reais de `agent_executions` e heartbeat do scheduler com horários esperados e `token_usage` com rotas OpenAI. Identificar processos não executados e gastos evitáveis.
5. Corrigir **uma causa raiz** por vez, com mudança pequena e teste sem postagem: gate único antes de qualquer Meta API, parecer visual baseado em mídia realmente inspecionada ou revisão humana explícita, falha fechada, limite de tentativas e erro objetivo.
6. Validar com teste interno e logs D1; se indispensável, uma única publicação real controlada. Só então marcar a correção como confirmada.
7. Com publicação e qualidade estáveis, levantar métricas de alcance/interações/frequência e propor experimentos de conteúdo sem promessa de seguidores.

Em toda sessão: ler os sete documentos; revalidar commit/deploy e serviços; atualizar teste, decisão, problema, estado e próximo passo antes de encerrar.
