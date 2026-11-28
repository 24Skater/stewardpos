# T-36 Membership plans, subscriptions, renewal job (manual pay)

Tier: sonnet. Review: Y (recurring billing). Branch: feat/T-36-memberships. Depends: T-23, T-05.

## Files
- Migration `046_memberships.sql`: `membership_plans(id, org_id, name, price_cents, interval month|quarter|year, benefits JSON {discountBps?, freeItems?: [{productId, perPeriod}], prepaidCreditCents?}, active)`; `subscriptions(id, org_id, customer_id, plan_id, status active|paused|cancelled|past_due, current_period_start, next_renewal_at, payment_mode manual|card, card_token_ref NULL)`; `subscription_renewals(id, org_id, subscription_id, period_start, invoice_id)` unique (subscription_id, period_start) for idempotency.
- New `backend/src/services/memberships.ts`: `runRenewals(now)` via `startJob` hourly; creates an invoice per due period exactly once; pause and cancel; mark paid through `recordPayment` (T-23).
- Reminders and dunning: `membership_reminder` template by email or SMS at -3, 0, +3, +7 days; `past_due` after the last.
- Events: `subscription.renewed`, `subscription.past_due`, `subscription.cancelled`.

## Tests
Running the job twice creates one invoice; pause skips; dunning schedule; cancel stops renewal.
