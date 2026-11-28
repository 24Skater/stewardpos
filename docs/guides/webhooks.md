# Webhooks

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
