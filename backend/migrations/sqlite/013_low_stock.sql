-- Counterpart to the Postgres migration of the same number; see that file.

ALTER TABLE product_variants ADD COLUMN low_stock_threshold INTEGER;

CREATE INDEX IF NOT EXISTS idx_variants_stock ON product_variants(stock);

INSERT INTO schema_migrations (version, name) VALUES (13, '013_low_stock');
