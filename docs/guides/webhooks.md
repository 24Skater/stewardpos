# Webhooks

## Outbound events

StewardPOS records an event in the same database transaction as the change that caused it, then delivers it to subscribed URLs in the background. A slow or unreachable receiver never delays a sale.

## Events

| Type | When |
|------|------|
| `order.created` | A sale is completed |
| `order.refunded` | A return or refund is recorded |
| `customer.created` | A customer record is created |

## Envelope

```json
{
  "id": "event uuid",
  "type": "order.created",
  "createdAt": "2026-01-01T12:00:00.000Z",
  "orgId": "organisation uuid",
  "data": {}
}
```

The `id` is stable across retries; use it to ignore duplicates.

## Verifying the signature

Each request carries `Steward-Signature: t=<unix seconds>,v1=<hex>`, where `v1` is the HMAC-SHA256 of `t + "." + raw request body`, keyed with the subscription secret. Reject requests whose `t` is far from your clock.

```js
const crypto = require('crypto');

function verify(secret, header, rawBody) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
```

## Retries

A delivery succeeds on any 2xx within 3 seconds. Otherwise it is retried:

| Failure | Wait before next attempt |
|---------|--------------------------|
| 1st | 1 minute |
| 2nd | 5 minutes |
| 3rd | 30 minutes |
| 4th | 2 hours |
| 5th | 12 hours |
| 6th | none, the delivery is marked `dead` |

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
