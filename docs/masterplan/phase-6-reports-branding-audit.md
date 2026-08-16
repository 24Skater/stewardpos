# Phase 6 — Reports, Exports, Branding & Audit

**Objective.** Round out the admin surface: accurate reporting with PDF/Excel/CSV export, full
store/receipt branding, and a usable audit‑log view. All reads are RBAC‑gated and org‑scoped, and all
figures come from server‑persisted (repriced) data.

**Entry criteria.** Phases 3–5 green (real orders, returns, discounts to report on).

**Exit criteria.**
- Sales/returns/inventory reports with date filtering, computed from persisted orders/returns.
- Export to PDF (`jspdf`), Excel (`xlsx`), and CSV matches on‑screen figures.
- Branding UI (store identity, logo/favicon, brand color, receipt header/footer) persists to
  `settings` and is reflected in the app + receipts with a live preview.
- Audit log is filterable/paginated and shows before/after for mutations.

---

### `P6-T1` — Reporting queries (API)
**Context.** Reports must aggregate from persisted data server‑side, not recompute in the browser.
**Files.** `backend/src/api/routes/reports.ts` (create if missing; the frontend has `AdminReports`),
a `reports` service with SQL aggregations, `src/lib/api/reports.ts`.
**Steps.**
1. Endpoints (all `authorize('reports','read')`, org‑scoped, `?from=&to=` date range):
   - `GET /api/reports/sales-summary` → gross, discounts, tax, net, refunds, order count, avg ticket.
   - `GET /api/reports/sales-by-day` → time series for charts (`recharts`).
   - `GET /api/reports/top-products` → best sellers by qty/revenue.
   - `GET /api/reports/payment-mix` → cash vs card totals.
   - `GET /api/reports/returns-summary` → refund totals/reasons.
2. Compute in SQL (sum on `DECIMAL`), return numbers ready to render. Handle empty ranges.
**Acceptance criteria.** Reports reconcile exactly with the underlying orders/returns for a known
seeded dataset.
**Verification.** Seed N orders with known totals → `sales-summary` matches hand‑computed figures
(integration test).

### `P6-T2` — Reports UI + charts  `[parallel-ok]`
**Files.** `src/pages/Reports.tsx`, `src/pages/admin/AdminReports.tsx`, chart components.
**Steps.** Date‑range picker, summary cards, `recharts` visualizations fed by P6‑T1. Follow
`dataviz` skill conventions (consistent palette, accessible, light/dark). Loading/empty/error states.
**Acceptance criteria.** Reports render correctly and update with the date range.
**Verification.** Manual: change range → figures + charts update; matches API responses.

### `P6-T3` — Exports: PDF / Excel / CSV
**Files.** `src/lib/export-utils.ts`, `src/pages/admin/AdminExports.tsx`, optional backend
`GET /api/reports/*/export`.
**Steps.** From the same report data, export PDF (`jspdf`+`jspdf-autotable`), Excel (`xlsx`), and CSV.
Include store branding on the PDF. Ensure exported figures equal on‑screen figures (same source).
**Acceptance criteria.** All three formats export and reconcile with the report.
**Verification.** Export a sales report as each format → totals match the UI.

### `P6-T4` — Branding & receipt customization
**Context.** `settings` has `store_name/email/phone/logo_url/icon_url/brand_color/config`;
`AdminSettings` + `AdminReceipts` pages exist. Make them persist and take effect.
**Files.** `backend/src/api/routes/admin.ts` (settings CRUD), `src/pages/admin/AdminSettings.tsx`,
`src/pages/admin/AdminReceipts.tsx`, theme/brand‑color application, `Receipt.tsx`.
**Steps.**
1. `GET/PUT /api/admin/settings` (authorize `settings`): store identity, logo/favicon (uploaded via
   Phase 4 storage), brand color, receipt header/footer, tax rate default, timezone.
