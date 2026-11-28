# T-04 Inbound provider callback framework

Tier: sonnet. Review: Y (signature checks). Branch: feat/T-04-inbound-webhooks

## Goal
Generic `POST /api/webhooks/:provider` with a handler registry. Stripe becomes the first handler with no behavior change.

## Files
- `backend/src/api/routes/webhooks.ts` (Stripe route, line 104): move its logic to `backend/src/webhooks/stripeHandler.ts`.
- New `backend/src/webhooks/registry.ts`: `InboundHandler { provider; verify(rawBody, headers, settings): boolean; handle(event): Promise<void> }`, `registerHandler()`; dedupe through the existing `webhook_events` table (migration 023).
- `/api/webhooks/stripe` keeps working (it becomes the `:provider` route).

## Tests
Existing Stripe webhook tests pass unchanged; unknown provider 404; failed verify 400 with nothing stored; duplicate event handled once.

## Docs
"Inbound callbacks" section in `docs/guides/webhooks.md`.

Out of scope: Twilio handler (T-06).
