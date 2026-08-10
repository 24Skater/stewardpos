-- Low-stock thresholds.
--
-- A shop had no way to know what to reorder: stock counts were visible per
-- variant, but nothing said which of them were running out, so noticing meant
-- reading the whole catalog.
--
-- The threshold lives on the variant rather than the product because that is
-- where stock lives — a shop can be out of Large while Small is fine.
--
-- NULL means "use the store default", which is configurable in settings, so a
-- shop can change its mind without touching every row.

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS low_stock_threshold INT;

CREATE INDEX IF NOT EXISTS idx_variants_stock ON product_variants(stock);

INSERT INTO schema_migrations (version, name) VALUES (13, '013_low_stock')
ON CONFLICT (version) DO NOTHING;
