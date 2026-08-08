# Phase 7 — Hardening: Security, Testing, Performance, A11y

**Objective.** Make v1 production‑worthy. Close security gaps, reach the coverage bar on money paths,
add end‑to‑end tests for the critical flows, and check performance/accessibility. Nothing new
ships here — this phase makes what exists trustworthy.

**Entry criteria.** Phases 0–6 feature‑complete for v1 scope.

**Exit criteria.**
- Security review passes (no CRITICAL/HIGH open); secrets scanned; headers/rate‑limits verified.
- ≥80% coverage on checkout/pricing/returns/discounts modules; every route has integration tests.
- Playwright e2e covers the cashier sale + return flows and passes in CI.
- Basic load test on checkout is acceptable; obvious N+1s fixed; a11y + reduced‑motion checked.

---

### `P7-T1` — Security review & remediation
**Context.** Run the `security-review` skill / `security-reviewer` agent over the whole app.
**Files.** repo‑wide; focus on auth, orders/returns (money), upload, discounts, admin.
**Steps.**
1. Verify: no route bypasses `authenticate`/`authorize` (grep + test); JWT secret required ≥32 chars;
   bcrypt rounds ≥12 in prod; login rate‑limited + no user enumeration; SQL is parameterized (no
   string concatenation) in every adapter method; file upload validates type/size and stores outside
   webroot; CORS origin allow‑list is correct; Helmet headers present; error handler never leaks
   stack traces or secrets in prod.
2. Run a secret scan (`gitleaks`/`trufflehog`) over the repo + history; rotate anything found.
3. Fix all CRITICAL/HIGH findings; log MEDIUM/LOW as backlog.
**Acceptance criteria.** No open CRITICAL/HIGH; secret scan clean.
**Verification.** Security agent report attached to the PR with findings addressed; scan output clean.

### `P7-T2` — Backend test coverage to bar
**Files.** `backend/src/**/__tests__/**`, `vitest.config.ts` (coverage thresholds).
**Steps.**
1. Configure coverage thresholds: ≥80% lines on `services/pricing.ts`, order create, returns,
   discounts, auth. Add integration tests for every route (happy + validation + RBAC + edge).
2. Add tests for the DB adapters (transactions, rollback, org scoping) using the SQLite test DB.
**Acceptance criteria.** Coverage gate met; CI fails if it drops below threshold.
**Verification.** `cd backend && npm run test:coverage` meets thresholds.

### `P7-T3` — Frontend tests  `[parallel-ok]`
**Files.** `src/**/__tests__/**`.
**Steps.** Unit‑test pricing/format helpers, the API client, and critical hooks (mocked). Component
tests for Cart/checkout math display, discount application, and error states. Don't chase coverage on
generated shadcn UI.
**Acceptance criteria.** Meaningful frontend tests pass in CI.
**Verification.** `npm run test -- --run` green.

### `P7-T4` — E2E: cashier sale + return (Playwright)
**Context.** `@playwright/test` is already a dependency; `e2e/` referenced by lint script.
**Files.** `e2e/*.spec.ts`, `playwright.config.ts`, CI job.
**Steps.**
1. Spin up the stack (Compose or a test harness with seeded data). Write specs:
   - **Sale:** login → search product → add to cart → apply discount → pay cash (verify change) →
     complete → receipt shows correct totals → stock decremented.
   - **Card:** same via Stripe test terminal simulator (if runnable in CI; else mark `@manual`).
   - **Return:** look up the sale → return 1 item with restock → status/refund/stock correct.
2. Make waits deterministic (no arbitrary timeouts). Add the e2e job to CI (may be a separate,
   non‑blocking‑but‑reported job if Compose in CI is heavy).
**Acceptance criteria.** Sale + return specs pass reliably.
**Verification.** `npm run test:e2e` green locally and in CI.

### `P7-T5` — Performance pass  `[parallel-ok]`
**Files.** DB adapter queries, list endpoints, frontend bundle.
**Steps.** Add pagination + indexes where missing (orders list, products search, audit). Eliminate
N+1s (batch/join order items, variants). Check frontend bundle (code‑split heavy admin/report routes;
lazy‑load `recharts`/`jspdf`/`xlsx`). Verify a checkout completes in well under a second on a small
VPS with a realistic catalog.
**Acceptance criteria.** No unbounded queries; heavy libs lazy‑loaded; checkout is snappy.
**Verification.** A simple load test (e.g. `autocannon`) on `POST /api/orders` at modest concurrency
stays correct and responsive; bundle report shows report/export libs split out.

