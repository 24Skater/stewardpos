-- Counterpart to the Postgres migration of the same number; see that file.
--
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so this runs once by version and
-- would fail on a re-run — which the migrator prevents by tracking versions.

ALTER TABLE orders ADD COLUMN amount_tendered DECIMAL(10, 2);
ALTER TABLE orders ADD COLUMN change_given DECIMAL(10, 2);

INSERT INTO schema_migrations (version, name) VALUES (10, '010_cash_tender');
