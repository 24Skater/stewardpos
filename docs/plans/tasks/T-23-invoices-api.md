# T-23 Invoices: numbers, statuses, deposits, partial payments, quote conversion

Tier: sonnet. Review: Y (money). Branch: feat/T-23-invoices. Depends: T-22, T-02.

## Files
- Migration `042_invoices.sql`: `invoices(id, org_id, number, customer_id, quote_id NULL, status draft|sent|partly_paid|paid|void|overdue, issue_date, due_date, subtotal_cents, tax_cents, total_cents, paid_cents, created_at)`, unique (org_id, number); `invoice_lines` (frozen priced lines); `invoice_payments(id, org_id, invoice_id, method, amount_cents, reference, order_id NULL, created_at)`; `invoice_counters(org_id, next_number)` incremented in the same transaction.
- New `backend/src/services/invoices.ts`: `createFromQuote`, `recordPayment` (rejects over-payment, moves status), `voidInvoice` (only unpaid), `markOverdue` job via `startJob` (daily).
- Deposit = a payment recorded before `sent`/accepted; quote accept with `depositCents` creates invoice plus payment request.
- Routes `backend/src/api/routes/invoices.ts` under `services` permission; audit; tender methods reuse `validateTender`.
- Events: `invoice.created`, `invoice.paid`, `invoice.voided`, `quote.accepted`.

## Tests
Numbers sequential per org under concurrency (postgres); partial then full payment status path; overpay refused; void after payment refused; overdue job.
