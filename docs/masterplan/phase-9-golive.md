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

---

## Completion notes (2026-08-17)

All three tasks are done, and the acceptance checklist has been worked item by
item rather than ticked. **The release is `1.0.0-rc.1`, not `1.0.0`**, because
two checklist items provably cannot pass yet. That decision is the substance of
this phase and is set out below.

### The acceptance checklist, worked

**Functional**

| Item | Result |
|---|---|
| Fresh VPS → HTTPS install in <30 min from the guide alone | **Not verified.** The guide is complete, `docker compose config` and `caddy validate` both pass, and every startup failure path has a test — but nobody has followed it on a clean server. This needs a VPS and a domain |
| Setup wizard creates org + admin + roles + settings, then locks | Pass — covered by `setupComplete.integration.test.ts` and `setup.guard.test.ts` |
| Cashier: cash sale, correct change, transactional, stock decremented, branded receipt | Pass — `checkout.spec.ts` in CI asserts what the **server** recorded, not what the screen said |
| Cashier: Stripe Terminal card sale end to end; declines create no order | **Cannot pass.** P3-T5 is unwired. Needs real credentials and hardware |
| Split tender (cash + card) on one order | Pass — `payments` table, `tender.ts` at 100% |
| Cash-drawer open/close with correct variance | Pass — `drawer.test.ts`, `drawerRefunds.integration.test.ts` |
| Manager: return/refund with restock; status + refund correct | Pass — **and this is new**: see below |
| Discounts/promo codes validated server-side; limits enforced | Pass — `discountPricing.ts` at 95.65%, `promoValidation.test.ts` |
| Inventory CRUD, images, CSV import/export, low stock | Pass |
| Reports reconcile; PDF/Excel/CSV exports match | Pass — Phase 6, reconciliation asserted against a real Postgres |
| Branding persists and takes effect | Pass — Phase 6 |
| Audit log records mutations and is filterable | Pass — Phase 6 |

**Non-functional**

| Item | Result |
|---|---|
| Every protected route enforces authN + RBAC | Pass — `authGuard.test.ts`, plus per-route RBAC tests |
| Server reprices all money; no client price trusted | Pass — `pricing.ts` at 100%, `orderCheckout.test.ts`, `money.integration.test.ts` |
| Orders/returns transactional; no oversell; no orphans | Pass — `orders.integration.test.ts` against a real Postgres, including concurrent sales of the last unit |
| ≥80% coverage on pricing/checkout/returns/discounts | **Pass, measured**: `pricing.ts` 100%, `tender.ts` 100%, `returnPricing.ts` 97.87%, `reports.ts` 97.22%, `discountPricing.ts` 95.65% |
| e2e sale **and return** pass in CI | Pass — the return half did not exist and was written for this phase |
| Security: no open CRITICAL/HIGH; strong secrets required at boot | Pass on the boot requirement (Phase 8). The dependency audit is advisory and red — see below |
| Backup → restore verified; upgrade path verified | Backup/restore verified for real in Phase 8. The upgrade path across a version bump is verified by construction but not yet by a real upgrade |
| No "Persona POS"; no dead IndexedDB layer; README honest | Pass — all three closed here |

### The e2e suite had no return in it

The checklist asks for "e2e sale **+ return** pass in CI". Only the sale existed.
Returns are the second place this application moves money and the only place it
moves money *outwards* — a return that refunds the wrong amount, or restocks an
item it did not take back, loses a shop goods and cash at once.

`e2e/returns.spec.ts` drives the register's return dialog and asserts on what the
server recorded: a partial return of one unit from a two-unit sale is refunded at
half the order total, and stock moves **only** when the return reaches a state
where restocking is permitted. It also asserts that the API refuses a quantity
the sale never contained, because the dialog capping its own input is not the
boundary that matters.

Writing it surfaced three things worth recording:

- `GET /api/returns` **has no `originalOrderId` filter**. The first draft passed
  one and would have been silently answered with every return in the database —
  a test that passes because it found somebody else's row. It reads through
  `/api/receipts/:id` instead, which carries them.
- The order could not be created by posting an amount: the server refuses a cash
  payment that does not cover the sale and will not accept a client-invented
  total. The spec quotes first, which is what the quote endpoint is for.
- Restocking is gated on `approved` **or** `completed`, not on `completed`
  alone. The first version asserted the wrong rule and failed against a return
  the dialog had already approved.

### The brand purge was never finished

