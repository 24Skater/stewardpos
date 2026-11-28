# T-15 Modifier groups and options (Table's model), server pricing

Tier: sonnet. Review: Y (money). Branch: feat/T-15-modifiers-api. Depends: T-01.

## Contracts (match Table's modifier model)
- `modifier_groups(id, org_id, name, default_min_selections, default_max_selections, default_is_required, deleted_at)`
- `modifier_options(id, org_id, group_id, name, price_delta_cents, sort_order, is_default, sold_out, deleted_at)`
- `product_modifier_groups(id, org_id, product_id, group_id, sort_order, override_min, override_max, override_is_required)`
Migration `038_modifiers.sql`. Also `products.sold_out BOOLEAN DEFAULT false`.

## Files
- Both adapters CRUD; routes `backend/src/api/routes/modifiers.ts` under `inventory` permission; audit.
- `CartLine` (`cartPricing.ts` line 29) gains `modifierOptionIds?: string[]` and `note?: string` (max 200 chars). Server validates min/max/required per binding, rejects sold-out options and products, adds `price_delta_cents` to the unit price. Store chosen options on the order item (`order_item_modifiers(order_item_id, option_id, name, price_delta_cents)`) so receipts survive later edits.

## Tests
Required group missing -> 400; max exceeded -> 400; sold-out rejected; deltas priced; client-sent price ignored.

Out of scope: POS UI (T-16).
