# Nexus 2.0 — instruções para agentes de trabalho

Antes de qualquer alteração, leia integralmente os sete arquivos em `docs/nexus-memory/`:
`PROJECT_STATE.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `KNOWN_ISSUES.md`, `TEST_RESULTS.md`, `NEXT_ACTIONS.md`, `CHANGELOG.md`.

Confira também o commit atual de `main`, o último deploy do GitHub Actions e o estado dos serviços relevantes. Trate registros de produção como fonte para afirmar resultados; documentação e código não são prova de execução.

Trabalhe em sequência: diagnóstico → hipótese → correção pequena → teste → evidência → próximo passo. Evite publicação real para testes; quando indispensável, faça uma única publicação controlada. Não restaurar Railway, Claire/Ragnar independentes, corte/edição de vídeos, trailer, instalador ou upload de logo.

Antes de terminar, atualize os documentos com o que realmente executou, resultados, problemas e o próximo passo exato. Não inclua credenciais, tokens ou segredos.

## Continuidade entre chat, Work e voz

Diretriz expressa de Rodrigo em 2026-09-27: registrar na memória permanente todas as conversas sobre o Nexus, sejam de chat, Work ou voz. Preservar pedidos, decisões, correções, resultados comprovados, pendências e próximo passo, com data e sem segredos. Registrar mesmo quando não houver mudança no código. Não tratar planos como ações concluídas.

No início de cada sessão com acesso ao projeto, consultar esta memória; antes de encerrar, atualizar os arquivos pertinentes em docs/nexus-memory. Quando a sessão não tiver acesso para ler ou gravar, informar a limitação e não afirmar que houve sincronização. Esta instrução não cria integração automática entre produtos nem acesso a conversas que não estejam disponíveis.
