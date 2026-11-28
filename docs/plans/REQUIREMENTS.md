# StewardPOS v1.1 requirements (owner decisions)

Save as `docs/plans/REQUIREMENTS.md` in the stewardpos repo. This is the stable input to the plan, so keep it unchanged between runs (a stable file is cheaper to re-read).

Audience: churches (fundraisers, yard sales, snack stores) and larger institutions (coffee shops, merch stores). Self-hosted, MIT, volunteer cashiers, small budgets. The default experience stays simple. Every advanced feature below is off until an admin turns it on.

## Rules that apply to every feature

1. **Off by default.** Admin enables it in Settings. With everything off, the register behaves as it does today.
2. **Provider pattern.** Anything that touches an outside service gets a port plus adapters, chosen in Settings, exactly like `backend/src/terminal/TerminalAdapterFactory.ts`. Each setting reads `internal | <provider> | off`. Credentials use the existing `credentialCrypto`. An unconfigured provider shows as unavailable. It never pretends to succeed.
3. **The server owns the money.** Integer cents. The client sends item ids, quantities and options, never prices, tax or totals. Keep this true for offline mode too.
4. **Every feature ships with:** a Postgres migration and a SQLite migration, `org_id` on every new table (row-level security is planned), Zod validation, `requirePermission`, audit-log entries, its webhook events, tests, a docs page, a CHANGELOG line.
5. **No legal or tax advice.** Tax rules, gift-card expiry and SMS consent differ by state. Make them configurable, never hard-coded, and say so in the docs.
6. **No emojis** in code, UI copy, docs or commit messages.

## Integration rules

StewardPOS is one of several Steward apps. Each must work alone and talk to the others when all are present.

- Integrate only through documented HTTP APIs, signed webhooks and `external_source` plus `external_id` columns. No shared database, no cross-repo imports, no private packages.
- Every integration is off by default, configured by base URL plus token in Settings, and must never block or break checkout when the sibling is absent or slow (timeout 3 seconds, outbox plus retry).
- One organization has one id across the apps.
- Never add `STRIPE_PLATFORM_*` variables or hard-code a platform domain. `scripts/ci/check-platform-boundaries.sh` must keep passing.
- Reuse Table's vocabulary where concepts overlap, so a later sync is a mapping and not a redesign. Table's modifier model is `ModifierGroup` (min selections, max selections, required) with options that carry a price change. Table's order states are SUBMITTED, CONFIRMED, READY, AWAITING_PICKUP, PICKED_UP, COMPLETED, CANCELED, REFUNDED.
- Add a contract test per integration using a stub sibling.

## Features

Each item has Decision, Build and Not now.

**1. Tips (optional add-on).** Decision: admin-enabled, off by default; most churches never use it. Build: a setting with preset percentages and custom amount; the tip is never taxed, shows on its own receipt line, reports separately, counts toward drawer expected cash when paid in cash, and refunds proportionally. Not now: tip pooling and payout.

**2. Tax (full engine).** Decision: churches are often exempt, but build it completely. Build: named tax rates and jurisdictions; a tax class per item (taxable, exempt, or a chosen rate set); an organization setting for default exempt or taxable; per-sale customer exemption with a certificate number; price-includes-tax or price-plus-tax; rounding rule setting; tax lines on receipts; reports by rate; refunds reverse tax proportionally; discounts apply before tax; tips, donations and gift-card sales are never taxed. Today there is one rate in `settings.taxRateDefault` applied in `backend/src/services/cartPricing.ts`; migrate it without changing existing totals.

**3. Accounting.** Decision: QuickBooks Online first, plus a general export for everything else. Build: an `AccountingPort`; a QuickBooks Online adapter (OAuth 2, a daily summary posting, idempotent, with a sync log); a mapping screen from items, tenders, tax, tips, gift-card liability and donations to accounts; a general journal CSV by day, tender and tax. Not now: Xero, QuickBooks Desktop, bill sync. Sequence it after tax, tips, gift cards and invoices, because their mappings depend on those.

**4. Modifiers and variants.** Decision: add what is missing. Build: modifier groups and options (min, max, required, default, price change, sold-out) using Table's model; an open-price item for yard sales; a sold-out toggle on items and options; a quick-key favorites grid; a generic option set on variants (flavor, size, anything) beyond today's size and color; per-item notes. Not now: combos and bundles, weight-priced items (list them in the plan as later).

**5. Quotes, services and invoices, tied together.** Decision: finish the partly built Services and Quotes modules and add invoices as one document flow: quote, accepted, order or invoice, payments, receipt. Build: invoice numbers per org; statuses draft, sent, partly paid, paid, void, overdue; deposits and partial payments; services as line items; one shared line-item and pricing path (reuse `cartPricing.ts`); PDF and email through the email adapter; an accounts-receivable aging report. Not now: public pay links.

**6. Loyalty with a provider switch.** Decision: build StewardPOS loyalty, and let an admin turn it off in favor of another system (Square, Toast). Build: a `LoyaltyPort` with `internal`, `off` and `external` modes; internal gives earn and redeem rules, lookup by phone or email, an optional expiry, and uses the existing tables (`loyalty_programs`, `customer_loyalty`, `loyalty_transactions`, migration 004). In `external` mode StewardPOS hides loyalty UI and neither awards nor redeems, so nothing is counted twice; it may store an external member id. Not now: a Square Loyalty API adapter (document the port only).

**7. Gift cards (full).** Decision: build completely. Build: sell with preset or custom amounts; secure random codes with a check digit; redeem as a tender, including partial redemption; balance lookup; reload; void unused; optional expiry (default none); a bad-code lockout and rate limit; an outstanding-liability report; sales are liability, never revenue, and are not taxed at sale. Decide in the plan whether to merge with the existing `store_credits` table or keep both, and keep returns-to-store-credit working.

