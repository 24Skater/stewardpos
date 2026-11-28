# T-10 Tax rates, jurisdictions and classes (schema plus migration of today's rate)

Tier: sonnet. Review: Y (tax). Branch: feat/T-10-tax-schema. Depends: T-01, T-44.

## Goal
Tax data model, with today's single `settings.tax_rate_default` turned into one rate so no total changes.

## Files
- Migration `034_tax_engine.sql`: `tax_jurisdictions(id, org_id, name)`; `tax_rates(id, org_id, jurisdiction_id, name, rate_bps INTEGER, active)` (basis points: 8.25% = 825); `tax_classes(id, org_id, name, kind taxable|exempt|rates)`; `tax_class_rates(class_id, rate_id)`; `products.tax_class_id NULL`; settings columns `tax_mode exclusive|inclusive DEFAULT exclusive`, `tax_rounding line|order DEFAULT <what cartPricing does today>`, `tax_default_taxable BOOLEAN DEFAULT true`. Data step: when `tax_rate_default > 0`, create jurisdiction "Default", one rate from it, one class "Standard" linked to it. Leave `tax_rate_default` in place, unused once T-11 lands.
- Both adapters: CRUD for the four tables.
- New routes `backend/src/api/routes/tax.ts` under `requirePermission('settings', ...)`; audit entity `tax_rate`, `tax_class`.

## Pre-step (write findings into this file before coding)
Read `backend/src/services/cartPricing.ts` lines 60-106 and `pricing.ts` `repriceOrder` (line 129): note whether tax is rounded per line or per order today. The default for `tax_rounding` must equal that.

## Tests
Migration on a SQLite DB with `tax_rate_default = 0.0825` creates exactly one rate of 825 bps; with 0 creates none; CRUD route tests.

## Docs
`docs/guides/tax.md` (setup half), with "tax law varies; this is not tax advice".

Out of scope: applying rates (T-11).
