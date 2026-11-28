# T-33 Inbound order endpoint for pickup

Tier: sonnet. Review: Y (new API-key scope, money). Branch: feat/T-33-inbound-orders. Depends: T-02, T-11.

## Files
- `backend/src/api/middleware/auth.ts` `ApiKeyScope` (line 40): add `orders:inbound`; API keys screen offers it.
- Migration `045_inbound_orders.sql`: `orders.external_source`, `orders.external_id`, unique (org_id, external_source, external_id); `orders.fulfillment_status` using Table's names SUBMITTED, CONFIRMED, READY, AWAITING_PICKUP, PICKED_UP, COMPLETED, CANCELED, REFUNDED; `orders.pickup_code`; `orders.paid BOOLEAN`.
- New `POST /api/inbound/orders`: normalized order `{ externalSource, externalId, customer {name, email, phone}, lines [{ sku | productId, quantity, modifierOptionIds }], paid: { amountCents, reference } | null }`. Server reprices; if the sender's paid amount differs from the repriced total, store both and flag `price_mismatch`. Idempotent: same external id returns the existing order 200.
- Events: `order.created` with source, `order.status_changed`.

## Tests
Contract test with `stubSibling` posting twice -> one order; wrong scope 403; mismatch flagged; feature off 404.
