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
