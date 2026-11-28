-- T-45: returns, store credit and drawer money moves from DECIMAL dollars to integer cents (`<col>_cents`).
-- Same approach as 035. No CHECK, index or view touches these columns.

ALTER TABLE returns RENAME COLUMN subtotal TO subtotal_cents;
ALTER TABLE returns ALTER COLUMN subtotal_cents DROP DEFAULT;
ALTER TABLE returns ALTER COLUMN subtotal_cents TYPE BIGINT USING round(subtotal_cents * 100)::bigint;
ALTER TABLE returns ALTER COLUMN subtotal_cents SET DEFAULT 0;
ALTER TABLE returns RENAME COLUMN tax_total TO tax_total_cents;
ALTER TABLE returns ALTER COLUMN tax_total_cents DROP DEFAULT;
ALTER TABLE returns ALTER COLUMN tax_total_cents TYPE BIGINT USING round(tax_total_cents * 100)::bigint;
ALTER TABLE returns ALTER COLUMN tax_total_cents SET DEFAULT 0;
ALTER TABLE returns RENAME COLUMN total TO total_cents;
ALTER TABLE returns ALTER COLUMN total_cents DROP DEFAULT;
ALTER TABLE returns ALTER COLUMN total_cents TYPE BIGINT USING round(total_cents * 100)::bigint;
ALTER TABLE returns ALTER COLUMN total_cents SET DEFAULT 0;
ALTER TABLE returns RENAME COLUMN store_credit_amount TO store_credit_amount_cents;
ALTER TABLE returns ALTER COLUMN store_credit_amount_cents DROP DEFAULT;
ALTER TABLE returns ALTER COLUMN store_credit_amount_cents TYPE BIGINT USING round(store_credit_amount_cents * 100)::bigint;
ALTER TABLE returns ALTER COLUMN store_credit_amount_cents SET DEFAULT 0;
ALTER TABLE returns RENAME COLUMN restocking_fee TO restocking_fee_cents;
ALTER TABLE returns ALTER COLUMN restocking_fee_cents DROP DEFAULT;
ALTER TABLE returns ALTER COLUMN restocking_fee_cents TYPE BIGINT USING round(restocking_fee_cents * 100)::bigint;
ALTER TABLE returns ALTER COLUMN restocking_fee_cents SET DEFAULT 0;

ALTER TABLE return_items RENAME COLUMN unit_price TO unit_price_cents;
ALTER TABLE return_items ALTER COLUMN unit_price_cents TYPE BIGINT USING round(unit_price_cents * 100)::bigint;
ALTER TABLE return_items RENAME COLUMN line_total TO line_total_cents;
ALTER TABLE return_items ALTER COLUMN line_total_cents TYPE BIGINT USING round(line_total_cents * 100)::bigint;

ALTER TABLE refund_transactions RENAME COLUMN amount TO amount_cents;
ALTER TABLE refund_transactions ALTER COLUMN amount_cents TYPE BIGINT USING round(amount_cents * 100)::bigint;

ALTER TABLE store_credits RENAME COLUMN original_amount TO original_amount_cents;
ALTER TABLE store_credits ALTER COLUMN original_amount_cents TYPE BIGINT USING round(original_amount_cents * 100)::bigint;
ALTER TABLE store_credits RENAME COLUMN remaining_amount TO remaining_amount_cents;
ALTER TABLE store_credits ALTER COLUMN remaining_amount_cents TYPE BIGINT USING round(remaining_amount_cents * 100)::bigint;

ALTER TABLE cash_drawer_sessions RENAME COLUMN opening_float TO opening_float_cents;
ALTER TABLE cash_drawer_sessions ALTER COLUMN opening_float_cents DROP DEFAULT;
ALTER TABLE cash_drawer_sessions ALTER COLUMN opening_float_cents TYPE BIGINT USING round(opening_float_cents * 100)::bigint;
ALTER TABLE cash_drawer_sessions ALTER COLUMN opening_float_cents SET DEFAULT 0;
ALTER TABLE cash_drawer_sessions RENAME COLUMN expected_cash TO expected_cash_cents;
ALTER TABLE cash_drawer_sessions ALTER COLUMN expected_cash_cents TYPE BIGINT USING round(expected_cash_cents * 100)::bigint;
ALTER TABLE cash_drawer_sessions RENAME COLUMN counted_cash TO counted_cash_cents;
ALTER TABLE cash_drawer_sessions ALTER COLUMN counted_cash_cents TYPE BIGINT USING round(counted_cash_cents * 100)::bigint;
ALTER TABLE cash_drawer_sessions RENAME COLUMN variance TO variance_cents;
ALTER TABLE cash_drawer_sessions ALTER COLUMN variance_cents TYPE BIGINT USING round(variance_cents * 100)::bigint;

ALTER TABLE organizations RENAME COLUMN drawer_variance_threshold TO drawer_variance_threshold_cents;
ALTER TABLE organizations ALTER COLUMN drawer_variance_threshold_cents TYPE BIGINT USING round(drawer_variance_threshold_cents * 100)::bigint;

INSERT INTO schema_migrations (version, name) VALUES (36, '036_money_cents_returns')
ON CONFLICT (version) DO NOTHING;
