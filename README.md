# NEXUS AI — Agent Central

Central multiagente para implantação e operação de automações de Instagram por cliente.

## Arquitetura atual

O NEXUS mantém seis agentes operacionais:

- **RADAR** — pesquisa, sinais, outliers e auditoria de perfil.
- **ESTRATEGISTA** — transforma sinais, nicho, histórico e leads em plano editorial.
- **CREATOR** — cria pautas, ganchos, legendas, Reels, Stories, carrosséis e reaproveitamento.
- **PUBLISHER** — agenda, publica, controla retries e registra resultado.
- **AUDITOR** — revisa qualidade, linguagem e desempenho pós-publicação.
- **ODIN** — classifica comentários/DMs/leads e alimenta vendas e conteúdo.

Os 13 especialistas de Instagram foram incorporados como habilidades desses seis agentes:
`ig-viral`, `ig-audit`, `ig-profile`, `ig-plan`, `ig-reel`, `ig-caption`,
`ig-carousel`, `ig-story`, `ig-repurpose`, `ig-human`, `ig-comment`,
`ig-reply` e `ig-dm`.

## Recursos principais

- Painel MASTER e portal separado do cliente.
- Cadastro de clientes e nichos.
- Instagram OAuth e publicação via Meta.
- Agent Core com histórico de execuções.
- Odin / Leads.
- Agenda e fila de publicações.
- Vídeo IA com transcrição completa antes do corte.
- Seleção dos melhores momentos com IA — sem fallback silencioso para os primeiros segundos.
- Cortes com duração alvo e preservação do final natural da fala.
- Biblioteca, aprovação, favoritos e agendamento de cortes.
- Busca de trailers de filmes e séries, priorizando trailer oficial.
- Persistência em volume Railway.
- CI de sintaxe no GitHub antes/depois das mudanças.

## Regra do vídeo inteligente

Se transcrição ou seleção por IA falhar, o NEXUS deve informar a falha. Ele não deve entregar um corte técnico ou simplesmente pegar o início do vídeo como se tivesse sido escolhido por IA.

## Identidade e compatibilidade

A plataforma é **NEXUS AI**. A marca **Global Play** continua existindo como cliente/negócio dentro da plataforma e não deve ser renomeada para NEXUS.

Por compatibilidade, o repositório e URLs antigos podem continuar com nomes históricos enquanto integrações externas forem migradas com segurança.

## Railway

- Node.js 20+
- Volume persistente em `/data`
- Início: `npm start`
- Healthcheck: `/api/portal/diagnostic`

## Licenças de terceiros

Consulte `THIRD_PARTY_NOTICES.md`.