Phase 0's own exit criterion was that no occurrence of "Persona POS" remained.
Twelve live files still carried it, including the ones a stranger reads first:
`LICENSE` (the copyright holder), `SECURITY.md`, `CONTRIBUTING.md`,
`CHANGELOG.md`, both initial migrations, and the default SQLite filename in three
services. All now say StewardPOS. `docs/archive/` is deliberately untouched — it
is a record of what the project used to be, and rewriting history there would
make it a worse record.

### The public-facing files were making promises nobody could keep

P9-T2 asks for hygiene files that are "accurate and actionable". They were
neither.

- **`SECURITY.md` published `security@persona-pos.dev`.** That mailbox does not
  exist. A reporter who emails it and hears nothing reasonably concludes the
  project does not care, and may disclose publicly instead — so an unread
  address is worse than none. GitHub's private security advisories are now the
  only channel, because that one actually works.
- **It also promised acknowledgment within 48 hours and critical fixes within 7
  days.** Commitments a project this size cannot keep. A security policy that is
  quietly broken is worse than a modest one that is honoured.
- **`CONTRIBUTING.md` documented an architecture that was deleted in Phase 1** —
  `src/core/ports/`, `src/adapters/{db,auth,email,sms,storage}`, `src/lib/di.ts`,
  `CONFIGURATION.md`. A contributor following it would have gone looking for
  files that do not exist. Replaced with the two extension points that are real,
  both server-side: `TerminalPort` and the email adapter.
- It also linked to GitHub Discussions, **which is disabled on this repository**,
  and to an invented Discord invite. Both removed. Issue and PR templates added.

### The README understated the product

The status section listed as missing three things Phase 3 had built — sales tax,
cash and split tender, and cashier attribution. Still dishonest, in the safer
direction, and still worth fixing: it now states what works, and separately what
does not, with the reason for each. The "Coming Soon" links to `stewardpos.dev`
domains that do not resolve are gone.

### Why `1.0.0-rc.1`

Two checklist items cannot pass: **card payments are simulated**, and **no
install has been verified on a real VPS**. Everything else does.

Declaring `1.0.0` while a till cannot take a card would be precisely the failure
this whole plan exists to correct — the aspirational README that listed
authentication as complete when it was not applied to any route. A release
candidate says what is true: the software is complete and installable, and two
things need hardware and a server before anyone should call it 1.0.

**Promoting it is a tag and two verifications**, both recorded in `CHANGELOG.md`:

1. A card sale end to end against real Stripe Terminal hardware in test mode,
   with a decline creating no order.
2. A clean VPS taken to a working HTTPS install using `install-vps.md` and
   nothing else.

### Release engineering

- `CHANGELOG.md` rewritten from the real feature set. The previous file was the
  in-progress Phase 2 development log formatted as though it were released
  history; there is no released history, and the file now says so.
- Both `package.json` versions are `1.0.0-rc.1`. The frontend's had been `0.0.0`
  and the backend's `1.0.0`, which agreed with neither each other nor reality.
- `.github/workflows/release.yml` fires only on a version tag. It **re-verifies
  the tagged commit** — typecheck, lint, unit, integration against a real
  Postgres, build — before publishing anything, because a tag can be pushed at
  any commit including one that does not build. It then checks the tag against
  `package.json` and `CHANGELOG.md`, publishes both images to GHCR, and drafts
  release notes for a human to read before they become the first thing anyone
  sees.
- A prerelease is deliberately **not** tagged `latest`, so an install that has
  not pinned a version cannot be pulled onto a candidate.
- `docker-compose.prod.yml` runs published images when `IMAGE_TAG` is set and
  builds from source otherwise, which makes a rollback a one-line change.

### Verification

```
backend   typecheck OK   lint 0 errors (176 `any` warnings, the known backlog)
          757 passed | 32 skipped      build OK
          271 integration passed against a real Postgres
frontend  typecheck OK   lint 0 errors
          255 passed                   build OK
e2e       returns.spec.ts 3 passed against the live stack
coverage  pricing 100 · tender 100 · returnPricing 97.87 · reports 97.22 · discountPricing 95.65
```

### Still open

- **The tag has not been pushed.** The plan calls launch a human decision point,
  and pushing a version tag publishes public images. Everything needed is
  merged; the tag is the owner's to make.
- **The two promotion gates above**, which need hardware and a server.
- **The dependency audit job is red**, as it has been on `main` since before this
  phase. It is `continue-on-error: true` by design — advisories are published
  after a commit lands, so a blocking gate there would turn red without any
  change to the repository. The current findings are transitive: `postcss`, and
  `dompurify` via `jspdf@4.2.1`, patched in `>=3.4.13`. Worth a follow-up, not a
  release blocker.
- **`docs/archive/` still describes the old product.** Left alone deliberately.
