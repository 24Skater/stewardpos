# T-14 Tips

Tier: sonnet. Review: Y (money, drawer). Branch: feat/T-14-tips. Depends: T-01.

## Files
- Settings (in `providers`/`features` from T-01): `tips` on/off, `tipPresetsBps` (e.g. [1500, 1800, 2000]), `tipAllowCustom`.
- Migration `037_tips.sql`: `orders.tip_cents INTEGER NOT NULL DEFAULT 0`.
- Order schema: `tip: { presetBps } | { amountCents }`; server computes cents from the pre-tax subtotal for presets; rejects when the feature is off; tip is never taxed (T-11 flag); total = subtotal + tax + tip.
- Tender: tip paid in cash counts in drawer expected cash (`drawer.ts` close, `cashPortion` in `tender.ts`).
- `Receipt.tsx` separate "Tip" line; `reports.ts` tips in `getSalesSummary` as a separate field, not in sales.
- POS: tip step before tender when on.
- Events: `order.created` data includes `tipCents`.

## Tests
Preset math; custom amount; feature off rejects; not taxed; cash tip raises expected drawer cash; report keeps tips out of net sales.

## Docs
`docs/guides/tips.md`.

Out of scope: pooling and payout.