### `P7-T6` — Accessibility & responsive  `[parallel-ok]`
**Files.** POS + admin pages.
**Steps.** Keyboard operability of the register (add to cart, tender, complete), focus states,
color‑contrast for the brand color, `prefers-reduced-motion` respected, and usable layouts at
tablet/register widths (POS is often on a touchscreen). Fix egregious issues.
**Acceptance criteria.** Register is keyboard‑ and touch‑usable; automated a11y check has no serious
violations on POS/checkout.
**Verification.** Playwright + axe (or Lighthouse a11y) on POS/checkout shows no serious violations.

### `P7-T7` — Backups & data safety (prep for Phase 8)
**Files.** `scripts/backup.sh`, `scripts/restore.sh`, `docs/guides/backup-restore.md`.
**Steps.** Scripted `pg_dump` backup + restore (and MinIO bucket sync); documented schedule; a
tested restore procedure. Verify migrations are forward‑only and idempotent on restart.
**Acceptance criteria.** A backup can be taken and restored into a fresh volume with no data loss.
**Verification.** Backup a populated DB → restore into a fresh Compose volume → data intact.

---

## Note (2026-08-06): browser-level testing is the gap that matters most

Ad-hoc Playwright probes during Phases 1–3 found two bugs that the 112 backend
and 35 frontend tests could not, because both were browser-behaviour bugs:

1. **Writes failed in dev while reads worked.** Browsers omit `Origin` on
   same-origin GETs but attach it to same-origin POSTs; Vite's proxy forwarded
   it and the backend refused. Every API-level test passed throughout — `curl`
   sends no `Origin`, and `supertest` calls the app in-process.
2. **A CORS refusal surfaced as a 500**, which only showed up as a real failed
   request in a real browser.

A third case (2026-08-07): the cash-tender memos were placed above the
`calculateTotals` they call. Both are `const`, so the first render hit the
temporal dead zone and the whole register replaced itself with an error
boundary. Typecheck passed, the production build passed, and all 241 unit tests
passed — the crash exists only at runtime, on first paint. One browser load
found it immediately.

The flows worth covering, all exercised manually and passing as of this note:

- every route renders for an authenticated admin with no console errors and no
  4xx/5xx on any `/api` call (20 routes)
- add to cart → apply a quick discount → complete sale, and the recorded order
  carries the catalog's discount value, not the client's
- Inventory: create a product from the form and see it in the catalog
- Admin settings: save without the stored terminal credentials being visible in
  the page or wiped by the save

Standing these up as a real suite needs a decision about CI: `npx playwright
install` fetches nothing in this environment, so the browser has to come from
the runner image or a cached download. Until then the checks above are manual,
which means they will rot.

---

## Two vulnerabilities in the upload endpoint (found 2026-08-07)

Both required only `settings.write` — the permission needed to change a store
logo — and both were verified as exploitable before being fixed.

**Arbitrary file deletion.** `DELETE /api/upload/:type/:filename` built a path
with `path.join(dir, filename)`. Express decodes route parameters, so
`..%2F..%2F..%2Ftmp%2Ffile` arrived as a traversal sequence that `path.join`
resolved happily. Confirmed by deleting a probe file in `/tmp` from outside the
uploads directory. On a SQLite deployment the database file is in reach.

**Stored XSS.** The stored extension came from the uploaded filename while only
the client-supplied mimetype was checked. Uploading `payload.js` as
`Content-Type: image/png` passed the filter, was written as `<uuid>.js`, and was
served from `/uploads` as `application/javascript` — same origin as the app, and
`script-src 'self'` in the CSP executes it.

Fixed by deriving the extension from a server-side mimetype→extension table
rather than the filename, refusing SVG outright (it is a document format that
can carry script), constraining the upload kind to a known set instead of
falling back to the uploads root, and requiring a bare basename plus a
containment check on delete.

