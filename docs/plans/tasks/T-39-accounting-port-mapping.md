# T-39 Accounting port, account mapping, general journal CSV

Tier: sonnet. Review: Y (accounting mapping). Branch: feat/T-39-accounting. Depends: T-13, T-14, T-21, T-23.

## Files
- New `backend/src/accounting/AccountingPort.ts` (`postDailySummary(summary)`, `testConnection()`), `OffAccounting.ts`.
- New `backend/src/services/journal.ts`: `buildDailySummary(date, timeZone)` -> balanced debit/credit lines by: item category revenue, tenders, tax by rate, tips payable, gift-card liability (sold vs redeemed), donations, discounts, refunds. Debits must equal credits; throw otherwise.
- Migration `047_accounting.sql`: `account_mappings(id, org_id, source_kind, source_id NULL, account_ref)`; `accounting_sync_log(id, org_id, provider, business_date, status, external_ref, error, created_at)` unique (org_id, provider, business_date).
- Mapping screen `src/pages/admin/AdminAccounting.tsx`; CSV export `GET /api/accounting/journal.csv?from&to`.

## Tests
Summary balances for a day with cash, card, gift card sale and redemption, tip, tax, refund; unmapped source reported, not dropped.

## Docs
`docs/guides/accounting.md`.
