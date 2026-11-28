# T-42 Offline phase 2: queued sales, server re-pricing on sync

Tier: sonnet. Review: Y (offline sync and re-pricing). Branch: feat/T-42-offline-queue. Depends: T-41.

## Files
- Client: `src/lib/offline/saleQueue.ts` stores the order request (item ids, quantities, options, tender) with a client UUID `idempotencyKey`; never a trusted total.
- Server: `orders.ts` accepts `idempotencyKey` and `offlineCreatedAt`; migration adds unique (org_id, idempotency_key); duplicate returns the first order. Server reprices; if the cashier-shown total differs, store `offline_price_diff_cents` and list it for a manager.
- Tender rules offline: cash and Zelle allowed; card only if the terminal adapter reports offline support; gift-card redemption capped by setting `offlineGiftCardCapCents` and checked at sync (shortfall flagged).

## Tests
Replaying the same key twice creates one order; price change between sale and sync is flagged, not silently changed; card refused offline with Manual/Stripe adapters.