A third, smaller issue fell out: multer's rejections were bare `Error`s, so
"you sent the wrong kind of file" surfaced as a 500. They are `ValidationError`
now, with a handler for multer's own `MulterError` (size limit) alongside.

**The lesson worth generalising:** two of the three were the server trusting a
client-supplied *name* — a filename in a URL, a filename in a multipart part.
The money-path work established that the client is never believed about amounts;
the same holds for anything that reaches the filesystem.

## Remote code execution in the component updater (found 2026-08-07)

`POST /api/admin/components/update` built its command by interpolating the
client's package list into a string and running it through `exec`, which uses a
shell:

```ts
const command = `npm update ${packages.join(' ')}`;
await execAsync(command, { cwd: workDir });
```

A package named `; echo PWNED > /tmp/injected.txt; echo ` executed as the server
user. Confirmed by writing and reading back the file inside the container.

Admin-gated, but admin-to-RCE is a real escalation: it turns a stolen admin
session, or any XSS reaching an admin's browser, into control of the host
process — and the upload endpoint fixed in the same session provided exactly
such an XSS.

Fixed by switching every `exec` in that file to `execFile` with an argv array —
no shell, so no argument can be read as syntax — and validating names against
npm's package-name grammar first, which also stops a leading `-` being taken as
a flag.

A detail worth keeping: the rejection path originally interpolated the offending
entries into its error message, which itself threw on
`{ toString: 'nope' }` — a non-callable `toString` makes `String()` fail. The
code that exists to reject bad input returned a 500 for it. Only string entries
are echoed now. That was caught by a test written for the fix, not by review.

**Known limitation, unrelated:** the updater cannot succeed in the Docker image
regardless — `npm update` fails with EACCES against `/app/node_modules` as the
`nodejs` user. The feature is safe now, but it is not functional in a container
deployment, and the UI does not say so.

---

## Status (2026-08-07): adapter integration tests and a real e2e gate

**Adapter integration tests now exist**, in
`backend/src/adapters/db/__tests__/integration/`, running against a real
Postgres. The adapters were the least-covered code in the repository — roughly
7,900 lines at **0.17%** — because every route test mocks the adapter. A mock
proves the route calls it; it proves nothing about the query, and transactions,
COALESCE semantics, conditional updates, and join shapes are exactly what the
adapters are made of.

CI already provisioned a migrated `stewardpos_test` Postgres for the backend job
and had never used it for anything.

**The first integration test written found a real bug.** The catalog search fed
its term into a LIKE without escaping, so a search for `%` returned the entire
catalog and `_` matched any single character — a search for "50% off" returned
things that do not contain it. Parameterised, so not injection; simply wrong
results. The mocked route tests could not see it because the LIKE never ran.

What the suite covers: search/paging/wildcards, variant COALESCE and the
threshold clear-on-null, low-stock ordering and exclusions, order writes across
three tables, **stock decrements under concurrent sales**, category rename and
delete as transactions including rollback, **store credit double-spend**, and
drawer exclusivity. The concurrency cases are the ones a mock cannot express at
all: they exist to show that two connections racing cannot both win.

**A safety guard**: the harness refuses to run unless `DB_NAME` contains
"test". These tests write and delete rows, and the backend reads the same
environment variables, so a stale `.env` pointing at a development database is
the ordinary accident. It fails loudly rather than skipping — a suite that
skips silently reports green having tested nothing, which is how the adapters
went uncovered while CI looked healthy.

Scripts are split so both stay honest: `npm test` and `npm run test:coverage`
exclude integration and work with no database; `npm run test:integration`
requires one. CI runs both, and the integration step **blocks**.

**E2E is in the merge gate** (P7-T2). It was `workflow_dispatch`-only because
every spec failed in setup: `global-setup.ts` signs in as `admin@demo.local`,
and the stack came up with `AUTO_SEED` unset, so the account did not exist. The
entrypoint already migrates and seeds — it only needed asking. Before that it
ran on every PR with `continue-on-error: true`, which is worse than not running.

Three new specs cover the register completing a cash sale, asserting on **what
the server recorded** rather than only what the screen showed — a register that
displays the right change and stores the wrong total is the failure that
matters. `POS.tsx` is 1,669 lines at 0% unit coverage, and both browser-only
defects this project has hit (a CORS failure on a same-origin POST, a TDZ crash
that replaced the register with an error boundary) passed typecheck, build, and
every unit test.

