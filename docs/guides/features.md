# Feature switches

Each optional feature is controlled by a switch under Settings, Features. All
switches are off by default, and with a switch off the feature does not appear
and existing behavior is unchanged. Rules that vary by place (tax, expiry,
consent) are settings; check your local rules before turning them on.

| Key | Feature |
|-----|---------|
| `tips` | Tips |
| `taxEngine` | Tax engine |
| `modifiers` | Modifiers |
| `openPrice` | Open-price items |
| `giftCards` | Gift cards |
| `invoices` | Invoices |
| `loyalty` | Loyalty |
| `timeClock` | Time clock |
| `purchaseOrders` | Purchase orders |
| `customerDisplay` | Customer display |
| `pickup` | Pickup |
| `memberships` | Memberships |
| `accounting` | Accounting |
| `offline` | Offline mode |
| `webhooks` | Webhooks |
| `sms` | SMS |

## Providers

Outside services are chosen per area with `providers` in settings: `email`,
`sms`, `loyalty`, `accounting`, `recurring`. A value is a provider name or
`{ provider, credentials }`; credentials are encrypted at rest. Unset means
`off`, which is unavailable, never a fake success.
