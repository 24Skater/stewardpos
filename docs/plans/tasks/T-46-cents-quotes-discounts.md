# T-46 Money to integer cents: quotes, discounts, loyalty, archive

Tier: sonnet. Review: Y (money, data migration). Branch: feat/T-46-cents-quotes. Depends: T-44.

## Columns (money only)
- `quotes.subtotal`, `tax_total`, `total`; `quote_items.unit_price`, `line_total` (`quantity` stays decimal)
- `discount_types` and `promo_codes`: `min_purchase`, `max_discount`, `approval_threshold`; `discount_value` only where the type is fixed-amount (percent rows stay as basis points: convert to `discount_value_bps` or `discount_value_cents` by type; write the chosen split here before coding)
- `employee_discounts.max_discount_amount`, `current_month_usage`, `requires_manager_approval_above`; `discount_usage.discount_value`, `discount_amount`
- `loyalty_transactions.order_total`, `discount_amount`; `points_per_dollar` and `points_redemption_rate` are rates and stay
- Customer archive tables from 006: `subtotal`, `tax`, `discount`, `total`

## Files
Migration `0NN_money_cents_quotes.sql`; both adapters; `discountPricing.ts`.

## Tests
Golden test for a fixed and a percent promo, an employee discount with a cap, and an archived customer's order history.
