# T-19 Gift cards: ledger, codes, issue, reload, void, expiry

Tier: sonnet. Review: Y (gift-card ledger). Branch: feat/T-19-gift-cards. Depends: T-01, T-11, T-45.

## Decision
Keep `store_credits` (migration 003, used by returns; converted to cents in T-45) as its own table. Gift cards get their own cents ledger. A return still issues store credit. Both are redeemed through one tender service in T-20.

## Files
- Migration `041_gift_cards.sql`: `gift_cards(id, org_id, code_hash, last4, status active|void|expired, expires_at NULL, created_at)`; `gift_card_ledger(id, org_id, gift_card_id, kind issue|reload|redeem|void|expire|adjust, amount_cents, order_id NULL, actor_id, created_at)`. Balance = sum of the ledger; never a stored mutable balance.
- New `backend/src/services/giftCards.ts`: `generateCode()` 16 chars from an unambiguous alphabet with `crypto.randomInt`, last char a Luhn mod-N check digit; store a SHA-256 hash plus last4 only; `issue`, `reload`, `voidCard` (only with zero redemptions, else refuse), `balance`.
- Expiry: setting `giftCardExpiryMonths` default null (none). Docs say expiry is regulated in many states.
- Sale: a gift-card line is a non-taxable liability line (T-11 flag), reported apart from revenue.
- Events: `gift_card.issued`, `gift_card.redeemed`, `gift_card.voided`.

## Tests
Check digit rejects a one-char typo; balance equals ledger sum; void after redemption refused; concurrent redemptions cannot overdraw (postgres integration with row lock).
