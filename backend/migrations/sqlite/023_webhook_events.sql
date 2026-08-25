-- Counterpart to the Postgres migration of the same number; see that file for
-- why the primary key is Stripe's event id and why the insert is the check.

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL,

  charge_id TEXT,

  handled_at INTEGER,
  handler_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_charge_id
  ON webhook_events(charge_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_unhandled
  ON webhook_events(received_at);

INSERT INTO schema_migrations (version, name) VALUES (23, '023_webhook_events');
