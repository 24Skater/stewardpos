# T-08 Stop ReceiptDialog faking email and SMS

Tier: sonnet (small, but checkout UI). Review: N. Branch: fix/T-08-receipt-dialog

## Fact correction
REQUIREMENTS says only tests import `src/components/ReceiptDialog.tsx`. `src/pages/POS.tsx` imports it (line 8) and opens it after each sale (lines 835, 1049; rendered at 1367).

## Goal
No screen can say "sent" when nothing was sent.

## Files
- `ReceiptDialog.tsx`: delete the timer success paths. Email calls `POST /api/receipts/:id/resend` (`receipts.ts` line 258) through `src/lib/api/receipts.ts` and shows the server's status: `sent`; `logged` -> "Email is not set up, so nothing was sent"; `failed` -> the error. Remove the SMS button until T-06 lands.
- `POS.tsx`: pass the order id.

## Tests
Update `components/__tests__/ReceiptDialog.test.tsx`: resend called with the id; `logged` shows not-sent copy; failure shows error; no SMS button.

Out of scope: templates.
