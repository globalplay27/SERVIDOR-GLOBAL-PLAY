PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_post_ledger_scheduler
  ON post_ledger(client_id, status, approval_status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_post_ledger_published_updated
  ON post_ledger(client_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_client_kind_status
  ON scheduled_jobs(client_id, kind, status, due_at);

CREATE INDEX IF NOT EXISTS idx_agent_exec_created
  ON agent_executions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_runs_finished
  ON lead_hunter_runs(finished_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_client
  ON leads(client_id);
