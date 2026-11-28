# T-02 Transactional outbox, job runner, outbound delivery

Tier: sonnet. Review: Y (signing, retries, data leaving the server). Branch: feat/T-02-webhook-outbox. Depends: T-01, T-09.

## Goal
Every event is written in the same transaction as the change and delivered later; a slow or absent receiver never blocks a sale.

## Files
- Migration `030_outbox.sql`: `outbox_events(id, org_id, event_type, payload, created_at)`; `webhook_subscriptions(id, org_id, url, secret_enc, events, active, created_at)`; `webhook_deliveries(id, org_id, event_id, subscription_id, status pending|delivered|failed|dead, attempts, next_attempt_at, last_status_code, last_error, created_at)`.
- New `backend/src/services/outbox.ts`: `enqueueEvent(adapter, type, data)`; `EVENT_CATALOG` (type -> description). Fan out to matching active subscriptions.
- New `backend/src/services/jobs.ts`: `startJob(name, intervalMs, fn)`, started from `backend/src/server.ts`; no overlapping runs per job; Postgres claims rows with `FOR UPDATE SKIP LOCKED`. No job infrastructure exists today (no setInterval in backend/src).
- New `backend/src/services/webhookDelivery.ts`: header `Steward-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`; 3 s timeout via `callSibling` (T-09); backoff 1m, 5m, 30m, 2h, 12h, then `dead`.
- Both adapters: insert, claim-due, mark methods.

## Contracts
Envelope `{ id, type, createdAt, orgId, data }`. Initial catalog: `order.created`, `order.refunded`, `customer.created`, emitted from `orders.ts`, `returns.ts`, `customers.ts`. `order.created` data must carry what T-35 specifies.

## Tests
Signature test vector; backoff schedule; dead after the sixth failure; event rolls back with its transaction (postgres integration); a hung receiver does not delay the order response.

## Docs
`docs/guides/webhooks.md`: envelope, verification snippet, retry table.

Out of scope: admin screen and SSRF (T-03); inbound (T-04).
