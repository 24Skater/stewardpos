-- Counterpart to the Postgres migration of the same number.
CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  UNIQUE (org_id, key, channel)
);

INSERT INTO schema_migrations (version, name) VALUES (34, '034_message_templates');