### Running them locally

```
createdb stewardpos_test && DB_NAME=stewardpos_test npm run migrate
DB_NAME=stewardpos_test npm run test:integration
```

### Where coverage actually stands

| Area | Before | After |
|---|---|---|
| Backend overall | 32.6% | **56.2%** |
| `src/adapters/db` | 0.17% | **35.3%** |
| `src/services` (backend) | 59.2% | **81.3%** |
| `src/terminal` | 18.8% | **36.1%** |
| `src/api/routes` | 44.3% | **63.0%** |
| `src/utils` | 57.6% | **69.7%** |
| Frontend overall | 2.5% | **3.4%** — see the note below |
| Frontend `src/lib` | 20.4% | **31.8%** |

**Bugs this work found**, each verified against the running stack before being
fixed:

1. **An unescaped LIKE wildcard.** Searching `%` returned the entire catalog and
   `_` matched any single character, so "50% off" returned things that do not
   contain it. Parameterised, so not injection — simply wrong answers. Invisible
   to the route tests, which mock the adapter, so the LIKE never ran.
2. **A provider selected without credentials crashed the request.** The Stripe
   SDK throws from its own constructor, and `/api/terminal/charge` builds the
   adapter from settings on every call — so a shop that picked Stripe before
   saving a key got a **500 on every card charge**, reading as a broken server
   rather than a thirty-second fix. Now a 502 naming the provider, what is
   missing, and where to set it.
3. **Archiving a customer had never worked.** `archiveCustomer` selected
   `FROM orders WHERE customer_id` — `orders` has no such column, it records
   `customer_email` as a snapshot — so the query raised "column customer_id
   does not exist" and archiving **any** customer returned a 500. The same
   transaction also read `quote.tax` and `quote.valid_until`, whose real names
   are `tax_total` and `expires_at`, so the archive was blanking the two fields
   it exists to preserve. And it *deleted* the matched orders, which would have
   erased the sales ledger had it ever run.
4. **A role schema that had drifted from `PermissionResource`.** It enumerated
   seven resources and omitted `orders`, `returns`, and `discounts`; Zod strips
   unknown keys, so a role created granting those had them silently dropped. A
   cashier role created through the admin UI came out unable to take orders —
   the one thing a till exists to do — with nothing on screen to say why. The
   list now lives once and the schema is built from it.

Both were found by writing a test that asserted the real behaviour rather than
the assumed one, which is the argument for this work in one line.

**Still well short of the 80% the repo's standards set.** The adapters are the
bulk of what remains: ~25 domain areas, of which catalog, orders, categories,
store credit, drawer, returns/restock, users/roles, customers, and audit are now
covered, and services, quotes, loyalty, receipts, and terminal transactions are
not. That is mechanical
work following the pattern the existing files establish.

`src/terminal` remains partial by design — the provider *selection* and
credential handling are covered, but the live Stripe/Square/Clover request paths
need real hardware to exercise (P3-T5).

**Backend lint still does not run.** `npm run lint` fails: ESLint 8.57 finds the
root flat config, which is browser/React-oriented and built against
typescript-eslint v8 (requiring ESLint 9), so the backend both crashes and
refuses `--ext`. The fix is a `backend/eslint.config.js` with node globals. It
is blocked by the repository's `config-protection` hook, which refuses to create
or modify any ESLint config; it needs a human to disable that hook briefly.
Backend code has never been linted.

### A note on the frontend percentage

3.4% understates what is covered, and the reason is worth stating rather than
hiding. The denominator is dominated by ~50 vendored shadcn primitives in
`src/components/ui` and 20 page components, all at 0%. The primitives are
third-party code with no logic of ours in them; the pages are covered by e2e
instead, which is the better tool for them — both browser-only defects this
project has hit passed every unit test.

What has been unit-tested is the logic that is worth unit-testing:
`src/lib/permissions` and `api-client` at 100%, the API SDK at 83%, and now the
session/permission helpers and the report generators — the numbers a shop takes
to its accountant, where a double-counted aggregation or a CSV that breaks on a
comma is a real problem.

The remaining honest gap is `src/hooks` and the page components' own logic.
