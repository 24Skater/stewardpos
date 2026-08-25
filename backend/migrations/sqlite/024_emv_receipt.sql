-- Counterpart to the Postgres migration of the same number; see that file for
-- which fields the card networks require and why this is a block rather than a
-- column each. TEXT here because SQLite has no JSON column type.

ALTER TABLE orders ADD COLUMN card_receipt TEXT;

INSERT INTO schema_migrations (version, name) VALUES (24, '024_emv_receipt');
