PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  instagram_username TEXT,
  instagram_user_id TEXT,
  temperature TEXT NOT NULL DEFAULT 'cold',
  score INTEGER NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'new',
  intent TEXT,
  needs_human INTEGER NOT NULL DEFAULT 0,
  last_message TEXT,
  last_contact_at TEXT,
  source TEXT,
  source_url TEXT,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lead_hunter_runs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  started_at TEXT,
  finished_at TEXT,
  analyzed INTEGER NOT NULL DEFAULT 0,
  new_leads INTEGER NOT NULL DEFAULT 0,
  updated_leads INTEGER NOT NULL DEFAULT 0,
  ignored INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_leads_client_updated ON leads(client_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_leads_client_score ON leads(client_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_lead_runs_client_finished ON lead_hunter_runs(client_id, finished_at);