2. Apply `brand_color` to the theme (CSS variable) with a live preview; set favicon; show logo in the
   POS header and on receipts.
3. Receipt customization (header/footer/logo) flows into the Phase 3 receipt renderer.
**Acceptance criteria.** Branding changes persist and immediately affect UI + receipts.
**Verification.** Change brand color + upload logo → header/receipt update after save; reload persists.

### `P6-T5` — Audit log view  `[parallel-ok]`
**Files.** `backend/src/api/routes/admin.ts` (audit list), `src/pages/admin/AdminAudit.tsx`.
**Steps.** `GET /api/admin/audit` with pagination + filters (user, entity, action, date). UI table
with before/after diff view. RBAC `authorize('users'|'settings','read')` or a dedicated `audit` read.
**Acceptance criteria.** Mutations (from P2‑T7) are visible, filterable, paginated.
**Verification.** Perform several mutations → they appear filtered correctly in AdminAudit.

### `P6-T6` — API keys management (optional‑but‑scaffolded)  `[parallel-ok]`
**Context.** `apikeys.ts` + `AdminApiKeys` exist. If kept in v1, secure them; else flag as beta.
**Files.** `backend/src/api/routes/apikeys.ts`, `src/pages/admin/AdminApiKeys.tsx`.
**Steps.** If retained: keys are hashed at rest, shown once on creation, scoped + revocable,
rate‑limited, and usable as an alternate auth for read endpoints. Otherwise, hide behind a flag and
document as experimental.
**Acceptance criteria.** Either a secure, documented API‑key flow, or a clearly‑flagged beta.
**Verification.** Create a key → it authenticates a scoped read; revoke → it stops working.

---

## Completion notes (2026-08-16)

All six tasks are done. What follows is what actually landed, what it turned up,
and what was deliberately left — read this rather than the task list above for
the current state.

### P6-T1: the reports were never computed on the server

There was no `reports.ts` route at all. `Reports`, `AdminReports`,
`AdminExports` and `Dashboard` each called `ordersApi.list()` and added the
whole orders table up in the browser. That made every report a function of how
much a till could hold, and it is the reason the list adapters still have no
`LIMIT`: a cap there would not have slowed those pages down, it would have
turned "the month's takings" into "the takings of the fifty orders that came
back".

Five endpoints now exist, all behind `reports:read`, all taking the same
`?from=&to=`:

| Endpoint | Returns |
|---|---|
| `GET /api/reports/sales-summary` | gross, discounts, tax, net, refunds, net after refunds, average ticket, order count |
| `GET /api/reports/sales-by-day` | the same takings as a daily series |
| `GET /api/reports/top-products` | best sellers by revenue, capped at 100 |
| `GET /api/reports/payment-mix` | tender split |
| `GET /api/reports/returns-summary` | refunds and the reasons given |

The sums are SQL, in both adapters. Derived figures — an average, a net of
refunds — are computed in `services/reports.ts` in integer cents, for the reason
`pricing.ts` sets out: `100 / 3` in floating dollars is `33.333333333333336`,
which is not money.

**Definitions, so two screens cannot disagree.** `gross` is `SUM(subtotal)` —
line totals before discount and tax. `net` is `SUM(total)`, what was charged, so
`gross - discounts + tax = net` reconciles exactly and there is a test that says
so against a real Postgres. Refunds count **completed returns only**, matched on
the date the return was raised rather than the date of the sale: a report for
last week that rewrote itself when something sold in it came back this week
would not reconcile with anything printed from it earlier. What is pending is
reported separately rather than hidden.

**Payment mix reads two sources.** `payments` carries the split-tender
breakdown, but orders taken before that migration have no rows there. Reading
only `payments` would report a shop's entire pre-upgrade history as paid by
nothing; letting both branches match would count split sales twice. The
`NOT EXISTS` fallback is covered by an integration test that asserts the mix
sums to the net.

### SQLite sums money in floating point, and CI found it

