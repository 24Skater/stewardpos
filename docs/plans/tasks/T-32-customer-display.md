# T-32 Customer-facing display

Tier: sonnet. Review: Y (pairing, data exposure). Branch: feat/T-32-customer-display. Depends: T-01, T-14.

## Owner decision
The display is read-only, with one exception: it may send a tip choice when tips are on and the display was paired as a touch screen.

## Files
- Pairing: a display gets its own token bound to one register (reuse the pairing-code flow in `services/registerEnrolment.ts`). Store `customer_displays(id, org_id, register_id, token_hash, is_touch BOOLEAN, created_at, revoked_at)`. The token grants only `GET /api/display/stream` and, when tips are on and `is_touch`, `POST /api/display/tip { presetBps } | { amountCents }` for the register's current open sale (server validates against presets and a custom cap, then the register shows the chosen tip before tender). Never sends settings, credentials, or customer details beyond first name.
- New `backend/src/api/routes/display.ts`: SSE stream of `{ lines, subtotalCents, taxCents, tipPrompt, paymentStatus, thankYou }`, pushed when the register's cart changes (register calls `PUT /api/display/cart`; the server prices it with `priceCart`, never client totals).
- New `src/pages/CustomerDisplay.tsx` at `/display`: idle branding (logo from branding settings), live cart, tip buttons on touch displays, thank-you. Same-browser fallback through `BroadcastChannel` when opened from the register window (no tip input on the fallback).
- Admin Registers screen: pair, revoke, touch switch.

## Tests
Display token rejected on every other route; tip refused when tips are off or the display is not touch; SSE emits on cart change; idle after the sale; fallback channel.

## Docs
`docs/guides/customer-display.md`.
