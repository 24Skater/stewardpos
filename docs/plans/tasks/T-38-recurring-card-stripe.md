# T-38 Card-on-file renewals through a RecurringPort (Stripe)

Tier: sonnet. Review: Y (recurring billing, processor tokens). Branch: feat/T-38-recurring-stripe. Depends: T-36, T-04.

## Files
- New `backend/src/recurring/RecurringPort.ts` (`createCustomer`, `attachPaymentMethod(setupToken)`, `charge(customerRef, amountCents, idempotencyKey)`), `StripeRecurring.ts` using the tenant Stripe keys already in settings, `OffRecurring.ts`.
- Store only processor references (`cus_...`, `pm_...`). Never card data.
- `runRenewals`: card mode charges with idempotency key `renewal:<subscription>:<period>`; success records invoice payment; failure enters dunning.
- Stripe inbound handler events `invoice.payment_failed`/`payment_intent.succeeded` on the T-04 registry.

## Tests
Idempotency key stable across retries; failure -> past_due path; no PAN-like strings stored (assert schema has no card columns).
