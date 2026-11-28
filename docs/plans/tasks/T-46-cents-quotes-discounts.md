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

## Decision (executor): discount_value split
`discount_value` is a percentage on percentage rows and dollars on fixed rows (and unused for the other types). Chosen: one integer column per table, `discount_value_scaled` (`discount_types`, `promo_codes`, `discount_usage`), holding value x 100: basis points for percentage rows (12.5% -> 1250), cents for fixed rows ($5.00 -> 500).

Why: the source is DECIMAL(10,2) / a two-decimal REAL, so x100 is exact for both meanings. The conversion is identical to every other money column (`toCentsOrNull` in, `centsToDollars` out), so the adapters need no per-type branch and `discountPricing.ts` is unchanged (the API and the lookups still hand it percent / dollars). Two columns (`_bps` and `_cents`) would have needed a type-dependent read and write in both adapters plus a CHECK that exactly one is set, for no gain. The neutral name stops anyone reading a percentage as cents; `discount_type` says which it is.

## Notes (executor)
- `archived_quotes` (subtotal, tax, total) and `archived_orders` (subtotal, tax, discount, total) become `*_cents`. `archiveCustomer` copies `quotes.*_cents` straight into `archived_quotes.*_cents`. The folded `items` JSON now carries the raw `quote_items` row, so new archives have `unit_price_cents` / `line_total_cents` keys; JSON already archived keeps its dollar `unit_price` / `line_total` keys (not rewritten).
- `logDiscountUsage` still returns snake_case `discount_value` / `discount_amount` in dollars, as before.
- `points_per_dollar`, `points_redemption_rate`, `discount_percentage` are rates and stay. `loyalty_transactions` has no adapter code; only the migration converts it.
- SQLite: none of the dropped columns is in an index, view, trigger, CHECK or foreign key, so DROP COLUMN works (checked with node:sqlite over a database at 035 plus 037).
- Fixed along the way: PostgresAdapter `createQuote`/`updateQuote` wrote quote_items already multiplied by 100 into the old DECIMAL dollars column (T-44 over-reach); they now write cents into the cents column.
