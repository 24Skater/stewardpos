# T-27 Loyalty on the register and admin program screen

Tier: sonnet. Review: N. Branch: feat/T-27-loyalty-ui. Depends: T-26.

## Files
- POS: after a customer is picked (`CustomerPicker.tsx`), show points and a Redeem button when internal mode is on; hidden in external and off modes.
- Admin: program rules screen `src/pages/admin/AdminLoyalty.tsx`; external member id field on the customer form in external mode.

## Tests
Hidden when external; redeem applies discount line.

## Docs
`docs/guides/loyalty.md` including the port for a later Square adapter.
