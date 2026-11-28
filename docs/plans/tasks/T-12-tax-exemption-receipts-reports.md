# T-12 Customer exemption at sale, tax lines on receipts, report by rate, admin screen

Tier: sonnet. Review: Y (tax). Branch: feat/T-12-tax-ui. Depends: T-11.

## Files
- Orders: accept `taxExemption: { certificateNumber, reason? }` in the order Zod schema (`orders.ts`); requires permission `orders:write` plus setting on; stored on `orders.tax_exempt_certificate`; engine then taxes 0 and audit logs it. Migration `036_order_tax_exempt.sql`. Customers get optional `tax_exempt_certificate` used as the default.
- `Receipt.tsx`: one line per `order_tax_lines` row.
- `reports.ts`: `getTaxByRate(range)`; route in `reports.ts`; table in `src/components/reports/` (copy `SalesReport` layout).
- `src/pages/admin/AdminTax.tsx`: jurisdictions, rates, classes; tax class select on the product form in `AdminInventory.tsx`.
- POS: "Tax exempt" action in the cart with a certificate field.

## Tests
Exempt sale has zero tax and a stored certificate; receipt shows lines; report sums by rate; screen CRUD.

## Docs
`docs/guides/tax.md` second half.
