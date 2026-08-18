-- Counterpart to the Postgres migration of the same number; see that file for
-- why a shift exists at all and why a PIN is not a session.

-- SQLite has no ALTER TABLE ... ADD COLUMN IF NOT EXISTS, so these are written
-- out plainly. The migrator runs each file once, tracked in schema_migrations,
-- so re-running is not a concern.
ALTER TABLE users ADD COLUMN pin_hash TEXT;
ALTER TABLE users ADD COLUMN pin_set_at INTEGER;
ALTER TABLE users ADD COLUMN pin_failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pin_locked_until INTEGER;

-- Unused until manager override lands next phase; see the Postgres file for why
-- it is added here rather than in its own migration.
ALTER TABLE users ADD COLUMN can_override INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS register_shifts (
  id TEXT PRIMARY KEY,

  -- NOT NULL because it leads the partial unique index below; a nullable
  -- column there would make the constraint vacuous.
  register_id TEXT NOT NULL REFERENCES registers(id),
  user_id TEXT NOT NULL REFERENCES users(id),

  started_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),

  -- Idle timeout is measured from here, not from started_at — see the Postgres
  -- file. Every authenticated action on this register bumps it.
  last_activity_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),

  ended_at INTEGER,
  -- signed_out | idle_timeout | superseded | revoked | forced
  end_reason TEXT,

  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_register_shifts_one_open_per_register
  ON register_shifts (register_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_register_shifts_user ON register_shifts (user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_register_shifts_register ON register_shifts (register_id, started_at);

INSERT INTO schema_migrations (version, name) VALUES (18, '018_register_shifts');
