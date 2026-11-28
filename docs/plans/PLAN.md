# StewardPOS v1.1 plan

Inputs: [REQUIREMENTS.md](./REQUIREMENTS.md), [STANDARDS.md](./STANDARDS.md), [tasks/](./tasks/). Executors: `.claude/agents/sp-sonnet.md`, `sp-haiku.md`.

## Order

Foundations first, as hinted. Changes: T-08 (ReceiptDialog fakes "sent") goes first because it is a live bug; tips join tax because refunds (T-13) need both; invoices precede memberships because renewals create invoices; offline last. Migration numbers in tasks are provisional and taken at merge time (STANDARDS 6).

## Phases (-> is sequential, {} parallel)

1. Foundations: {T-01, T-04, T-08, T-09} -> {T-02, T-05} -> {T-03, T-06, T-07}
1b. Money to cents: T-44 -> {T-45, T-46}. Runs alone: it touches both adapters everywhere, so nothing else merges meanwhile.
2. Tax and tips: T-10 -> T-11 -> {T-12, T-14} -> T-13
3. Modifiers: {T-15, T-17, T-18} -> T-16
4. Gift cards: T-19 -> T-20 -> T-21
5. Documents: T-22 -> T-23 -> {T-24, T-25}
6-8. Loyalty T-26 -> T-27; time clock T-28 -> T-29; POs T-30 -> T-31 (these three phases can run together)
9. Customer display: T-32
10. Pickup and kitchen: T-33 -> {T-34, T-35}
11. Memberships: T-36 -> {T-37, T-38}
12. Accounting: T-39 -> T-40
13. Offline: T-41 -> T-42 -> T-43

## Tasks

Diff: S under 150 lines, M 150-400, L 400-600. Only two haiku tasks: nearly every task adds a business rule, and docs, CHANGELOG and tests ship inside each task instead of as separate haiku tasks that would reload the same context.

| ID | Title | Tier | Diff | Depends on | Opus review |
|---|---|---|---|---|---|
| T-01 | Feature switches and provider settings | sonnet | M | - | N |
| T-02 | Outbox, job runner, signed delivery | sonnet | L | T-01, T-09 | Y |
| T-03 | Webhook screen, SSRF guard, delivery log | sonnet | L | T-02 | Y |
| T-04 | Inbound callback framework (Stripe first) | sonnet | M | - | Y |
| T-05 | Email providers in Settings, message log | sonnet | M | T-01 | N |
| T-06 | SMS port, consent, STOP, quiet hours | sonnet | L | T-04, T-05 | N |
| T-07 | Message templates | sonnet | M | T-05 | N |
| T-08 | ReceiptDialog uses real send results | sonnet | S | - | N |
| T-09 | Sibling HTTP client and stub sibling | haiku | S | - | N |
| T-10 | Tax schema, migrate today's rate | sonnet | M | T-01, T-44 | Y |
| T-11 | Tax engine in pricing | sonnet | L | T-10 | Y |
| T-12 | Exemption, receipt tax lines, report, screen | sonnet | L | T-11 | Y |
| T-13 | Proportional tax and tip refunds | sonnet | M | T-11, T-14, T-45 | Y |
| T-14 | Tips | sonnet | M | T-01 | Y |
| T-15 | Modifier groups, server pricing | sonnet | L | T-01 | Y |
| T-16 | Modifier picker, notes, admin | sonnet | M | T-15 | N |
| T-17 | Open price on yard-sale registers, quick keys | sonnet | M | T-01, T-44 | Y |
| T-18 | Generic variant option sets | sonnet | M | - | N |
| T-19 | Gift-card ledger and codes | sonnet | M | T-01, T-11, T-45 | Y |
| T-20 | Gift card as tender, lockout | sonnet | M | T-19 | Y |
| T-21 | Gift-card screens, liability report | sonnet | M | T-20, T-07 | N |
| T-22 | Shared document pricing | sonnet | M | T-11, T-46 | Y |
| T-23 | Invoices, payments, deposits | sonnet | L | T-22, T-02 | Y |
| T-24 | Quote to invoice flow screens | sonnet | L | T-23 | N |
| T-25 | PDF, email, AR aging | sonnet | M | T-23, T-07 | N |
| T-26 | Loyalty port | sonnet | M | T-01, T-11 | Y |
| T-27 | Loyalty screens | sonnet | S | T-26 | N |
| T-28 | Time clock service and permissions | sonnet | M | T-01 | Y |
| T-29 | Time clock screens, CSV | sonnet | M | T-28 | N |
| T-30 | Vendors, POs, receiving | sonnet | L | T-02 | N |
| T-31 | PO screens, suggested PO, margin | sonnet | L | T-30, T-25 | N |
| T-32 | Customer-facing display | sonnet | L | T-01, T-14 | Y |
| T-33 | Inbound order endpoint | sonnet | M | T-02, T-11 | Y |
| T-34 | Pickup screen | sonnet | M | T-33, T-07 | N |
| T-35 | order.created shape, kitchen and e-commerce notes | haiku | S | T-02 | N |
| T-36 | Memberships, renewal job (manual pay) | sonnet | L | T-23, T-05 | Y |
| T-37 | Membership benefits at the register | sonnet | M | T-36 | Y |
| T-38 | Card renewals via RecurringPort (Stripe) | sonnet | M | T-36, T-04 | Y |
| T-39 | Accounting port, mapping, journal CSV | sonnet | L | T-13, T-14, T-21, T-23 | Y |
| T-40 | QuickBooks Online adapter | sonnet | L | T-39 | Y |
| T-41 | Offline 1: PWA shell, catalog cache | sonnet | M | T-01 | Y |
| T-42 | Offline 2: queued sales, re-pricing | sonnet | L | T-41 | Y |
| T-43 | Offline 3: sync state, close gate, e2e | sonnet | M | T-42 | Y |
| T-44 | Money to cents: catalog, orders, payments | sonnet | L | - | Y |
| T-45 | Money to cents: returns, store credit, drawer | sonnet | M | T-44 | Y |
| T-46 | Money to cents: quotes, discounts, archive | sonnet | M | T-44 | Y |

