-- Counterpart to the Postgres migration of the same number.
CREATE TABLE IF NOT EXISTS sms_consent (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  phone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('opted_in', 'opted_out')),
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (org_id, phone)
);

INSERT INTO schema_migrations (version, name) VALUES (33, '033_sms_consent');
