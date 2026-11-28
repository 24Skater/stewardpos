# T-16 Modifier picker on the register, per-item notes, admin screens

Tier: sonnet. Review: N. Branch: feat/T-16-modifiers-ui. Depends: T-15.

## Files
- New `src/components/ModifierPicker.tsx` (pattern: `VariantPicker.tsx`): groups with min/max hints, required marked, sold-out disabled, defaults pre-selected; returns option ids and a note.
- `POS.tsx`: open it when a product has groups; show options and note under the cart line (`Cart.tsx`).
- `Receipt.tsx`: option lines and note.
- Admin: groups and options screen `src/pages/admin/AdminModifiers.tsx`; bind groups on the product form; sold-out toggles on product and option.

## Tests
Picker enforces required before Add; sold-out disabled; cart shows options.

## Docs
`docs/guides/modifiers.md`.
