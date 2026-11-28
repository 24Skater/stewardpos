-- Counterpart to the Postgres migration of the same number; see that file.
-- None of these columns is in an index, view, trigger, CHECK or foreign key (checked against 001-035),
-- which is what DROP COLUMN requires; so no table rebuild is needed.

ALTER TABLE returns ADD COLUMN subtotal_cents INTEGER NOT NULL DEFAULT 0;
UPDATE returns SET subtotal_cents = CAST(round(subtotal * 100) AS INTEGER) WHERE subtotal IS NOT NULL;
ALTER TABLE returns DROP COLUMN subtotal;
ALTER TABLE returns ADD COLUMN tax_total_cents INTEGER NOT NULL DEFAULT 0;
UPDATE returns SET tax_total_cents = CAST(round(tax_total * 100) AS INTEGER) WHERE tax_total IS NOT NULL;
ALTER TABLE returns DROP COLUMN tax_total;
ALTER TABLE returns ADD COLUMN total_cents INTEGER NOT NULL DEFAULT 0;
UPDATE returns SET total_cents = CAST(round(total * 100) AS INTEGER) WHERE total IS NOT NULL;
ALTER TABLE returns DROP COLUMN total;
ALTER TABLE returns ADD COLUMN store_credit_amount_cents INTEGER DEFAULT 0;
UPDATE returns SET store_credit_amount_cents = CAST(round(store_credit_amount * 100) AS INTEGER) WHERE store_credit_amount IS NOT NULL;
ALTER TABLE returns DROP COLUMN store_credit_amount;
ALTER TABLE returns ADD COLUMN restocking_fee_cents INTEGER DEFAULT 0;
UPDATE returns SET restocking_fee_cents = CAST(round(restocking_fee * 100) AS INTEGER) WHERE restocking_fee IS NOT NULL;
ALTER TABLE returns DROP COLUMN restocking_fee;

ALTER TABLE return_items ADD COLUMN unit_price_cents INTEGER NOT NULL DEFAULT 0;
UPDATE return_items SET unit_price_cents = CAST(round(unit_price * 100) AS INTEGER) WHERE unit_price IS NOT NULL;
ALTER TABLE return_items DROP COLUMN unit_price;
ALTER TABLE return_items ADD COLUMN line_total_cents INTEGER NOT NULL DEFAULT 0;
UPDATE return_items SET line_total_cents = CAST(round(line_total * 100) AS INTEGER) WHERE line_total IS NOT NULL;
ALTER TABLE return_items DROP COLUMN line_total;

ALTER TABLE refund_transactions ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0;
UPDATE refund_transactions SET amount_cents = CAST(round(amount * 100) AS INTEGER) WHERE amount IS NOT NULL;
ALTER TABLE refund_transactions DROP COLUMN amount;

ALTER TABLE store_credits ADD COLUMN original_amount_cents INTEGER NOT NULL DEFAULT 0;
UPDATE store_credits SET original_amount_cents = CAST(round(original_amount * 100) AS INTEGER) WHERE original_amount IS NOT NULL;
ALTER TABLE store_credits DROP COLUMN original_amount;
ALTER TABLE store_credits ADD COLUMN remaining_amount_cents INTEGER NOT NULL DEFAULT 0;
UPDATE store_credits SET remaining_amount_cents = CAST(round(remaining_amount * 100) AS INTEGER) WHERE remaining_amount IS NOT NULL;
ALTER TABLE store_credits DROP COLUMN remaining_amount;

ALTER TABLE cash_drawer_sessions ADD COLUMN opening_float_cents INTEGER NOT NULL DEFAULT 0;
UPDATE cash_drawer_sessions SET opening_float_cents = CAST(round(opening_float * 100) AS INTEGER) WHERE opening_float IS NOT NULL;
ALTER TABLE cash_drawer_sessions DROP COLUMN opening_float;
ALTER TABLE cash_drawer_sessions ADD COLUMN expected_cash_cents INTEGER;
UPDATE cash_drawer_sessions SET expected_cash_cents = CAST(round(expected_cash * 100) AS INTEGER) WHERE expected_cash IS NOT NULL;
ALTER TABLE cash_drawer_sessions DROP COLUMN expected_cash;
ALTER TABLE cash_drawer_sessions ADD COLUMN counted_cash_cents INTEGER;
UPDATE cash_drawer_sessions SET counted_cash_cents = CAST(round(counted_cash * 100) AS INTEGER) WHERE counted_cash IS NOT NULL;
ALTER TABLE cash_drawer_sessions DROP COLUMN counted_cash;
ALTER TABLE cash_drawer_sessions ADD COLUMN variance_cents INTEGER;
UPDATE cash_drawer_sessions SET variance_cents = CAST(round(variance * 100) AS INTEGER) WHERE variance IS NOT NULL;
ALTER TABLE cash_drawer_sessions DROP COLUMN variance;

ALTER TABLE organizations ADD COLUMN drawer_variance_threshold_cents INTEGER;
UPDATE organizations SET drawer_variance_threshold_cents = CAST(round(drawer_variance_threshold * 100) AS INTEGER) WHERE drawer_variance_threshold IS NOT NULL;
ALTER TABLE organizations DROP COLUMN drawer_variance_threshold;

INSERT INTO schema_migrations (version, name) VALUES (36, '036_money_cents_returns');
