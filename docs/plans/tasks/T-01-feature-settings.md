# T-01 Feature switches and provider settings

Tier: sonnet (new settings shape across both adapters plus a screen). Review: N. Branch: feat/T-01-feature-settings

## Goal
One place every later task reads "is feature X on" and "which provider for Y".

## Files
- New migration `029_feature_settings.sql` (postgres + sqlite): add `features` and `providers` JSON columns (NOT NULL DEFAULT '{}') to `settings`.
- `PostgresAdapter.ts` / `SQLiteAdapter.ts`: map them in the settings getter/updater (beside the `taxRateDefault` mapping, ~line 1895 / 1822).
- New `backend/src/services/features.ts`: `isFeatureOn(settings, key)`, `providerFor(settings, key): string` (default `'off'`).
- `backend/src/api/routes/admin.ts`: extend the settings Zod schema (~line 544) with `features: z.record(z.string(), z.boolean())` and `providers: z.record(z.string(), z.unknown())`. Secrets inside `providers` go through `encryptCredentials`.
- `src/pages/admin/AdminSettings.tsx`: new "Features" tab listing switches from a constant `FEATURES` in `src/lib/features.ts`.

## Contracts
Feature keys: `tips, taxEngine, modifiers, openPrice, giftCards, invoices, loyalty, timeClock, purchaseOrders, customerDisplay, pickup, memberships, accounting, offline, webhooks, sms`. Provider keys: `email, sms, loyalty, accounting, recurring`.

## Tests
`services/__tests__/features.test.ts` (unknown key is off, provider default off); SQLite adapter round-trip; `AdminSettings` Features tab renders and saves a switch.

## Docs
`docs/guides/features.md` listing every switch, all off by default.

Out of scope: any feature behavior.
