# StewardPOS — v1 Release Readiness Assessment

> **Verified 2026‑08‑04** against commit `6727363` on `main`. Every claim below was reproduced by
> running the command or reading the cited file. This supersedes the "current state" section of
> [`README.md`](./README.md) where the two disagree.

## Verdict

**NOT release ready.** Do not deploy this to a live register or expose it to the internet.

Three unauthenticated remote defects allow an attacker to take over the instance, read all sales
history, and buy merchandise for any price they choose. Separately, the backend does not compile,
neither test suite passes, and the product cannot charge sales tax.

Estimated distance to a defensible v1: **Phases 0–3 of the master plan, plus the P0 list below.**

---

## 0. Fixes applied in this pass (2026‑08‑04)

| Ref | Change | Verification |
|---|---|---|
| S2 | `router.use(authenticate)` added to `orders.ts:11` | backend typecheck: 0 errors in `orders.ts`, total unchanged at 341 |
| S1 | `rejectIfAlreadySetUp` guard added; applied to `POST /api/setup/{complete,test-database}`. Admin upsert changed from `DO UPDATE SET password_hash` to `DO NOTHING` + `409` on both Postgres and SQLite paths | new `src/api/routes/__tests__/setup.guard.test.ts` — **4/4 pass** |
| S4 | `.env` untracked (`git rm --cached`); all four secrets regenerated into the local file | `git ls-files .env` → 0; `git check-ignore` → `.gitignore:34` |
| D5 | `backend/package.json` name/description/author → StewardPOS | — |

Backend suite went from 8 passing to **12 passing**. The two pre‑existing failures are untouched
and belong to Phase 0 (see §4).

**Still outstanding from P0: S3 (server-side repricing).** It is not a small fix and is scheduled
with the rest of the money path in Phase 3.

> ⚠️ **Rotation caveat:** if a Postgres volume or MinIO bucket was already created with the old
> credentials, the new values will be rejected until you either update the role password
> (`ALTER USER stewardpos_user WITH PASSWORD '…'`) or recreate the volume. The old secrets remain in
> git history — treat them as permanently burned regardless.

---

## 1. Baseline — what actually runs today

| Gate | Command | Result |
|------|---------|--------|
| Frontend typecheck | `npx tsc --noEmit` | ✅ clean |
| Frontend build | `npx vite build` | ✅ builds (⚠️ 1.97 MB single chunk, 577 kB gzip) |
| Frontend unit tests | `npx vitest run` | ❌ **cannot run — `vitest` is not installed** |
| Backend typecheck | `npx tsc --noEmit` | ❌ **341 errors across 8 files** |
| Backend tests | `npx vitest run` | ❌ **2 of 3 files fail, 1 of 9 tests fails** |
| E2E | `playwright test` | ⚠️ not run (requires live stack) |

`package.json` declares `"test": "vitest"` but `vitest` appears in **no** dependency block and
`node_modules/vitest` does not exist. The frontend test script has never been runnable as committed.

Backend type errors are concentrated in `adapters/db/PostgresAdapter.ts`,
`adapters/db/SQLiteAdapter.ts`, and routes `apikeys / auth / components / customers / receipts /
setup` — almost all of them `TS18046: 'x' is of type 'unknown'`, the fallout of typing DB rows as
`Record<string, unknown>` and never narrowing. The backend ships only because `tsx` strips types at
runtime; `npm run build` (`tsc`) would fail.

---

## 2. P0 — release blockers (security)

### S1. Unauthenticated full instance takeover via the setup wizard — CRITICAL
`backend/src/api/routes/setup.ts:188` — `POST /api/setup/complete` is mounted before all auth
(`server.ts:80`), carries **no `authenticate`**, and **no "is setup already complete?" guard**. It
runs migrations and then, at `setup.ts:295`:

```sql
INSERT INTO users (email, password_hash, name, status) VALUES ($1,$2,$3,$4)
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, ...
```

