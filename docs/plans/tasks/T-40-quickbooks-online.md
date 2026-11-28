# T-40 QuickBooks Online adapter

Tier: sonnet. Review: Y (OAuth tokens, accounting). Branch: feat/T-40-qbo. Depends: T-39.

## Files
- New `backend/src/accounting/QuickBooksOnline.ts`: OAuth 2 authorization code flow (`/api/accounting/qbo/connect`, `/callback` with `state`), tokens encrypted with `encryptCredentials`, refresh on 401; `postDailySummary` posts one JournalEntry per business day with a request id of `stewardpos:<org>:<date>` for idempotency; reads chart of accounts for the mapping screen.
- Daily `startJob` posts yesterday once; sync log row; retry failures next run.
- Client id/secret in environment (`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`), not the database.

## Tests
Contract test with `stubSibling` acting as QBO: same day posted twice -> one entry; token refresh path; failure logged.
