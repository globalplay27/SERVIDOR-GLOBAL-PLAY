-- NEXUS AI: runtime definitivo GitHub + Cloudflare.
-- Remove metadados legados do Railway sem alterar credenciais Meta/OpenAI.

UPDATE clients
SET config_json = json_remove(
      json_set(
        CASE WHEN json_valid(config_json) THEN config_json ELSE '{}' END,
        '$.runtime', 'cloudflare',
        '$.infrastructure', 'cloudflare'
      ),
      '$.railway',
      '$.railwayProjectId',
      '$.railwayServiceId',
      '$.railwayEnvironmentId',
      '$.agentApiUrl',
      '$.usage.railwayPercent',
      '$.onboarding.railway',
      '$.integrationState.railway'
    ),
    updated_at = CURRENT_TIMESTAMP;
