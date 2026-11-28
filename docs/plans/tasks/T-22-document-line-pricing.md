# T-22 One line-item pricing path for quotes, invoices and orders

Tier: sonnet. Review: Y (money). Branch: feat/T-22-document-pricing. Depends: T-11, T-46.

## Goal
Quotes and invoices price lines with the same code as the register.

## Pre-step
Read `backend/src/api/routes/quotes.ts` (226 lines) and `services.ts` (169): note where quote totals are computed today and whether they trust client prices. Write it here.

## Files
- New `backend/src/services/documentPricing.ts`: `priceDocument(lines)` where a line is `{ productId, variantId?, modifierOptionIds?, quantity } | { serviceId, quantity, hours? }`; services priced from `services` rows; delegates products to `priceCart`; tax via `computeTax`. Returns cents.
- `quotes.ts` create/update: replace any client totals with `priceDocument`.

## Tests
Quote with a product and a service equals the same cart priced at the register; client-sent totals ignored.
