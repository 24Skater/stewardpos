# T-03 Webhook subscriptions screen, SSRF guard, delivery log

Tier: sonnet. Review: Y (SSRF). Branch: feat/T-03-webhook-admin. Depends: T-02.

## Files
- New `backend/src/api/routes/webhookSubscriptions.ts`, `requirePermission('settings', ...)`: CRUD; `POST /:id/rotate-secret` (old secret stays valid 24 h; both signatures sent as two `v1=` pairs); `GET /deliveries?status=`; `POST /deliveries/:id/redeliver`. Secret shown once on create and rotate.
- New `backend/src/services/ssrfGuard.ts`: resolve DNS; refuse loopback, link-local, RFC1918, CGNAT, `::1`, `fc00::/7`, `169.254.169.254`, unless host:port is in `settings.providers.webhookAllowlist`. Check at create time and at send time (DNS rebinding). Do not follow redirects. https required except for allow-listed hosts.
- `webhookDelivery.ts`: call the guard before every send.
- New `src/pages/admin/AdminWebhooks.tsx`, `src/lib/api/webhooks.ts`; nav entry in `AdminLayout.tsx`.

## Tests
`ssrfGuard.test.ts`: `127.0.0.1`, `10.0.0.5`, `169.254.169.254`, `[::1]`, decimal-encoded `2130706433`, a hostname resolving to a private IP all refused; allow-listed LAN host passes. Route tests for rotate and redeliver. Screen test: secret shown once.

## Docs
`docs/guides/webhooks.md`: allow-listing a LAN sibling.
