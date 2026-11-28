# T-24 Finish the Quotes and Services screens as one flow

Tier: sonnet. Review: N. Branch: feat/T-24-quotes-flow. Depends: T-23.

## Pre-step
List what `AdminQuotes.tsx`, `AdminServices.tsx` and `ServicesPos.tsx` do today and what is stubbed; write it here before coding.

## Goal
Quote -> accepted -> order (pay now at the register) or invoice (pay later) -> payments -> receipt, all visible on one document page.

## Files
- `AdminQuotes.tsx`: send, accept (with optional deposit), convert to order or invoice.
- New `src/pages/admin/AdminInvoices.tsx`: list by status, detail with payments, record payment, void.
- `ServicesPos.tsx`: take an invoice payment at the register (looks up by number).
- `src/lib/api/invoices.ts`.

## Tests
Convert quote to invoice; record payment updates status; register pays an invoice.

## Docs
`docs/guides/quotes-invoices.md`.
