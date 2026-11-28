# T-13 Refunds reverse tax and tips proportionally

Tier: sonnet. Review: Y (money). Branch: feat/T-13-tax-refunds. Depends: T-11, T-14, T-45.

## Files
- `backend/src/services/returnPricing.ts` `repriceReturn` (line 114): refund tax per returned line from that line's stored tax (not by re-applying today's rate); tip refund = tip x returned net / order net, rounded so the sum of all refunds never exceeds the original (last return takes the remainder; use `PriorReturn`).
- Write negative `order_tax_lines` rows for the return.

## Tests
Partial return of one of three lines; three partial returns sum exactly to the original tax and tip; rate changed after the sale does not change the refund.
