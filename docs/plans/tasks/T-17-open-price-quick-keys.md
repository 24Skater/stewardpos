# T-17 Open-price items on yard-sale registers, quick-key favorites grid

Tier: sonnet. Review: Y (a cashier-entered amount is a money boundary). Branch: feat/T-17-open-price. Depends: T-01, T-44.

## Owner decision
Manual price entry is allowed, but only on registers an admin marks for it. The client never sends prices, except `openPriceCents` on a line when all of these hold: the `openPrice` feature is on; the calling register (`resolveCallerRegister` in `api/middleware/registerContext.ts`) has `allow_open_price = true`; the product has `open_price = true`; the amount is within the product's `open_price_min_cents` and `open_price_max_cents` (or the store-wide default bounds when null). Any other case returns 400. Each sale with an open price writes an audit entry.

## Files
- Migration `0NN_open_price_quick_keys.sql`: `registers.allow_open_price BOOLEAN NOT NULL DEFAULT false`; `products.open_price BOOLEAN NOT NULL DEFAULT false`, `open_price_min_cents`, `open_price_max_cents`; `quick_keys(id, org_id, register_id NULL, product_id, position)`.
- `cartPricing.ts` / `pricing.ts`: honor `openPriceCents` only under the rule above.
- `src/pages/admin/AdminRegisters.tsx`: "Yard sale: allow manual prices" switch per register (audited, `registers` permission).
- POS: an amount pad when adding an open-price item on an allowed register; a generic "Item" open-price key; the item is hidden on registers without the flag. Quick-key grid tab plus an admin editor.

## Tests
Allowed register within bounds passes; register without the flag 400; out of bounds 400; normal product ignores the field; feature off 400; audit row written. Grid save and order.

## Docs
`docs/guides/yard-sale.md`.
