PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portal_users (
  client_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_algo TEXT NOT NULL DEFAULT 'hmac-sha256-v1',
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS master_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS connections (
  client_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  connected_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(client_id, provider),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS post_ledger (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  scheduled_for TEXT,
  scheduled_hour TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  approval_status TEXT NOT NULL DEFAULT 'pending',
  media_id TEXT,
  caption TEXT,
  image_object_key TEXT,
  error TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_folders (
  id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(id, client_id),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_clips (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  source_object_key TEXT,
  output_object_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approval_status TEXT NOT NULL DEFAULT 'pending',
  publish_status TEXT NOT NULL DEFAULT 'draft',
  scheduled_for TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(job_id) REFERENCES video_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  attempts INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_portal_users_username ON portal_users(username);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_client ON portal_sessions(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_connections_client ON connections(client_id, provider);
CREATE INDEX IF NOT EXISTS idx_post_ledger_client_updated ON post_ledger(client_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_video_folders_client ON video_folders(client_id, name);
CREATE INDEX IF NOT EXISTS idx_video_clips_job ON video_clips(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_video_clips_client ON video_clips(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_due ON scheduled_jobs(status, due_at);
