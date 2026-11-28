# T-43 Offline phase 3: sync state, close gate, end-to-end tests

Tier: sonnet. Review: Y (offline). Branch: feat/T-43-offline-close. Depends: T-42.

## Files
- Register: visible queue count and last sync time; manual "Sync now".
- `drawer.ts` close and any daily close: refuse while the register reports a non-empty queue (`X-Offline-Queue` header or a status call), with a clear message.
- `e2e/offline.spec.ts`: sell two items offline, restore network, sync, see orders and drawer totals; close blocked until synced.

## Docs
`docs/guides/offline.md`: recommend running the server on the building network so offline means "no internet".
