# T-34 Register pickup screen

Tier: sonnet. Review: N. Branch: feat/T-34-pickup. Depends: T-33, T-07.

## Files
- `src/pages/Pickup.tsx` (register route): search by code, name or phone digits; list READY and AWAITING_PICKUP; mark picked up -> PICKED_UP then COMPLETED; unpaid orders open the normal tender flow.
- Template `pickup_ready` sent when an order moves to READY.
- Reports: filter and column for `external_source`.

## Tests
Lookup by code and phone; unpaid order requires tender; status transitions.

## Docs
`docs/guides/pickup.md`.