## Coverage

Rules 1-6: STANDARDS 4-17, T-01; cents everywhere: T-44 to T-46. Integration rules: T-09, T-02, T-33, T-40. Req 1: T-14, T-13. 2: T-10 to T-13. 3: T-39, T-40. 4: T-15 to T-18. 5: T-22 to T-25. 6: T-26, T-27. 7: T-19 to T-21 (`store_credits` kept separate, see T-19). 8: T-33, T-34, T-35. 9: T-32. 10: T-35. 11: T-28, T-29. 12: T-02 to T-04. 13: T-41 to T-43. 14: T-30, T-31. 15: T-36 to T-38. 16: T-05 to T-08.

## Later (Not now)

Tip pooling and payout; Xero, QuickBooks Desktop, bill sync; combos, bundles, weight-priced items; public pay links; Square Loyalty adapter; storefronts; display ad playlists; kitchen screen.

## PROPOSED (no tasks, nothing started)

- Zelle confirmation reference; configurable Venmo, Cash App and other tenders.
- Campaign or fundraiser tagging on sales, aligned with Table.
- Untaxed donation line at checkout (T-11 reserves the `donation` flag).
- Daily reports bucketed by store time zone.
- One verified card path on real hardware.

## Corrections to Known repo facts

- `ReceiptDialog.tsx` is not test-only: `POS.tsx` opens it after every sale (T-08).
- The backend has no job runner; T-02 adds `services/jobs.ts` for T-23, T-26, T-36, T-40.

## Owner decisions (were open questions)

1. Money: convert all existing `DECIMAL` money columns to integer cents (T-44 to T-46). The API keeps dollars until a later change.
2. Open price: allowed only on registers an admin marks "Yard sale: allow manual prices", within product bounds, audited (T-17).
3. Display tips: the display may send a tip choice only when tips are on and it was paired as a touch screen (T-32).
4. Server PDFs: `pdfkit` is allowed in the backend (T-25, T-31).
5. RLS takes the next free migration number when it lands.
