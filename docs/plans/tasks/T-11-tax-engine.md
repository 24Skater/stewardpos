# T-11 Tax engine in pricing

Tier: sonnet. Review: Y (money). Branch: feat/T-11-tax-engine. Depends: T-10.

## Files
- New `backend/src/services/taxEngine.ts`: `computeTax(lines, ctx) -> { lines: [{ lineId, taxCents, rates: [{rateId, cents}] }], totalTaxCents, byRate }`. Inputs per line: net cents after discounts, tax class, `nonTaxable` flag. Rules: discounts before tax; inclusive mode backs tax out of the price; rounding by the `tax_rounding` setting, half-up on integer cents; class `exempt` and lines flagged `tip | donation | gift_card_sale` produce 0; product with no class uses `tax_default_taxable` and the Standard class.
- `cartPricing.ts` `priceCart` (line 74 reads `taxRateDefault`): replace with `computeTax`. `pricing.ts` `repriceOrder`: same.
- Migration `035_order_tax_lines.sql`: `order_tax_lines(id, org_id, order_id, rate_id, name, rate_bps, taxable_cents, tax_cents)`; write rows in the order transaction in both adapters.

## Tests
`taxEngine.test.ts`: inclusive and exclusive; two rates on one line; rounding modes; exempt class; discount before tax. Golden test: replay the existing `cartPricing` and `pricing` test fixtures and assert identical totals to before the change (copy expected values from the current tests, do not recompute).

Out of scope: exemption at sale, receipts, refunds.
