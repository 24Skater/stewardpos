-- Counterpart to the Postgres migration of the same number; see that file.
-- better-sqlite3 ^9 bundles SQLite >= 3.44, so DROP COLUMN (3.35+) is available. None of these
-- columns is in an index, view, trigger, CHECK or foreign key, which is what DROP COLUMN requires.

ALTER TABLE products ADD COLUMN base_price_cents INTEGER NOT NULL DEFAULT 0;
UPDATE products SET base_price_cents = CAST(round(base_price * 100) AS INTEGER) WHERE base_price IS NOT NULL;
ALTER TABLE products DROP COLUMN base_price;

ALTER TABLE product_variants ADD COLUMN price_override_cents INTEGER;
UPDATE product_variants SET price_override_cents = CAST(round(price_override * 100) AS INTEGER) WHERE price_override IS NOT NULL;
ALTER TABLE product_variants DROP COLUMN price_override;
ALTER TABLE product_variants ADD COLUMN price_delta_cents INTEGER;
UPDATE product_variants SET price_delta_cents = CAST(round(price_delta * 100) AS INTEGER) WHERE price_delta IS NOT NULL;
ALTER TABLE product_variants DROP COLUMN price_delta;

ALTER TABLE services ADD COLUMN base_price_cents INTEGER;
UPDATE services SET base_price_cents = CAST(round(base_price * 100) AS INTEGER) WHERE base_price IS NOT NULL;
ALTER TABLE services DROP COLUMN base_price;

ALTER TABLE orders ADD COLUMN subtotal_cents INTEGER NOT NULL DEFAULT 0;
UPDATE orders SET subtotal_cents = CAST(round(subtotal * 100) AS INTEGER) WHERE subtotal IS NOT NULL;
ALTER TABLE orders DROP COLUMN subtotal;
ALTER TABLE orders ADD COLUMN discount_total_cents INTEGER DEFAULT 0;
UPDATE orders SET discount_total_cents = CAST(round(discount_total * 100) AS INTEGER) WHERE discount_total IS NOT NULL;
ALTER TABLE orders DROP COLUMN discount_total;
ALTER TABLE orders ADD COLUMN tax_total_cents INTEGER DEFAULT 0;
UPDATE orders SET tax_total_cents = CAST(round(tax_total * 100) AS INTEGER) WHERE tax_total IS NOT NULL;
ALTER TABLE orders DROP COLUMN tax_total;
ALTER TABLE orders ADD COLUMN total_cents INTEGER NOT NULL DEFAULT 0;
UPDATE orders SET total_cents = CAST(round(total * 100) AS INTEGER) WHERE total IS NOT NULL;
ALTER TABLE orders DROP COLUMN total;
ALTER TABLE orders ADD COLUMN amount_tendered_cents INTEGER;
UPDATE orders SET amount_tendered_cents = CAST(round(amount_tendered * 100) AS INTEGER) WHERE amount_tendered IS NOT NULL;
ALTER TABLE orders DROP COLUMN amount_tendered;
ALTER TABLE orders ADD COLUMN change_given_cents INTEGER;
UPDATE orders SET change_given_cents = CAST(round(change_given * 100) AS INTEGER) WHERE change_given IS NOT NULL;
ALTER TABLE orders DROP COLUMN change_given;

ALTER TABLE order_items ADD COLUMN unit_price_cents INTEGER NOT NULL DEFAULT 0;
UPDATE order_items SET unit_price_cents = CAST(round(unit_price * 100) AS INTEGER) WHERE unit_price IS NOT NULL;
ALTER TABLE order_items DROP COLUMN unit_price;
ALTER TABLE order_items ADD COLUMN line_discount_cents INTEGER DEFAULT 0;
UPDATE order_items SET line_discount_cents = CAST(round(line_discount * 100) AS INTEGER) WHERE line_discount IS NOT NULL;
ALTER TABLE order_items DROP COLUMN line_discount;
ALTER TABLE order_items ADD COLUMN line_total_cents INTEGER NOT NULL DEFAULT 0;
UPDATE order_items SET line_total_cents = CAST(round(line_total * 100) AS INTEGER) WHERE line_total IS NOT NULL;
ALTER TABLE order_items DROP COLUMN line_total;

ALTER TABLE payments ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0;
UPDATE payments SET amount_cents = CAST(round(amount * 100) AS INTEGER) WHERE amount IS NOT NULL;
ALTER TABLE payments DROP COLUMN amount;

INSERT INTO schema_migrations (version, name) VALUES (35, '035_money_cents_orders');
