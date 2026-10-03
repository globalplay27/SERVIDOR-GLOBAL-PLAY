-- Archive accidental duplicate of the canonical Global Play client.
-- Preserve every historical row; only stop the ghost client from consuming scheduler/agent capacity.
UPDATE clients
SET status='offline',
    config_json=json_set(
      CASE WHEN json_valid(config_json) THEN config_json ELSE '{}' END,
      '$.archivedDuplicateOf','globalplay-streaming',
      '$.agentCore.enabled',json('false')
    ),
    updated_at=CURRENT_TIMESTAMP
WHERE id='global-play-streaming'
  AND EXISTS (SELECT 1 FROM clients WHERE id='globalplay-streaming');

UPDATE scheduled_jobs
SET status='failed',
    last_error='duplicate_client_archived',
    updated_at=CURRENT_TIMESTAMP
WHERE client_id='global-play-streaming'
  AND status IN ('scheduled','running','shadow');