The SQLite spec skips locally (no native binding on Windows) and throws in CI, so
its SQL only ever executes there — and it earned its keep twice on this branch.
The second finding is the substantive one.

Money is `DECIMAL(10,2)` in Postgres, where a `SUM` is exact. In SQLite it is
`REAL` — IEEE floating point. Summing $15.12 and $5.00 yields
`20.119999999999997`, which reaches a report card as
"$20.119999999999997" and, worse, does not reconcile against the same period read
from Postgres. Every money aggregate in the SQLite adapter's reporting queries is
now `ROUND(..., 2)`, restoring the DECIMAL semantics the rest of the system
assumes, with a test that names the case.

(The first finding was duller and still worth having: `order_items.variant_id` is
`NOT NULL`, and the fixture wrote lines without one. Nothing had caught it
because the only other order in that file carries no items at all.)

### Day bucketing follows the database server's timezone

Worth knowing before someone files it as a bug. Postgres stores `created_at` as
a `TIMESTAMP` written by `CURRENT_TIMESTAMP`, and `to_char` renders it in the
server's timezone; SQLite stores epoch milliseconds and `strftime(...,
'unixepoch')` yields UTC. Every image this project ships runs UTC, so the two
agree — and a store several hours behind UTC will see an evening sale counted
against the following day.

Fixing that is a store-timezone setting (`settings.timezone` exists and nothing
reads it), not a dialect fix, and it must change in **both** adapters at once or
the two databases will disagree about which day a sale belongs to. Left as a
deliberate stopping point.

### P6-T2 / P6-T3: one set of figures, several renderings

`Reports.tsx`, `AdminReports.tsx` and `Dashboard.tsx` now read the endpoints.
The register's report screen had its own definition of "revenue" —
`sum(order.total)`, which includes tax and ignores refunds — so it and the admin
screen printed different figures for the same day. Both now render the same
`SalesReport` component from the same payload.

`AdminExports` gained a **Sales Summary** export in PDF, Excel and CSV, built
from the same reporting payload the screen renders rather than re-aggregated
from a list of orders. That is what makes "the export reconciles with the
report" true by construction instead of by two implementations happening to
agree, and it is asserted in `export-sales-summary.test.ts`.

**The other export reports still aggregate client-side.** Month-over-month,
week-over-week, sales-by-customer and the returns reports each need aggregations
this phase did not specify, so building them would have been building out scope.
They still call `ordersApi.list()`. The unbounded-list problem is therefore
*reduced*, not solved: the four report screens no longer depend on it, but
`AdminExports` still does.

Services and quotes also still aggregate in the browser, on purpose — the
Services & Quotes module is deferred backlog (D2), and giving it SQL aggregates
would be shipping scope v1 decided not to.

`Dashboard`'s charts were drawing with `hsl(var(--primary))`, which resolves to
nothing under this token set (the tokens are hex custom properties, so `hsl()`
of one is invalid) — the charts had been falling back to the library's default
colours. Fixed to `var(--st-*)` while rewiring them.

`export-utils.ts` crossed the 800-line ceiling with the new report, so its shared
machinery moved to `export-core.ts` and the sales summary to
`export-sales-summary.ts`.

### P6-T4: branding was storable and unreadable

`brandColor` had been migrated, validated by the API's Zod schema and returned
on every settings read since the branding migration, **and nothing in the app
had ever looked at it**. Neither had `iconUrl`. There was also no UI to set
either one: `AdminSettings` edited the store name and nothing else about the
brand, and `AdminReceipts` only rendered a preview of receipt fields nothing
could write.

So a shop could pick a colour, save it, reload, and see the same gold as
everyone else — and could not pick one in the first place.

Now: a **Branding** tab (`components/settings/BrandingSettings.tsx`) sets the
colour, logo, favicon and receipt header/footer with a live preview, and
`components/StoreBranding.tsx` sits above the router and applies the colour and
favicon to every screen. Saving invalidates the settings query so the change
takes effect without a reload.

The foreground on the brand colour is chosen by **measured contrast**, not a
luminance threshold: this colour sits behind every primary button, and white on
the default gold is about 1.9:1. There is a test asserting every candidate
clears 4.5:1.

`AdminSettings` also defaulted `storeName` to `'Persona Store'` — brand drift
D5 says to purge. Now blank.

**`StoreBranding` only fetches when signed in**, and that is not a nicety. It
sits above the router, so it runs on `/login` and `/setup` too; settings is an
authenticated endpoint and a 401 clears the stored token and sends the browser
to `/login`. Fetching unconditionally would have bounced a brand-new install out
of its own first-run wizard, with no account yet existing to log in with. Caught
before merge; there is a test for it.

### P6-T5: the audit search searched one page

`GET /api/admin/audit` took `limit`, `offset` and `userId`, validated none of
them (`parseInt('abc')` reached the adapter as `LIMIT NaN`) and returned no
total. `AdminAudit` therefore fetched the newest hundred entries and filtered
them **in the browser** — a search box that looked like it searched the audit
log and searched one page of it, which is a bad way to find out who deleted
something last month.

The endpoint now filters by user, entity, action and date range in SQL,
validates with Zod, caps `limit` at 200, and returns `meta` with a real total
counted before the `LIMIT`. The screen drives all of it and pages properly.

The detail dialog printed `before` and `after` as two raw JSON blobs; for a
product with twenty fields that meant reading forty lines to find the one number
that moved, which is the only thing anyone opens an audit entry to see. It now
shows a field-level diff (`lib/audit-diff.ts`).

### P6-T6: the API-key reference documented the wrong header

Keys were already secure — hashed with bcrypt, plaintext returned exactly once,
prefix indexed so a key can be identified without being known, scoped,
revocable, expiring, and refused on the key-management routes even at `admin`
scope. All of that had tests.

What was wrong was the documentation, which is the part an integrator actually
follows. `GET /api/admin/api-keys/docs/reference` said authentication was
`Authorization: Bearer <api_key>`. The middleware reads `X-API-Key`; a Bearer
value is parsed as a JWT. Anyone following the reference got a `401` with
nothing suggesting the header was the problem. The **Admin - API Keys** screen
restated the same wrong instruction in hard-coded text.

Both fixed, the screen now renders the server's own answer rather than a copy of
it, and there is a test pinning the header so it cannot drift back. The
reference also claimed a per-key rate limit; the limiter keys on the client
address and has never seen which key was presented, so that claim would have had
integrators sizing retries against a budget that does not exist. Corrected, and
`docs/guides/api-keys.md` written.

### Verification

```
backend   typecheck OK   lint 0 errors (176 `any` warnings, the known backlog)
          721 passed | 31 skipped      build OK
          271 integration passed against a real Postgres
frontend  typecheck OK   lint 0 errors
          255 passed                   build OK
```

The reporting integration test seeds a known dataset, back-dates it into a
window nothing else uses, and asserts the report against hand-computed figures —
gross $40.00, discounts $2.00, tax $2.24, net $40.24 over three orders, with one
completed $5.44 refund and one pending $10 return treated differently.

### Still open after this phase

- **`AdminExports` still calls `ordersApi.list()`** for every report other than
  the sales summary, so the unbounded list adapters still have one consumer that
  needs all the rows. Removing it needs aggregations for month-over-month,
  by-customer and the returns reports, which this phase did not specify.
- **Day bucketing is UTC** in both adapters, as above.
- **`settings.timezone` is stored and unread.** It is the natural home for the
  fix, and wiring it touches both adapters plus every date the UI formats.
- **`AdminSettings.tsx` is 855 lines**, over the 800 the conventions set. It was
  already over before this phase; the Branding tab was extracted into its own
  component rather than added inline so as not to make it materially worse, but
  the file wants splitting.
