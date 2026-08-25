-- Counterpart to the Postgres migration of the same number; see that file for
-- why the charge is recorded before it is made, and why this is not an order in
-- a pending state.
--
-- `cart_snapshot` is TEXT here rather than JSONB: SQLite has no JSON column
-- type, and the adapter serialises on the way in either way.

CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  org_id TEXT,

  register_id TEXT REFERENCES registers(id),
  cashier_user_id TEXT REFERENCES users(id),
  shift_id TEXT REFERENCES register_shifts(id),

  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD',

  provider TEXT NOT NULL,
  charge_id TEXT,

  status TEXT NOT NULL DEFAULT 'pending',
  failure_reason TEXT,

  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,

  cart_snapshot TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_unreconciled
  ON payment_attempts(status, created_at);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_charge_id
  ON payment_attempts(charge_id);

INSERT INTO schema_migrations (version, name) VALUES (22, '022_payment_attempts');
