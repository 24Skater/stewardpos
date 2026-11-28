# T-07 Editable message templates and per-event switches

Tier: sonnet. Review: N. Branch: feat/T-07-templates. Depends: T-05.

## Files
- Migration `033_message_templates.sql`: `message_templates(id, org_id, key, channel, subject, body, enabled, updated_at)`, unique (org_id, key, channel).
- New `backend/src/services/templates.ts`: `renderTemplate(key, channel, vars)`, `{{var}}` substitution, HTML-escaped for email; built-in defaults when no row exists; unknown variables render blank.
- Keys and variables in `TEMPLATE_KEYS`: `receipt, gift_card, invoice, quote, purchase_order, membership_reminder, pickup_ready`.
- `src/pages/admin/AdminTemplates.tsx`: edit, preview with sample data, enabled switch.
- Use it in `receipts.ts` `POST /:id/resend` for the receipt email.

## Tests
Escaping; disabled template -> nothing sent, logged `suppressed`; preview endpoint; receipt resend uses an edited template.

## Docs
`docs/guides/email-sms.md`: templates and variables table.
