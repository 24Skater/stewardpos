-- Counterpart to the Postgres migration of the same number; see that file for
-- why a grant is deliberately narrow and why one row serves as both the grant
-- and the audit record.

ALTER TABLE organizations ADD COLUMN drawer_variance_threshold REAL;

CREATE TABLE IF NOT EXISTS register_overrides (
  id TEXT PRIMARY KEY,

  register_id TEXT NOT NULL REFERENCES registers(id),
  shift_id TEXT REFERENCES register_shifts(id),

  approver_user_id TEXT NOT NULL REFERENCES users(id),
  requested_by_user_id TEXT REFERENCES users(id),

  -- discount_approval | drawer_variance | void | no_sale
  action TEXT NOT NULL,

  grant_prefix TEXT NOT NULL,
  grant_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,

  entity TEXT,
  entity_id TEXT,
  before_value TEXT,
  after_value TEXT,
  reason TEXT,

  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_register_overrides_prefix ON register_overrides (grant_prefix);
CREATE INDEX IF NOT EXISTS idx_register_overrides_register ON register_overrides (register_id, created_at);
CREATE INDEX IF NOT EXISTS idx_register_overrides_approver ON register_overrides (approver_user_id, created_at);

INSERT INTO schema_migrations (version, name) VALUES (19, '019_register_overrides');
