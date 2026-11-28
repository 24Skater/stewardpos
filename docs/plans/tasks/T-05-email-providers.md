# T-05 Email providers in Settings, test send, delivery log

Tier: sonnet. Review: N. Branch: feat/T-05-email-providers. Depends: T-01.

## Files
- `backend/src/services/email.ts`: `sendEmail` dispatches on env `config.email.adapter` today. Read `providerFor(settings, 'email')` first (`smtp | resend | off`), credentials from settings via `decryptCredentials`; fall back to env when unset so current installs keep working. Keep `logged` distinct from `sent` (CONTRIBUTING).
- Migration `031_message_log.sql`: `message_log(id, org_id, channel email|sms, template, recipient, status sent|failed|logged|suppressed, provider_message_id, error, created_at)`. One row per send attempt.
- `admin.ts`: `POST /api/admin/email/test`.
- New `src/components/settings/EmailSettings.tsx` (copy the Payments tab credential pattern) with a Test send button; new `src/pages/admin/AdminMessages.tsx` delivery log.

## Tests
`off` returns `failed` "Email is off", never `sent`; env fallback; credentials stored encrypted; log row written.

## Docs
`docs/guides/email-sms.md` (email half).
