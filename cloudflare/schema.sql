PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  niche TEXT,
  instagram TEXT,
  status TEXT NOT NULL DEFAULT 'online',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nexus_state (
  namespace TEXT NOT NULL,
  item_key TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(namespace, item_key, client_id)
);

CREATE TABLE IF NOT EXISTS portal_sessions (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT,
  persistent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS token_usage (
  client_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  used_tokens INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0,
  last_model TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(client_id, day_key)
);

CREATE TABLE IF NOT EXISTS agent_executions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  status TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  subject TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS video_jobs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  source_object_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  settings_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_exec_client_created ON agent_executions(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_video_jobs_client_created ON video_jobs(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_client_status ON support_tickets(client_id, status);


CREATE TABLE IF NOT EXISTS post_features (
  post_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'image',
  theme TEXT,
  hook TEXT,
  scene TEXT,
  composition TEXT,
  characters TEXT,
  palette TEXT,
  action TEXT,
  prop TEXT,
  cta TEXT,
  hashtags TEXT,
  scheduled_local_hour INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS post_metrics (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  checkpoint_hours INTEGER NOT NULL,
  measured_at TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  saved INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  total_interactions INTEGER NOT NULL DEFAULT 0,
  watch_time_ms INTEGER,
  profile_visits INTEGER,
  link_clicks INTEGER,
  followers_count INTEGER,
  follower_delta INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(post_id, checkpoint_hours)
);

CREATE INDEX IF NOT EXISTS idx_post_features_client_created ON post_features(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_metrics_client_measured ON post_metrics(client_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_metrics_post_checkpoint ON post_metrics(post_id, checkpoint_hours);


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
