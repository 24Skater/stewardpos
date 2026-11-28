# Webhooks

## Inbound callbacks

Providers report events to StewardPOS at `POST /api/webhooks/:provider`.
Stripe is the first provider: `POST /api/webhooks/stripe`, unchanged from before.

Each request is handled in this order:

1. An unknown `:provider` gets 404.
2. A provider with no signing secret configured gets 503. Unverified events are never accepted.
3. A bad or missing signature gets 400, and nothing is stored.
4. The event is recorded in `webhook_events` by its id. A redelivery is acknowledged
   with `{"duplicate": true}` and not handled again.
5. The provider's handler runs. A handler failure is recorded on the event row and the
   response is still 200, because the event is already claimed and a retry cannot help.

Signatures are checked against the exact bytes received, so the route is mounted with a
raw body parser ahead of the JSON one.

To add a provider, implement `InboundHandler` (`backend/src/webhooks/registry.ts`) and
call `registerHandler()` next to the Stripe registration in `api/routes/webhooks.ts`.
Event ids share one table, so use provider-prefixed ids if a provider's own are not unique.
