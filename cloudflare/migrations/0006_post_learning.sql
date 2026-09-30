PRAGMA foreign_keys = ON;

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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
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
  UNIQUE(post_id, checkpoint_hours),
  FOREIGN KEY(post_id) REFERENCES post_ledger(id) ON DELETE CASCADE,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_post_features_client_created
  ON post_features(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_metrics_client_measured
  ON post_metrics(client_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_metrics_post_checkpoint
  ON post_metrics(post_id, checkpoint_hours);
