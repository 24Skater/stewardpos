# T-31 PO screens, suggested PO, PDF/email, margin report

Tier: sonnet. Review: N. Branch: feat/T-31-po-ui. Depends: T-30, T-25.

## Files
- `src/pages/admin/AdminPurchaseOrders.tsx` and vendors screen.
- Suggested PO: low-stock products (existing low-stock threshold from migration 013) grouped by preferred vendor, quantity to threshold x 2.
- PDF and email through `documentPdf.ts` and template `purchase_order`.
- `reports.ts` `getMarginByProduct(range)` using `unit_cost_cents`; products with no cost show "no cost".

## Tests
Suggested PO quantities; margin math; missing cost excluded from totals.

## Docs
`docs/guides/purchase-orders.md`.
