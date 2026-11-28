-- T-44: catalog, order and payment money moves from DECIMAL dollars to integer cents (`<col>_cents`).
-- The API still speaks dollars; the adapters convert at the edge with toCents/toDollars.
-- Returns, store credit, drawer, quotes and discounts stay DECIMAL until T-45/T-46.

ALTER TABLE products RENAME COLUMN base_price TO base_price_cents;
ALTER TABLE products ALTER COLUMN base_price_cents TYPE BIGINT USING round(base_price_cents * 100)::bigint;

ALTER TABLE product_variants RENAME COLUMN price_override TO price_override_cents;
ALTER TABLE product_variants ALTER COLUMN price_override_cents TYPE BIGINT USING round(price_override_cents * 100)::bigint;
ALTER TABLE product_variants RENAME COLUMN price_delta TO price_delta_cents;
ALTER TABLE product_variants ALTER COLUMN price_delta_cents TYPE BIGINT USING round(price_delta_cents * 100)::bigint;

ALTER TABLE services RENAME COLUMN base_price TO base_price_cents;
ALTER TABLE services ALTER COLUMN base_price_cents TYPE BIGINT USING round(base_price_cents * 100)::bigint;

ALTER TABLE orders RENAME COLUMN subtotal TO subtotal_cents;
ALTER TABLE orders ALTER COLUMN subtotal_cents TYPE BIGINT USING round(subtotal_cents * 100)::bigint;
ALTER TABLE orders RENAME COLUMN discount_total TO discount_total_cents;
ALTER TABLE orders ALTER COLUMN discount_total_cents DROP DEFAULT;
ALTER TABLE orders ALTER COLUMN discount_total_cents TYPE BIGINT USING round(discount_total_cents * 100)::bigint;
ALTER TABLE orders ALTER COLUMN discount_total_cents SET DEFAULT 0;
ALTER TABLE orders RENAME COLUMN tax_total TO tax_total_cents;
ALTER TABLE orders ALTER COLUMN tax_total_cents DROP DEFAULT;
ALTER TABLE orders ALTER COLUMN tax_total_cents TYPE BIGINT USING round(tax_total_cents * 100)::bigint;
ALTER TABLE orders ALTER COLUMN tax_total_cents SET DEFAULT 0;
ALTER TABLE orders RENAME COLUMN total TO total_cents;
ALTER TABLE orders ALTER COLUMN total_cents TYPE BIGINT USING round(total_cents * 100)::bigint;
ALTER TABLE orders RENAME COLUMN amount_tendered TO amount_tendered_cents;
ALTER TABLE orders ALTER COLUMN amount_tendered_cents TYPE BIGINT USING round(amount_tendered_cents * 100)::bigint;
ALTER TABLE orders RENAME COLUMN change_given TO change_given_cents;
ALTER TABLE orders ALTER COLUMN change_given_cents TYPE BIGINT USING round(change_given_cents * 100)::bigint;

ALTER TABLE order_items RENAME COLUMN unit_price TO unit_price_cents;
ALTER TABLE order_items ALTER COLUMN unit_price_cents TYPE BIGINT USING round(unit_price_cents * 100)::bigint;
ALTER TABLE order_items RENAME COLUMN line_discount TO line_discount_cents;
ALTER TABLE order_items ALTER COLUMN line_discount_cents DROP DEFAULT;
ALTER TABLE order_items ALTER COLUMN line_discount_cents TYPE BIGINT USING round(line_discount_cents * 100)::bigint;
ALTER TABLE order_items ALTER COLUMN line_discount_cents SET DEFAULT 0;
ALTER TABLE order_items RENAME COLUMN line_total TO line_total_cents;
ALTER TABLE order_items ALTER COLUMN line_total_cents TYPE BIGINT USING round(line_total_cents * 100)::bigint;

ALTER TABLE payments RENAME COLUMN amount TO amount_cents;
ALTER TABLE payments ALTER COLUMN amount_cents TYPE BIGINT USING round(amount_cents * 100)::bigint;

INSERT INTO schema_migrations (version, name) VALUES (35, '035_money_cents_orders')
ON CONFLICT (version) DO NOTHING;
