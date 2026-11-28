# T-44 Money to integer cents: catalog, orders, payments

Tier: sonnet. Review: Y (money, data migration). Branch: feat/T-44-cents-orders. Depends: none (run before T-10).

## Goal
Owner decision: store money as integer cents everywhere, long term. This task converts the catalog and sales tables. The HTTP API keeps sending dollars for now, so the frontend does not change; adapters convert at the edge with `toCents`/`toDollars` from `services/pricing.ts`.

## Columns (from `grep -n DECIMAL backend/migrations/postgres/*.sql`)
- `products.base_price`; `product_variants.price_override`, `price_delta`; `services.base_price`
- `orders.subtotal`, `discount_total`, `tax_total`, `total`, `amount_tendered`, `change_given`
- `order_items.unit_price`, `line_discount`, `line_total`
- `payments.amount` (012)

## Files
- Migration `0NN_money_cents_orders.sql`. Postgres: `ALTER TABLE t RENAME COLUMN x TO x_cents; ALTER TABLE t ALTER COLUMN x_cents TYPE BIGINT USING round(x_cents * 100)`. SQLite: add `x_cents INTEGER`, `UPDATE ... SET x_cents = CAST(round(x * 100) AS INTEGER)`, then `ALTER TABLE ... DROP COLUMN x` (SQLite 3.35+; check the bundled version first and write the answer here).
- `PostgresAdapter.ts`, `SQLiteAdapter.ts`: every SQL touching these columns uses `*_cents`; row mappers return dollars through `toDollars`; writers take cents from the pricing services (which already compute cents) instead of converting back to dollars.
- Reports SQL in both adapters that sums these columns: sum cents, convert once.

## Tests
Golden test: seed a SQLite DB at migration N-1 with orders whose totals include 0.1 + 0.2 style values, migrate, assert every API response value is identical. Existing pricing, order, report and adapter tests pass unchanged.

Out of scope: returns, drawer, quotes, discounts (T-45, T-46). API in cents (later).
