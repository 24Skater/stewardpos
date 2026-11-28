# T-45 Money to integer cents: returns, store credit, drawer

Tier: sonnet. Review: Y (money, data migration). Branch: feat/T-45-cents-returns. Depends: T-44 (same pattern; copy its migration and mapper approach).

## Columns
- `returns.subtotal`, `tax_total`, `total`, `store_credit_amount`, `restocking_fee`; `return_items.unit_price`, `line_total`; `refund_transactions.amount`
- `store_credits.original_amount`, `remaining_amount`
- `cash_drawer_sessions.opening_float`, `expected_cash`, `counted_cash`, `variance`
- `organizations.drawer_variance_threshold` (019)

## Files
Migration `0NN_money_cents_returns.sql`; both adapters; `returnPricing.ts` and `drawer.ts` read cents directly where they convert today.

## Tests
Golden test as in T-44 for a partial return, a store-credit issue and redeem, and a drawer close with variance. Existing returns, store credit and drawer tests pass unchanged.
