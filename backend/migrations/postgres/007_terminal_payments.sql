-- Migration: 007_terminal_payments

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS card_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS card_auth_code TEXT;

CREATE TABLE IF NOT EXISTS terminal_transactions (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at       BIGINT      NOT NULL,
  order_id         UUID        REFERENCES orders(id) ON DELETE SET NULL,
  amount           NUMERIC     NOT NULL,
  currency         TEXT        NOT NULL DEFAULT 'USD',
  provider         TEXT        NOT NULL DEFAULT 'manual',
  reader_id        TEXT,
  charge_id        TEXT        NOT NULL,
  status           TEXT        NOT NULL,
  auth_code        TEXT,
  error_message    TEXT,
  duration_ms      INT
);

CREATE INDEX IF NOT EXISTS idx_terminal_transactions_charge_id
  ON terminal_transactions(charge_id);

CREATE INDEX IF NOT EXISTS idx_terminal_transactions_order_id
  ON terminal_transactions(order_id);

INSERT INTO schema_migrations (version, name) VALUES (7, '007_terminal_payments')
ON CONFLICT (version) DO NOTHING;
