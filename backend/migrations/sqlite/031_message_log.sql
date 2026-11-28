-- Counterpart to the Postgres migration of the same number.
CREATE TABLE IF NOT EXISTS message_log (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  template TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'logged', 'suppressed')),
  provider_message_id TEXT,
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_message_log_created ON message_log(created_at DESC);

INSERT INTO schema_migrations (version, name) VALUES (31, '031_message_log');
