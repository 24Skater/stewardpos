# Phase 9 — Go‑Live, Release & Backlog

**Objective.** Final acceptance, versioned release, and an honest public launch — plus a curated
backlog so deferred scope is remembered, not lost.

**Entry criteria.** Phases 0–8 complete; CI green; docs complete; a test VPS install verified.

---

## Go‑Live acceptance checklist (all must pass)

**Functional**
- [ ] Fresh VPS → HTTPS install in <30 min using `docs/guides/install-vps.md` only.
- [ ] Setup wizard creates org + admin + roles + settings, then locks.
- [ ] Cashier: login → scan/search → cart → discount → **cash** sale with correct change →
      transactional completion → **stock decremented** → branded receipt (print + email).
- [ ] Cashier: **Stripe Terminal** card sale (test mode) end‑to‑end; declines create no order.
- [ ] Split tender (cash + card) on one order works.
- [ ] Cash‑drawer open/close with correct expected‑vs‑counted variance.
- [ ] Manager: **return/refund** against a receipt with restock; order status + refund correct.
- [ ] Discounts/promo codes validate + apply **server‑side**; limits/approval enforced.
- [ ] Inventory CRUD, images (MinIO), CSV import/export, low‑stock all work.
- [ ] Reports reconcile with data; PDF/Excel/CSV exports match.
- [ ] Branding (logo/color/receipt text) persists and takes effect.
- [ ] Audit log records mutations and is filterable.

**Non‑functional**
- [ ] Every protected route enforces authN + RBAC (proven by tests).
- [ ] Server reprices all money; no client‑supplied price is ever trusted (proven by tests).
- [ ] Orders/returns are transactional; no oversell; rollbacks leave no orphans (proven by tests).
- [ ] ≥80% coverage on pricing/checkout/returns/discounts; e2e sale + return pass in CI.
- [ ] Security review: no open CRITICAL/HIGH; secret scan clean; strong secrets required at boot.
- [ ] Backup → restore verified; upgrade path verified across a version bump.
- [ ] No "Persona POS" references; no dead IndexedDB layer; root README honest.

**Docs**
- [ ] Install, configure, operate, backup/restore, upgrade, troubleshoot, env reference,
      payments, and multi‑tenant guides all present and accurate.

---

### `P9-T1` — Release engineering
**Files.** `CHANGELOG.md`, git tags, `package.json` versions, `docker-compose.prod.yml` image tags.
**Steps.** Adopt SemVer; write the `1.0.0` changelog from the real feature set (not the old
aspirational roadmap); tag `v1.0.0`; optionally publish images to a registry (GHCR) via a release
CI workflow so operators can `pull` instead of `build`.
**Acceptance criteria.** A tagged, changelog‑backed `v1.0.0`; prod compose can run from pinned images.
**Verification.** `docker compose -f docker-compose.prod.yml up -d` using pinned `:1.0.0` images works.

### `P9-T2` — License, security policy, contribution  `[parallel-ok]`
**Files.** `LICENSE` (MIT), `SECURITY.md` (real disclosure contact), `CONTRIBUTING.md`,
issue/PR templates in `.github/`.
**Steps.** Ensure the security contact is real (not `security@stewardpos.dev` if that mailbox
doesn't exist); align license references; keep contribution + conventional‑commit guidance.
**Acceptance criteria.** Public‑repo hygiene files are accurate and actionable.
**Verification.** Links/contacts resolve; templates render on GitHub.

### `P9-T3` — Launch readiness (optional, human‑led)  `[parallel-ok]`
**Files.** `docs/` + README polish; demo instance via `docker-compose.demo.yml`.
**Steps.** Verify the demo profile (seeded catalog + demo creds) is clearly separated from a real
install. If a public announcement is planned, prepare it honestly (v1 scope, self‑host focus). This is
a human decision point — do not publish without owner sign‑off.
**Acceptance criteria.** A safe demo exists; launch materials reflect real scope.
**Verification.** Demo boots with seed data; real installs never ship demo credentials.

---

## Backlog (deferred from v1 — do NOT build without a new plan)

Tracked here so scope decisions (**D2/D3/D6**) are remembered:

- **Services & Quotes** module (catalog, quote → order). Schema + routes partly exist.
- **Full Customer CRM / loyalty** (tags, LTV, points). v1 only captures order email/phone.
- **Additional payment terminals**: Square, Clover, Verifone, Dejavoo — certification + hardware
  test matrix each (adapters compiled but flagged off, see `phase-3` P3‑T6).
- **SSO**: Google OAuth, OIDC (adapters existed on the old client; re‑introduce server‑side).
- **SMS** notifications (Twilio adapter exists).
- **Offline‑first / PWA** with sync + conflict resolution (explicitly out of v1 per D1).
- **Multi‑tenant SaaS** (org provisioning, billing, subdomains — foundation laid in P2‑T6).
- **Hardware integrations** (cash drawer kick, receipt printers beyond browser print, barcode
  scanner profiles), **QuickBooks/accounting export**, **plugin marketplace**, **mobile app**.

Each backlog item should get its own brainstorming + plan before implementation.
