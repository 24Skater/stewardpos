-- Counterpart to the Postgres migration of the same number; see that file for
-- what each column is for.

CREATE TABLE IF NOT EXISTS cash_drawer_sessions (
  id TEXT PRIMARY KEY,
  opened_by TEXT REFERENCES users(id),
  closed_by TEXT REFERENCES users(id),
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  opening_float REAL NOT NULL DEFAULT 0,
  expected_cash REAL,
  counted_cash REAL,
  variance REAL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open'
);

-- At most one open session at a time. SQLite supports partial indexes, so this
-- is the same guarantee as the Postgres side.
CREATE UNIQUE INDEX IF NOT EXISTS idx_drawer_one_open
  ON cash_drawer_sessions(status) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_drawer_opened_at ON cash_drawer_sessions(opened_at);

INSERT INTO schema_migrations (version, name) VALUES (11, '011_cash_drawer_sessions');
