# T-41 Offline phase 1: PWA shell and catalog cache

Tier: sonnet. Review: Y (offline). Branch: feat/T-41-offline-shell. Depends: T-01.

## Files
- Service worker (check `package.json` for an existing PWA plugin before adding one; open question if none) caching the app shell and `/api/products`, categories, modifiers, tax config, settings needed to show prices.
- `src/lib/offline/catalogCache.ts`: IndexedDB store with a version stamp; refreshed on every successful load.
- Connection indicator in the register header.

## Tests
Cache refresh replaces stale version; shell loads with network off (Playwright, `context.setOffline(true)`).
