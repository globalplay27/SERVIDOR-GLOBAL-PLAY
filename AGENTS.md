# Nexus 2.0 — instruções para agentes de trabalho

Antes de qualquer alteração, leia integralmente os sete arquivos em `docs/nexus-memory/`:
`PROJECT_STATE.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `KNOWN_ISSUES.md`, `TEST_RESULTS.md`, `NEXT_ACTIONS.md`, `CHANGELOG.md`.

Confira também o commit atual de `main`, o último deploy do GitHub Actions e o estado dos serviços relevantes. Trate registros de produção como fonte para afirmar resultados; documentação e código não são prova de execução.

Trabalhe em sequência: diagnóstico → hipótese → correção pequena → teste → evidência → próximo passo. Evite publicação real para testes; quando indispensável, faça uma única publicação controlada. Não restaurar Railway, Claire/Ragnar independentes, corte/edição de vídeos, trailer, instalador ou upload de logo.

Antes de terminar, atualize os documentos com o que realmente executou, resultados, problemas e o próximo passo exato. Não inclua credenciais, tokens ou segredos.
