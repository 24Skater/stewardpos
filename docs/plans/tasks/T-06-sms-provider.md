# T-06 SMS port: Twilio, generic HTTP gateway, consent, STOP, quiet hours

Tier: sonnet. Review: N. Branch: feat/T-06-sms. Depends: T-04, T-05.

## Files
- New `backend/src/sms/SmsPort.ts`, `TwilioSmsAdapter.ts`, `HttpGatewaySmsAdapter.ts` (POST `{to, body}` with bearer token to a configured URL), `SmsAdapterFactory.ts` (copy `TerminalAdapterFactory.ts`; `off` throws `SmsNotConfiguredError`).
- New `backend/src/services/sms.ts`: `sendSms(to, body, template)` checks consent and quiet hours (`settings.providers.smsQuietHours {start, end}` in the store time zone -> `suppressed`), writes `message_log`.
- Migration `032_sms_consent.sql`: `sms_consent(id, org_id, phone, status opted_in|opted_out, source, updated_at)`, unique (org_id, phone). Phones are 10 digits (`normalizePhone`).
- Twilio inbound handler on the T-04 registry: STOP/UNSUBSCRIBE -> opted_out, START -> opted_in; verify `X-Twilio-Signature`.
- SMS card in Settings with Test send; consent checkbox on the customer form.

## Tests
No consent -> not sent; STOP flips status; quiet hours suppress; Twilio signature vector; `off` shows unavailable.

## Docs
`docs/guides/email-sms.md` SMS half: "consent rules vary by state and country; check yours".

## Note from T-04 review
`app.ts` line 165 mounts `express.raw({ type: 'application/json' })` on `/api/webhooks`. Twilio posts `application/x-www-form-urlencoded`, which would arrive unparsed and fail the Buffer check. Widen the raw parser type to `() => true` on that mount and parse the form body inside the Twilio handler.
