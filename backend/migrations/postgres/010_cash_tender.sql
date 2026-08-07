-- Record what a customer handed over and what they got back.
--
-- A cash sale stored only its total, so the till's expected contents could not
-- be reconstructed and the cashier got no change calculation — they did the
-- arithmetic in their head and the system kept no evidence of it. For a POS
-- whose primary tender is cash that is a daily-use gap, not a nicety.
--
-- Nullable: card and other tenders have no cash to record, and existing orders
-- predate the columns.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_tendered DECIMAL(10, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS change_given DECIMAL(10, 2);

INSERT INTO schema_migrations (version, name) VALUES (10, '010_cash_tender')
ON CONFLICT (version) DO NOTHING;
