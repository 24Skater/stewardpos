# T-37 Membership benefits at the register and admin screens

Tier: sonnet. Review: Y (discount money). Branch: feat/T-37-membership-benefits. Depends: T-36.

## Files
- `cartPricing.ts`: when the order customer has an active subscription, apply `discountBps` as discount source `membership` before tax; free items up to `perPeriod` (count usage in `membership_benefit_usage(subscription_id, period_start, product_id, qty)`); prepaid credit as a tender-like balance (ledger like T-19).
- Admin plans and subscriptions screens; POS badge on the picked customer.

## Tests
Discount before tax; free item limit per period; expired subscription gets nothing.

## Docs
`docs/guides/memberships.md`.
