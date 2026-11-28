-- Counterpart to the Postgres migration of the same number; see that file.
-- better-sqlite3 ^9 bundles SQLite >= 3.44, so DROP COLUMN (3.35+) is available. None of these
-- columns is in an index, view, trigger, CHECK or foreign key, which is what DROP COLUMN requires.

ALTER TABLE quotes ADD COLUMN subtotal_cents INTEGER NOT NULL DEFAULT 0;
UPDATE quotes SET subtotal_cents = CAST(round(subtotal * 100) AS INTEGER) WHERE subtotal IS NOT NULL;
ALTER TABLE quotes DROP COLUMN subtotal;
ALTER TABLE quotes ADD COLUMN tax_total_cents INTEGER DEFAULT 0;
UPDATE quotes SET tax_total_cents = CAST(round(tax_total * 100) AS INTEGER) WHERE tax_total IS NOT NULL;
ALTER TABLE quotes DROP COLUMN tax_total;
ALTER TABLE quotes ADD COLUMN total_cents INTEGER NOT NULL DEFAULT 0;
UPDATE quotes SET total_cents = CAST(round(total * 100) AS INTEGER) WHERE total IS NOT NULL;
ALTER TABLE quotes DROP COLUMN total;

ALTER TABLE quote_items ADD COLUMN unit_price_cents INTEGER NOT NULL DEFAULT 0;
UPDATE quote_items SET unit_price_cents = CAST(round(unit_price * 100) AS INTEGER) WHERE unit_price IS NOT NULL;
ALTER TABLE quote_items DROP COLUMN unit_price;
ALTER TABLE quote_items ADD COLUMN line_total_cents INTEGER NOT NULL DEFAULT 0;
UPDATE quote_items SET line_total_cents = CAST(round(line_total * 100) AS INTEGER) WHERE line_total IS NOT NULL;
ALTER TABLE quote_items DROP COLUMN line_total;

ALTER TABLE discount_types ADD COLUMN discount_value_scaled INTEGER NOT NULL DEFAULT 0;
UPDATE discount_types SET discount_value_scaled = CAST(round(discount_value * 100) AS INTEGER) WHERE discount_value IS NOT NULL;
ALTER TABLE discount_types DROP COLUMN discount_value;
ALTER TABLE discount_types ADD COLUMN min_purchase_cents INTEGER DEFAULT 0;
UPDATE discount_types SET min_purchase_cents = CAST(round(min_purchase * 100) AS INTEGER) WHERE min_purchase IS NOT NULL;
ALTER TABLE discount_types DROP COLUMN min_purchase;
ALTER TABLE discount_types ADD COLUMN max_discount_cents INTEGER;
UPDATE discount_types SET max_discount_cents = CAST(round(max_discount * 100) AS INTEGER) WHERE max_discount IS NOT NULL;
ALTER TABLE discount_types DROP COLUMN max_discount;
ALTER TABLE discount_types ADD COLUMN approval_threshold_cents INTEGER;
UPDATE discount_types SET approval_threshold_cents = CAST(round(approval_threshold * 100) AS INTEGER) WHERE approval_threshold IS NOT NULL;
ALTER TABLE discount_types DROP COLUMN approval_threshold;

ALTER TABLE promo_codes ADD COLUMN discount_value_scaled INTEGER NOT NULL DEFAULT 0;
UPDATE promo_codes SET discount_value_scaled = CAST(round(discount_value * 100) AS INTEGER) WHERE discount_value IS NOT NULL;
ALTER TABLE promo_codes DROP COLUMN discount_value;
ALTER TABLE promo_codes ADD COLUMN min_purchase_cents INTEGER DEFAULT 0;
UPDATE promo_codes SET min_purchase_cents = CAST(round(min_purchase * 100) AS INTEGER) WHERE min_purchase IS NOT NULL;
ALTER TABLE promo_codes DROP COLUMN min_purchase;
ALTER TABLE promo_codes ADD COLUMN max_discount_cents INTEGER;
UPDATE promo_codes SET max_discount_cents = CAST(round(max_discount * 100) AS INTEGER) WHERE max_discount IS NOT NULL;
ALTER TABLE promo_codes DROP COLUMN max_discount;

