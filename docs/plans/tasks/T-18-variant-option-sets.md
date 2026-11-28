# T-18 Generic option sets on variants

Tier: sonnet. Review: N. Branch: feat/T-18-option-sets.

## Pre-step
Grep `product_variants` in `001_initial_schema.sql` and the variants route; note how size and color are stored; write it here.

## Files
- Migration `040_variant_options.sql`: `variant_option_types(id, org_id, product_id, name, sort_order)`, `variant_option_values(variant_id, type_id, value)`. Backfill existing size and color into rows; keep the old columns readable.
- Variants route and `VariantPicker.tsx`: render any option types.

## Tests
Backfill keeps existing variants selectable; a "Flavor" type works end to end.
