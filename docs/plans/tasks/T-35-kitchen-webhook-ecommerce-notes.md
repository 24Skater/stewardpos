# T-35 order.created shape for Table, kitchen and e-commerce planning notes

Tier: haiku (docs plus one payload type from this spec). Review: N. Branch: docs/T-35-integration-notes. Depends: T-02.

## Files
- `backend/src/services/outbox.ts`: export type `OrderCreatedData { orderId, number, createdAt, source, externalSource?, externalId?, fulfillmentStatus, customer { name? }, lines [{ name, quantity, modifiers [{ group, option }], note? }] }`. No prices beyond line totals; no customer email or phone.
- New `docs/guides/kitchen-integration.md`: how Table would consume `order.created`; that no kitchen screen exists in POS.
- New `docs/guides/ecommerce-adapters.md`: a planned port for Shopify, WooCommerce, eBay and Table storefronts posting to `/api/inbound/orders`; not built.

## Tests
Type test that the T-02 emitter's payload satisfies `OrderCreatedData` (edit the existing outbox test).
