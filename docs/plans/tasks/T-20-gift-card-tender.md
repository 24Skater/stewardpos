# T-20 Gift card as tender, balance lookup, lockout

Tier: sonnet. Review: Y (gift-card ledger, brute force). Branch: feat/T-20-gift-card-tender. Depends: T-19.

## Files
- `backend/src/services/tender.ts`: add `gift_card` to `TenderMethod` (line 18) and label; `validateTender` requires a code reference; partial redemption allowed up to balance; remaining due goes to another tender.
- Order transaction: lock the card, insert `redeem` ledger row, fail the whole order if balance moved.
- New route `backend/src/api/routes/giftCards.ts`: `POST /lookup` (code -> balance, last4), `POST /`, `POST /:id/reload`, `POST /:id/void`.
- Lockout: copy `passwordLockout.ts` pattern keyed by register and IP; 5 bad codes in 15 min -> 15 min lock; plus express rate limit on lookup.
- Returns: refunding a gift-card tender re-credits the card (`adjust`).

## Tests
Partial tender; insufficient balance; lockout after 5; refund re-credits; split tender gift card plus cash.