ALTER TABLE employee_discounts ADD COLUMN max_discount_amount_cents INTEGER;
UPDATE employee_discounts SET max_discount_amount_cents = CAST(round(max_discount_amount * 100) AS INTEGER) WHERE max_discount_amount IS NOT NULL;
ALTER TABLE employee_discounts DROP COLUMN max_discount_amount;
ALTER TABLE employee_discounts ADD COLUMN current_month_usage_cents INTEGER DEFAULT 0;
UPDATE employee_discounts SET current_month_usage_cents = CAST(round(current_month_usage * 100) AS INTEGER) WHERE current_month_usage IS NOT NULL;
ALTER TABLE employee_discounts DROP COLUMN current_month_usage;
ALTER TABLE employee_discounts ADD COLUMN requires_manager_approval_above_cents INTEGER;
UPDATE employee_discounts SET requires_manager_approval_above_cents = CAST(round(requires_manager_approval_above * 100) AS INTEGER) WHERE requires_manager_approval_above IS NOT NULL;
ALTER TABLE employee_discounts DROP COLUMN requires_manager_approval_above;

ALTER TABLE discount_usage ADD COLUMN discount_value_scaled INTEGER;
UPDATE discount_usage SET discount_value_scaled = CAST(round(discount_value * 100) AS INTEGER) WHERE discount_value IS NOT NULL;
ALTER TABLE discount_usage DROP COLUMN discount_value;
ALTER TABLE discount_usage ADD COLUMN discount_amount_cents INTEGER NOT NULL DEFAULT 0;
UPDATE discount_usage SET discount_amount_cents = CAST(round(discount_amount * 100) AS INTEGER) WHERE discount_amount IS NOT NULL;
ALTER TABLE discount_usage DROP COLUMN discount_amount;

ALTER TABLE loyalty_transactions ADD COLUMN order_total_cents INTEGER;
UPDATE loyalty_transactions SET order_total_cents = CAST(round(order_total * 100) AS INTEGER) WHERE order_total IS NOT NULL;
ALTER TABLE loyalty_transactions DROP COLUMN order_total;
ALTER TABLE loyalty_transactions ADD COLUMN discount_amount_cents INTEGER;
UPDATE loyalty_transactions SET discount_amount_cents = CAST(round(discount_amount * 100) AS INTEGER) WHERE discount_amount IS NOT NULL;
ALTER TABLE loyalty_transactions DROP COLUMN discount_amount;

ALTER TABLE archived_quotes ADD COLUMN subtotal_cents INTEGER;
UPDATE archived_quotes SET subtotal_cents = CAST(round(subtotal * 100) AS INTEGER) WHERE subtotal IS NOT NULL;
ALTER TABLE archived_quotes DROP COLUMN subtotal;
ALTER TABLE archived_quotes ADD COLUMN tax_cents INTEGER;
UPDATE archived_quotes SET tax_cents = CAST(round(tax * 100) AS INTEGER) WHERE tax IS NOT NULL;
ALTER TABLE archived_quotes DROP COLUMN tax;
ALTER TABLE archived_quotes ADD COLUMN total_cents INTEGER;
UPDATE archived_quotes SET total_cents = CAST(round(total * 100) AS INTEGER) WHERE total IS NOT NULL;
ALTER TABLE archived_quotes DROP COLUMN total;

ALTER TABLE archived_orders ADD COLUMN subtotal_cents INTEGER;
UPDATE archived_orders SET subtotal_cents = CAST(round(subtotal * 100) AS INTEGER) WHERE subtotal IS NOT NULL;
ALTER TABLE archived_orders DROP COLUMN subtotal;
ALTER TABLE archived_orders ADD COLUMN tax_cents INTEGER;
UPDATE archived_orders SET tax_cents = CAST(round(tax * 100) AS INTEGER) WHERE tax IS NOT NULL;
ALTER TABLE archived_orders DROP COLUMN tax;
ALTER TABLE archived_orders ADD COLUMN discount_cents INTEGER;
UPDATE archived_orders SET discount_cents = CAST(round(discount * 100) AS INTEGER) WHERE discount IS NOT NULL;
ALTER TABLE archived_orders DROP COLUMN discount;
ALTER TABLE archived_orders ADD COLUMN total_cents INTEGER;
UPDATE archived_orders SET total_cents = CAST(round(total * 100) AS INTEGER) WHERE total IS NOT NULL;
ALTER TABLE archived_orders DROP COLUMN total;

INSERT INTO schema_migrations (version, name) VALUES (37, '037_money_cents_quotes');
