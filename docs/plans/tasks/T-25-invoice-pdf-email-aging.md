# T-25 Invoice and quote PDF, email, AR aging report

Tier: sonnet. Review: N. Branch: feat/T-25-invoice-pdf. Depends: T-23, T-07.

## Owner decision
A server-side PDF library is allowed: add `pdfkit` (and `@types/pdfkit`) to `backend/package.json`. T-31 reuses it for purchase orders.

## Files
- New `backend/src/services/documentPdf.ts`: render quote, invoice and PO with the branding logo from settings (uploads served from `/uploads/...`), store name and address, lines, tax lines, payments, balance due.
- `invoices.ts` and `quotes.ts`: `GET /:id/pdf`; `POST /:id/send` -> PDF attachment via `sendEmail` with templates `invoice`/`quote`; status becomes `sent` only when email returns `sent`. A not-configured email returns that state, never `sent`.
- `reports.ts`: `getArAging(asOf)` buckets current, 1-30, 31-60, 61-90, 90+; report screen.

## Tests
PDF buffer starts with `%PDF`; email off leaves status `draft`; aging buckets.
