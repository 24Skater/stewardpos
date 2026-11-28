-- T-46: quote, discount, loyalty and customer-archive money moves from DECIMAL dollars to integer cents.
-- The API still speaks dollars; the adapters convert at the edge with toCents/toDollars.
--
-- discount_value is not always money: it is a percentage on percentage rows and a dollar amount on
-- fixed rows. One column holds both as value * 100 (DECIMAL(10,2) so this is exact): basis points
-- for percentage rows (12.5% -> 1250), cents for fixed rows ($5.00 -> 500). Hence the neutral name
-- discount_value_scaled; discount_type says which it is. Rate columns (points_per_dollar,
-- points_redemption_rate, discount_percentage) are not money and stay.

ALTER TABLE quotes RENAME COLUMN subtotal TO subtotal_cents;
ALTER TABLE quotes ALTER COLUMN subtotal_cents TYPE BIGINT USING round(subtotal_cents * 100)::bigint;
ALTER TABLE quotes RENAME COLUMN tax_total TO tax_total_cents;
ALTER TABLE quotes ALTER COLUMN tax_total_cents DROP DEFAULT;
ALTER TABLE quotes ALTER COLUMN tax_total_cents TYPE BIGINT USING round(tax_total_cents * 100)::bigint;
ALTER TABLE quotes ALTER COLUMN tax_total_cents SET DEFAULT 0;
ALTER TABLE quotes RENAME COLUMN total TO total_cents;
ALTER TABLE quotes ALTER COLUMN total_cents TYPE BIGINT USING round(total_cents * 100)::bigint;

ALTER TABLE quote_items RENAME COLUMN unit_price TO unit_price_cents;
ALTER TABLE quote_items ALTER COLUMN unit_price_cents TYPE BIGINT USING round(unit_price_cents * 100)::bigint;
ALTER TABLE quote_items RENAME COLUMN line_total TO line_total_cents;
ALTER TABLE quote_items ALTER COLUMN line_total_cents TYPE BIGINT USING round(line_total_cents * 100)::bigint;

ALTER TABLE discount_types RENAME COLUMN discount_value TO discount_value_scaled;
ALTER TABLE discount_types ALTER COLUMN discount_value_scaled TYPE BIGINT USING round(discount_value_scaled * 100)::bigint;
ALTER TABLE discount_types RENAME COLUMN min_purchase TO min_purchase_cents;
ALTER TABLE discount_types ALTER COLUMN min_purchase_cents DROP DEFAULT;
ALTER TABLE discount_types ALTER COLUMN min_purchase_cents TYPE BIGINT USING round(min_purchase_cents * 100)::bigint;
ALTER TABLE discount_types ALTER COLUMN min_purchase_cents SET DEFAULT 0;
ALTER TABLE discount_types RENAME COLUMN max_discount TO max_discount_cents;
ALTER TABLE discount_types ALTER COLUMN max_discount_cents TYPE BIGINT USING round(max_discount_cents * 100)::bigint;
ALTER TABLE discount_types RENAME COLUMN approval_threshold TO approval_threshold_cents;
ALTER TABLE discount_types ALTER COLUMN approval_threshold_cents TYPE BIGINT USING round(approval_threshold_cents * 100)::bigint;

ALTER TABLE promo_codes RENAME COLUMN discount_value TO discount_value_scaled;
ALTER TABLE promo_codes ALTER COLUMN discount_value_scaled TYPE BIGINT USING round(discount_value_scaled * 100)::bigint;
ALTER TABLE promo_codes RENAME COLUMN min_purchase TO min_purchase_cents;
ALTER TABLE promo_codes ALTER COLUMN min_purchase_cents DROP DEFAULT;
ALTER TABLE promo_codes ALTER COLUMN min_purchase_cents TYPE BIGINT USING round(min_purchase_cents * 100)::bigint;
ALTER TABLE promo_codes ALTER COLUMN min_purchase_cents SET DEFAULT 0;
ALTER TABLE promo_codes RENAME COLUMN max_discount TO max_discount_cents;
ALTER TABLE promo_codes ALTER COLUMN max_discount_cents TYPE BIGINT USING round(max_discount_cents * 100)::bigint;

