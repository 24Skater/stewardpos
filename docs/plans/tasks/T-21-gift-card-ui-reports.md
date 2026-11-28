# T-21 Gift card screens and liability report

Tier: sonnet. Review: N. Branch: feat/T-21-gift-card-ui. Depends: T-20, T-07.

## Files
- POS: sell (preset amounts from setting plus custom), reload, balance check, gift card in the tender picker.
- `reports.ts`: `getGiftCardLiability(asOf)` = outstanding sum, issued, redeemed, voided for a range; report screen.
- Admin list `src/pages/admin/AdminGiftCards.tsx` (last4, balance, status, history).
- Email template `gift_card` on sale when an email is given.

## Tests
Sell flow posts amount not price; liability report math; list shows last4 only.

## Docs
`docs/guides/gift-cards.md`.
