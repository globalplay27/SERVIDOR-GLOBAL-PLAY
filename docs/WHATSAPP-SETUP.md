# Implantação do Agente WhatsApp

Este módulo adapta apenas o agente de WhatsApp do repositório `asv-digital/bonus-aula-claude-code` para o Nexus 2.0.

## Arquitetura

- Meta WhatsApp Cloud API
- Cloudflare Worker
- Cloudflare D1 para histórico, triagem, rascunhos e log de envio
- OpenAI já existente no Nexus para redigir rascunhos
- nenhuma mensagem é enviada automaticamente

## Endpoint do webhook

```
https://servidor-nexus.diamantehinode2015.workers.dev/api/whatsapp/webhook
```

## Variáveis obrigatórias no Cloudflare

Segredos:
- `WHATSAPP_VERIFY_TOKEN` — texto que você escolhe para verificar o webhook
- `WHATSAPP_ACCESS_TOKEN` — token permanente/system user da Meta
- `WHATSAPP_PHONE_NUMBER_ID` — ID do número do WhatsApp Business
- `WHATSAPP_APP_SECRET` — App Secret do aplicativo Meta

Variáveis normais já definidas pelo projeto:
- `WHATSAPP_CLIENT_ID=globalplay-streaming`
- `WHATSAPP_GRAPH_VERSION=v26.0`
- `WHATSAPP_SEND_LIMIT_PER_HOUR=30`

## Segurança herdada e reforçada

1. envio exige `confirmed=true`
2. limite de 30 envios por hora
3. log persistente no D1
4. webhook POST valida `X-Hub-Signature-256`
5. IA gera apenas rascunho; nunca chama o envio automaticamente

## Rotas internas

Todas, exceto o webhook, exigem autenticação Nexus.

- `GET /api/whatsapp/status`
- `GET /api/whatsapp/inbox`
- `GET /api/whatsapp/messages?phone=55...`
- `GET /api/whatsapp/drafts`
- `POST /api/whatsapp/send`

Exemplo de envio aprovado:

```json
{
  "to": "5521999999999",
  "text": "Mensagem aprovada",
  "confirmed": true,
  "draftId": "opcional"
}
```

## Comportamento

Quando chega mensagem:
1. valida assinatura da Meta;
2. salva histórico no D1;
3. classifica em urgente, lead, cliente, fornecedor, pessoal ou ruído;
4. gera prioridade;
5. cria rascunho curto;
6. aguarda confirmação humana para qualquer envio.
