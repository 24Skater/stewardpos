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
