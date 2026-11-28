# T-26 Loyalty port: internal, external, off

Tier: sonnet. Review: Y (discounts touch money). Branch: feat/T-26-loyalty. Depends: T-01, T-11.

## Files
- New `backend/src/loyalty/LoyaltyPort.ts` (`lookup(customer)`, `earn(order)`, `redeem(customer, points) -> discountCents`), `InternalLoyalty.ts` using existing tables `loyalty_programs`, `customer_loyalty`, `loyalty_transactions` (migration 004; check columns there first), `OffLoyalty.ts` / `ExternalLoyalty.ts` (both no-ops; external stores `customers.external_loyalty_id`).
- Factory by `providerFor(settings, 'loyalty')`.
- Order transaction: earn on net sales excluding tax, tips, gift-card sales; redeem enters as discount source `loyalty` (already in the `discountSource` enum in `discounts.ts` line 123), applied before tax.
- Optional expiry `loyaltyPointsExpireMonths` via a daily `startJob`.
- Returns reverse earned points proportionally.
- Events: `loyalty.earned`, `loyalty.redeemed`.

## Tests
Earn and redeem math; external and off modes never write `loyalty_transactions`; redeem cannot exceed balance; refund reverses.