ALTER TABLE employee_discounts RENAME COLUMN max_discount_amount TO max_discount_amount_cents;
ALTER TABLE employee_discounts ALTER COLUMN max_discount_amount_cents TYPE BIGINT USING round(max_discount_amount_cents * 100)::bigint;
ALTER TABLE employee_discounts RENAME COLUMN current_month_usage TO current_month_usage_cents;
ALTER TABLE employee_discounts ALTER COLUMN current_month_usage_cents DROP DEFAULT;
ALTER TABLE employee_discounts ALTER COLUMN current_month_usage_cents TYPE BIGINT USING round(current_month_usage_cents * 100)::bigint;
ALTER TABLE employee_discounts ALTER COLUMN current_month_usage_cents SET DEFAULT 0;
ALTER TABLE employee_discounts RENAME COLUMN requires_manager_approval_above TO requires_manager_approval_above_cents;
ALTER TABLE employee_discounts ALTER COLUMN requires_manager_approval_above_cents TYPE BIGINT USING round(requires_manager_approval_above_cents * 100)::bigint;

ALTER TABLE discount_usage RENAME COLUMN discount_value TO discount_value_scaled;
ALTER TABLE discount_usage ALTER COLUMN discount_value_scaled TYPE BIGINT USING round(discount_value_scaled * 100)::bigint;
ALTER TABLE discount_usage RENAME COLUMN discount_amount TO discount_amount_cents;
ALTER TABLE discount_usage ALTER COLUMN discount_amount_cents TYPE BIGINT USING round(discount_amount_cents * 100)::bigint;

ALTER TABLE loyalty_transactions RENAME COLUMN order_total TO order_total_cents;
ALTER TABLE loyalty_transactions ALTER COLUMN order_total_cents TYPE BIGINT USING round(order_total_cents * 100)::bigint;
ALTER TABLE loyalty_transactions RENAME COLUMN discount_amount TO discount_amount_cents;
ALTER TABLE loyalty_transactions ALTER COLUMN discount_amount_cents TYPE BIGINT USING round(discount_amount_cents * 100)::bigint;

ALTER TABLE archived_quotes RENAME COLUMN subtotal TO subtotal_cents;
ALTER TABLE archived_quotes ALTER COLUMN subtotal_cents TYPE BIGINT USING round(subtotal_cents * 100)::bigint;
ALTER TABLE archived_quotes RENAME COLUMN tax TO tax_cents;
ALTER TABLE archived_quotes ALTER COLUMN tax_cents TYPE BIGINT USING round(tax_cents * 100)::bigint;
ALTER TABLE archived_quotes RENAME COLUMN total TO total_cents;
ALTER TABLE archived_quotes ALTER COLUMN total_cents TYPE BIGINT USING round(total_cents * 100)::bigint;

ALTER TABLE archived_orders RENAME COLUMN subtotal TO subtotal_cents;
ALTER TABLE archived_orders ALTER COLUMN subtotal_cents TYPE BIGINT USING round(subtotal_cents * 100)::bigint;
ALTER TABLE archived_orders RENAME COLUMN tax TO tax_cents;
ALTER TABLE archived_orders ALTER COLUMN tax_cents TYPE BIGINT USING round(tax_cents * 100)::bigint;
ALTER TABLE archived_orders RENAME COLUMN discount TO discount_cents;
ALTER TABLE archived_orders ALTER COLUMN discount_cents TYPE BIGINT USING round(discount_cents * 100)::bigint;
ALTER TABLE archived_orders RENAME COLUMN total TO total_cents;
ALTER TABLE archived_orders ALTER COLUMN total_cents TYPE BIGINT USING round(total_cents * 100)::bigint;

INSERT INTO schema_migrations (version, name) VALUES (37, '037_money_cents_quotes')
ON CONFLICT (version) DO NOTHING;