Anyone who can reach the API can POST the existing admin's email with a password of their choosing
and **overwrite that admin's password hash**, then log in as admin. No credentials required. This is
worse than the master plan's C-list records — it is a remote admin-account takeover on a fully
provisioned, live system.

**Fix:** guard `/complete` and `/test-database` behind a setup-not-yet-complete check (reuse the
`hasAdminUser` logic already at `setup.ts:39`), return `409` once an admin exists, and drop the
`DO UPDATE SET password_hash` clause in favour of `DO NOTHING`.

### S2. Every order endpoint is unauthenticated — CRITICAL
`backend/src/api/routes/orders.ts:3` imports `authenticate`; line 10 is a **comment** claiming the
routes require it. `router.use(authenticate)` is never called and no handler passes it. Therefore,
with no token at all:

- `GET /api/orders` → dumps every order, with customer email and phone (PII breach)
- `GET /api/orders/:id` → any order
- `POST /api/orders` → create arbitrary sales

Sibling route files (`customers`, `returns`, `receipts`, `discounts`, `quotes`, `terminal`,
`components`, `admin`, `apikeys`) *do* call `router.use(authenticate)`. `orders.ts` is the one that
was missed — the highest-value route in the app.

**Fix:** add `router.use(authenticate);` after line 8.

### S3. Server trusts client-supplied money — CRITICAL
`orders.ts:36-51` validates that `unitPrice`, `lineTotal`, `subtotal`, `taxTotal` and `total` are
non-negative numbers, then `orders.ts:138` passes them straight to `adapter.createOrder`. The server
never looks up the product price and never recomputes a total.

Combined with S2, an unauthenticated attacker can POST an order for any product at
`unitPrice: 0.01`, and the database records a completed, paid sale at that price. Stock decrements.
The receipt prints. Reports reconcile to the fraudulent number.

**Fix:** Phase 3 server-side repricing — load each `productId`/`variantId`, compute line totals and
tax in integer cents server-side, and ignore every client-supplied money field (D7).

### S4. Live secrets committed to git — CRITICAL
`.env` is listed in `.gitignore:34` **but is tracked by git** (`git ls-files` returns it), so the
ignore rule has no effect. `git show HEAD:.env` returns a real `JWT_SECRET`, `POSTGRES_PASSWORD`,
`DB_PASSWORD` and `MINIO_ROOT_PASSWORD`.

The JWT secret is the signing key for every session token — anyone with repo access can forge an
admin JWT indefinitely.

**Fix:** `git rm --cached .env`, then **rotate all four secrets**. Removing the file from the index
does not remove it from history; treat every value in it as burned.

---

## 3. P1 — correctness blockers

### C1. Sales tax is hardcoded to zero
`src/pages/POS.tsx:531`, `:645`, `:711` — all three checkout paths contain
`const taxRate = 0; // Default to 0 for now`. There is no tax configuration anywhere in the schema
or settings. **A POS that cannot charge sales tax cannot be used by a US retailer.** Even for a
church bookstore this is a jurisdiction-by-jurisdiction legal question, not a default.

