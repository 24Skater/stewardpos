-- Cash drawer sessions.
--
-- A shift's worth of cash handling: what was in the till at open, what the
-- system believes should be there now, and what was actually counted at close.
-- Without this a store has no way to reconcile — sales are recorded, but the
-- drawer itself is not, so a shortfall is invisible until the bank deposit
-- disagrees.
--
-- `expected_cash` and `variance` are computed at close and stored rather than
-- derived on read: the sales that fed them can be refunded later, and a
-- reconciliation is a statement about a moment, not a live query.

CREATE TABLE IF NOT EXISTS cash_drawer_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Who opened it, and who closed it (usually but not always the same person).
  opened_by UUID REFERENCES users(id),
  closed_by UUID REFERENCES users(id),

  opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP,

  -- Float placed in the drawer at open.
  opening_float DECIMAL(10, 2) NOT NULL DEFAULT 0,

  -- Filled at close.
  expected_cash DECIMAL(10, 2),
  counted_cash DECIMAL(10, 2),
  -- counted - expected. Negative is a shortfall.
  variance DECIMAL(10, 2),

  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
);

-- At most one open session at a time: two would make "which drawer did this
-- sale go into" unanswerable. Enforced in the database rather than only in the
-- route, so a race cannot open a second.
CREATE UNIQUE INDEX IF NOT EXISTS idx_drawer_one_open
  ON cash_drawer_sessions ((status))
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_drawer_opened_at ON cash_drawer_sessions(opened_at);

INSERT INTO schema_migrations (version, name) VALUES (11, '011_cash_drawer_sessions')
ON CONFLICT (version) DO NOTHING;