**8. Online order pickup (planning plus fulfillment).** Decision: online ordering itself is future work. Build only fulfillment: an inbound order endpoint (a new API-key scope) accepting a normalized order with `external_source` plus `external_id` (idempotent); a register Pickup screen to look up by code, name or phone; mark picked up (use Table's state names); collect payment at the register if the order is unpaid; tag the source in reports. Write a short future-planning doc for e-commerce adapters (Shopify, WooCommerce, eBay, Table). Not now: building any storefront.

**9. Customer-facing display.** Decision: build it. Build: a paired second-screen route that shows the live cart, totals, tax, tip prompt (when tips are on), payment status and a thank-you screen, plus an idle branding screen; it is read-only and never receives credentials; it updates by server-sent events, with a same-browser fallback. Not now: advertising playlists (Display app territory).

**10. Kitchen.** Decision: future integration with StewardTable. Build: nothing but an `order.created` webhook shaped so Table can consume it, plus one planning note. Do not build a kitchen screen.

**11. Time clock and shifts.** Decision: build, including volunteer hours. Build: clock in and out by PIN; breaks; hours by person and by event or period; edits require a reason and a supervisor and are audited; configurable overtime flag; CSV export. Keep it separate from cashier till shifts, but link them. Respect privacy: only managers see everyone's hours.

**12. Webhooks (complete).** Decision: finish both directions. Build outbound: an event catalog, a subscription screen, a transactional outbox, HMAC-SHA256 signing with a timestamp, retries with backoff and a dead-letter state, a delivery log with redelivery, secret rotation, and SSRF protection that blocks private addresses unless an admin allow-lists a LAN sibling. Build inbound: a small generic handler framework for provider callbacks, with Stripe as the first user. Every other task adds its own events.

**13. Offline mode.** Decision: build it, in phases. Build: PWA shell and catalog cache; queued sales with client-generated idempotency keys; the server re-prices on sync and flags any difference; cash and Zelle allowed offline, card only where the terminal supports its own offline mode, gift-card redemption capped; a visible sync state; daily close blocked until the queue is empty; Playwright tests with the network cut. Recommend running the server on the building's network, so offline means only "no internet". Expect the plan to split this into at least three tasks and mark it for Opus review.

**14. Purchase orders and vendors.** Decision: build, with integration in mind. Build: vendors; purchase orders (draft, sent, partly received, received, closed, cancelled); receiving updates stock and unit cost; a suggested PO from low-stock items; PDF and email; a cost-based margin report. Before designing, read Table's inventory schema (`prisma/schema/inventory.prisma`) and keep vendor and item references as `external_source` plus `external_id` so the apps can sync later without depending on each other.

**15. Recurring payments and memberships.** Decision: build. Build: membership plans (price, interval, benefits such as a percent discount, free items per period or prepaid credit); subscriptions with status, next renewal, pause and cancel; an idempotent renewal job that creates invoices; reminders and dunning by email or SMS; manual-pay memberships (cash or Zelle) with a reminder and a mark-paid action; benefits applied automatically when the member is looked up. Card-on-file goes through a `RecurringPort` using processor tokens only (never store card data), starting with Stripe. Phase it: manual-pay first, card second.

**16. Email and SMS.** Decision: build, with admin-configurable providers. Build: email providers SMTP and Resend (extend what `backend/src/services/email.ts` has); SMS provider Twilio plus a generic HTTP gateway option plus off; an admin screen with encrypted credentials and a test-send button; editable templates with variables (receipt, gift card, invoice, quote, purchase order, membership reminder, pickup ready); a per-event on and off switch; SMS consent, STOP handling and quiet hours; a delivery log. Must fix: `src/components/ReceiptDialog.tsx` fakes email and SMS success with timers (only its tests import it). Delete it or wire it to the real receipt endpoints, so no screen can show "sent" when nothing was sent.

## Proposed, needs the owner's yes or no (plan them, do not build them)

- Zelle confirmation reference on the register, plus configurable Venmo, Cash App and other tenders.
- Campaign or fundraiser tagging on sales, aligned with Table's fundraiser support, for fundraising and yard-sale reports.
- Donation line at checkout, never taxed, kept apart from sales.
- Daily reports bucketed by the store's time zone (today only the hourly report is).
- One verified end-to-end card path (Stripe Terminal or a Square Terminal) on real hardware.

## Known repo facts (so nobody re-discovers them)

- Pricing: `backend/src/services/pricing.ts` and `cartPricing.ts` (`repriceOrder`, integer cents). Tenders: `backend/src/services/tender.ts` (`cash | card | store_credit | zelle | other`).
- Adapter pattern: `backend/src/terminal/` with `TerminalAdapterFactory.ts`; Stripe is written but never run, Square and Clover refunds throw `RefundNotSupportedError`, `ManualTerminalAdapter` always approves.
- Email: `backend/src/services/email.ts` (SMTP, Resend, console). Credentials: `backend/src/services/credentialCrypto.ts`. Routes live in `backend/src/api/routes/`, services in `backend/src/services/`.
- Migrations: `backend/migrations/postgres` and `backend/migrations/sqlite`, numbered up to 028. Both must stay in step.
- Webhooks: `backend/src/api/routes/webhooks.ts` is Stripe-only and inbound-only.
- Roles seeded in `backend/src/services/seeder.ts` (Admin, Supervisor, Reporter, Standard) plus custom roles. API keys carry scopes `read | write | delete | admin`.
- Tests: Vitest in `backend/src` and `src`, Playwright in `e2e/`. Commands: `pnpm test:run`, `pnpm typecheck`.
- Docs rules (CONTRIBUTING.md): conventional commits, tests with new behavior, docs updated in the same change. The changelog outranks the plan.