### C2. Orders have no cashier, no order number, no status
`backend/migrations/postgres/001_initial_schema.sql:43` — the `orders` table is
`id, created_at, subtotal, discount_total, tax_total, total, payment_method, customer_email,
customer_phone`. There is **no `user_id`** (you cannot tell who rang a sale — fatal for shrink
investigation and for any audit story), **no human-readable order/receipt number** (customers get a
raw UUID), **no `status`/`voided` column**, and no `org_id` (D4's multi-tenant-ready requirement).

### C3. Non-variant products cannot be sold, and overselling is silent
`001_initial_schema.sql:60` declares `order_items.variant_id UUID NOT NULL`, so any product without
a variant fails insert. Meanwhile `PostgresAdapter.ts:412` only decrements stock
`if (item.variantId)`, and does so with `SET stock = GREATEST(0, stock - $1)` — which **silently
clamps at zero instead of rejecting the sale**. There is no stock availability check before commit.
Order creation *is* correctly wrapped in `BEGIN`/`COMMIT`/`ROLLBACK` (`PostgresAdapter.ts:361-441`),
so the master plan's "not transactional" claim (C2) is **out of date** — but the oversell hole is real.

### C4. No tender model: no split tender, no cash/change, no drawer session
`payment_method` is a single `VARCHAR(50)` on the order. There is no `payments` table, so **split
tender is impossible**. `grep` finds no `cashTendered`, `changeDue`, or cash-drawer session logic
anywhere — a cashier cannot record cash received or compute change, and there is no X/Z report or
till reconciliation. These are table stakes for a physical register.

### C5. API envelope mismatch is real but partially absorbed
`src/lib/api-client.ts:37` returns raw `response.json()`, so callers receive the backend's
`{success, data}` envelope rather than the payload. Pages compensate ad hoc
(`POS.tsx:182 setProducts(response.data)`), which works but leaves the generic `<T>` lying about
what it returns. Every call site must be re-checked when this is fixed.

### C6. Split-brain data layer persists
Eight modules still import the IndexedDB/DI/adapter stack — `src/pages/{POS,Inventory,ServicesPos}.tsx`
and `src/components/{Cart,ProductCard,Receipt,VariantPicker,ImportInventoryDialog}.tsx` — while 24
modules use `api-client`. `POS.tsx` uses **both**: it loads products via the local layer and posts
orders via REST. Per D1 the local layer must go.

Related and worse: `src/adapters/db/PostgresAdapter.ts` is a **Postgres client in browser code**, and
`src/adapters/auth/LocalAuthAdapter.ts` + `src/lib/db-operations.ts` do **bcrypt password hashing in
the browser**. `bcryptjs` is a frontend dependency (`package.json:53`). Client-side password
verification is not authentication. All of this must be deleted, not migrated.

---

## 4. P2 — quality and hygiene

- **Brand drift (D5) unfinished.** `backend/package.json` is still `"name": "persona-pos-backend"`,
  `"description": "Backend API for Persona POS"`, `"author": "Persona POS Team"`. `persona` also
  survives in `src/lib/{config,db,di}.ts`, `src/adapters/storage/LocalStorageAdapter.ts`,
  `src/pages/admin/AdminSettings.tsx`, `backend/src/config/index.ts`,
  `backend/src/services/{database,migrator,seeder}.ts`, and both `001_initial_schema.sql` files.
- **Broken terminal factory.** `TerminalAdapterFactory.ts:32` uses `require('./StripeTerminalAdapter')`
  inside an ESM/vitest context; the file exists but the call throws `Cannot find module`. Stripe
  Terminal — one of only two v1 tenders (D3) — is therefore **unproven end to end**.
- **`supertest` is missing.** `routes/__tests__/auth.test.ts` imports it but it is in no dependency
  block, so that file has never run. It also imports `server.ts`, which calls `startServer()` at
  module load — the suite would need a live database even once `supertest` is installed. Split the
  Express app out of `server.ts` so it can be imported without booting.
- **SQLite local-dev path is broken on Node 22.** `better-sqlite3` has no compiled binding
  (`Could not locate the bindings file … node-v127-win32-x64`), so `DB_ADAPTER=sqlite` fails at
  startup. The plan's "zero-dependency local dev and unit tests" story does not currently work;
  either pin/rebuild the native module or drop SQLite from the supported matrix.
- **RBAC barely applied.** `authorize()` is used in only 4 of 17 route files (`apikeys`, `customers`,
  `discounts`, `services`). Most authenticated routes let **any** logged-in user do **anything** —
  a cashier can delete products and read all reports.
- **Login is not rate-limited separately.** `server.ts:57-64` applies one global limiter to `/api/`;
  there is no stricter bucket on `/api/auth/login`, so password spraying is bounded only by the
  general limit.
- **Doc sprawl.** 12 root-level markdown files plus 18 in `archive/` — including three separate
  stale code-review/cleanup reports (`CODE-REVIEW-SUMMARY.md`, `CLEANUP-SUMMARY.md`,
  `archive/CODE-REVIEW-REPORT.md`) that contradict this assessment. `ROADMAP.md` is 49 KB of
  aspirational claims. Phase 0 calls for de-duplicating these; it has not happened.
- **Bundle size.** Single 1.97 MB chunk. Fine on a wired register, poor on a tablet over hotel wifi.

---

## 5. POS feature coverage for v1

Scope per **D2**: core POS + returns/refunds + discounts/promotions.

| Capability | State | Note |
|---|---|---|
| Product search / browse | ✅ | via local layer in `POS.tsx`, needs C6 migration |
| Barcode scanning | ⚠️ | `barcode` exists in schema/import/receipt; **no scanner input handler at the register** |
| Cart + qty + line discount | ✅ | |
| Discounts / promo codes | ✅ | validated server-side, usage tracked |
| **Sales tax** | ❌ | **hardcoded 0** (C1) |
| **Server-authoritative pricing** | ❌ | **client sets prices** (S3) |
| Cash tender + change due | ❌ | not implemented (C4) |
| **Split tender** | ❌ | no `payments` table (C4) |
| Card / Stripe Terminal | ⚠️ | adapters + `/api/terminal/charge` exist; factory broken, never proven (§4) |
| Transactional order write | ✅ | `BEGIN`/`COMMIT`/`ROLLBACK` present |
| Stock decrement | ⚠️ | variants only; silently oversells (C3) |
| Receipt print / email | ✅ | `ReceiptDialog.tsx`, `routes/receipts.ts` |
| Human-readable order number | ❌ | UUID only (C2) |
| Cashier attribution on sale | ❌ | no `user_id` (C2) |
| Void / no-sale | ❌ | no order status column |
| Returns / refunds + restock | ✅ | `routes/returns.ts` — full CRUD, `process-refund`, `restock` |
| Cash drawer session / X-Z report | ❌ | absent (C4) |
| Inventory CRUD + CSV import | ✅ | |
| Reports + PDF/Excel/CSV export | ✅ | `jspdf`, `xlsx`, `AdminExports.tsx` |
| Branding / receipt customization | ✅ | migration 005 |
| Audit log | ⚠️ | `AdminAudit.tsx` exists; enforcement/coverage unverified |
| Auth + RBAC | ⚠️ | authN mostly wired (orders missing); **authZ only 4/17 routes** |
| Offline mode | — | out of scope per D2 |

**Net:** admin/back-office is in reasonable shape. The **register itself** — the part that takes
money — is missing tax, cash handling, split tender, and server-side pricing. Those four are what
separate a demo from a POS.

---

## 6. Recommended order of work

1. **Stop the bleeding (hours):** S2 (`router.use(authenticate)`), S1 (setup guard), S4 (untrack
   `.env` + rotate secrets). These are small, surgical, and each closes a remote hole.
2. **Make the gates real (1 day):** add `vitest` to the frontend, fix the 341 backend type errors,
   fix `TerminalAdapterFactory` — so CI can tell you the truth from here on. This is master plan
   **Phase 0**.
3. **Phase 1** — collapse the split-brain data layer (C6), standardize the envelope (C5), delete
   browser-side Postgres and bcrypt.
4. **Phase 2** — apply `authorize()` across all routes, add `user_id`/`org_id`, tighten login rate
   limiting.
5. **Phase 3** — the money phase: server repricing (S3), tax engine (C1), `payments` table with
   split tender and cash/change (C4), stock reservation (C3), order numbers and status (C2), then
   prove Stripe Terminal end to end.
6. Re-run this assessment before declaring v1.

Nothing in Phases 4–9 should start before Phase 3 closes; every one of them builds on the money path.
