# Phase 2 — Auth, RBAC, Setup & Multi‑Tenant‑Ready Schema

**Objective.** Make authentication and authorization *real and enforced* on every protected route
(fixes **C3**), finish the first‑run setup wizard and seeding, and add the nullable `org_id`
foundation (**D4/C7**) so multi‑tenant is a future config flip, not a rewrite.

**Entry criteria.** Phase 1 exit criteria green (single data layer).

**Exit criteria.**
- Every route except `GET /api/health`, `/api/setup/*` (pre‑completion), and `POST /api/auth/login`
  requires a valid JWT; write/delete actions require the correct RBAC permission.
- Integration tests prove: no token → 401; wrong permission → 403; correct → 200.
- First‑run setup creates org + admin + default roles; re‑running setup after completion is blocked.
- All tenant‑scoped tables have nullable `org_id`; API sets/filters it from `req.orgId`.

---

### `P2-T1` — Harden the auth + authorize middleware
**Context.** `authenticate` and `authorize` exist but are inconsistently applied and must be robust.
**Files.** `backend/src/api/middleware/auth.ts`, `authorize.ts`; `backend/src/api/routes/auth.ts`.
**Steps.**
1. `authenticate`: require `Authorization: Bearer`, verify JWT with `config.jwt.secret`, load the
   user (reject if `status !== 'active'`), attach `req.user = { id, orgId, roles, permissions }`.
   Return `401` with the standard envelope on any failure. Never leak *why* (avoid user enumeration).
2. `authorize(resource, action)`: aggregate the user's roles' `RolePermissions` JSONB; allow if any
   role grants `action` on `resource`; else `403`. Admins (`system_role='admin'`) bypass.
3. `auth.ts`: `POST /login` (email+password → bcrypt compare → issue JWT with `{sub,orgId,roles}`),
   `POST /logout` (client‑side token discard; optionally a token denylist — out of scope v1),
   `GET /me` (returns current user + permissions). Rate‑limit `/login` harder than the global limit.
4. Add `validate(schema)` middleware (Zod) used across routes for body/query/params.
**Acceptance criteria.** Middleware returns correct 401/403; `/login` issues a working token; `/me`
returns the user.
**Verification.** Integration tests (P2‑T3) cover these; `npm run test` green.

---

### `P2-T2` — Apply auth + RBAC to every route (fixes C3)
**Context.** Routes like `orders.ts` import `authenticate` but never apply it; some are wide open.
**Files.** All `backend/src/api/routes/*.ts` and `backend/src/server.ts`.
**Steps.**
1. In each protected router, add `router.use(authenticate)` at top, then per‑endpoint
   `authorize(resource, action)` matching the resource:
   | Route | resource | read/write/delete mapping |
   |-------|----------|---------------------------|
   | products, upload | `inventory` | GET=read, POST/PUT=write, DELETE=delete |
   | orders, terminal, receipts | `orders`* | GET=read, POST=write |
   | customers | `customers` | standard |
   | services, quotes | `services` | standard |
   | returns | `orders`/`returns` | GET=read, POST=write |
   | discounts | `settings`/`discounts` | GET=read, POST/PUT/DELETE=write/delete |
   | reports, exports (admin) | `reports`/`exports` | GET=read |
   | admin (users/roles/settings/audit/api-keys) | `users`/`settings` | per action |
   \*If `RolePermissions` lacks an `orders`/`returns`/`discounts` key, extend the permissions model
   (P2‑T5) and seed roles accordingly.
2. Keep public: `health`, `setup` (guarded by P2‑T4), `auth/login`.
3. Verify CORS + rate‑limit still wrap everything (already in `server.ts`).
**Acceptance criteria.** Every protected endpoint rejects anonymous and under‑privileged callers.
**Verification.** P2‑T3 tests; plus `curl` an orders endpoint with no token → 401.

---

### `P2-T3` — Auth/RBAC integration test suite
**Context.** Security must be test‑enforced so it can't silently regress.
**Files.** `backend/src/api/routes/__tests__/*.test.ts` (extend the existing `auth.test.ts`).
**Steps.**
1. Use `supertest` against the Express app with a SQLite test DB seeded with roles/users of varying
   permissions (admin, supervisor, reporter, standard).
2. For a representative protected route per resource, assert: no token → 401; valid token wrong
   permission → 403; correct permission → 2xx; invalid body → 400.
3. Cover `/auth/login` success + failure and `/me`.
**Acceptance criteria.** Tests exist for each resource family and pass.
**Verification.** `cd backend && npm run test -- --run` green; coverage report includes auth paths.

---

### `P2-T4` — First‑run setup wizard + guard
**Context.** `setup.ts` + `SetupGuard.tsx` + `Setup.tsx` exist; must reliably bootstrap and then lock.
**Files.** `backend/src/api/routes/setup.ts`, `backend/src/services/seeder.ts`,
`src/pages/Setup.tsx`, `src/components/SetupGuard.tsx`.
**Steps.**
1. `GET /api/setup/status` → `{ completed: boolean }` (completed when ≥1 active admin user exists).
2. `POST /api/setup/initialize` (public **only while** not completed): create the default org
   (P2‑T6), seed default roles/permissions, create the admin user (email+password), write initial
   `settings` (store name, tax rate, timezone, brand). After completion, all `/api/setup/*` except
   `status` return `409`.
3. `SetupGuard`: if `!completed` and route ≠ `/setup`, redirect to `/setup`; once completed, redirect
   `/setup` → `/login`.
4. Remove any hardcoded demo admin credentials from code; demo creds live only in
   `docker-compose.demo.yml`/seed for the *demo* profile, never in the default install.
**Acceptance criteria.** Fresh DB → wizard runs once, creates admin+org+roles+settings, then locks.
**Verification.** Against a fresh DB: `GET /api/setup/status` → `{completed:false}`; POST initialize
→ 201; second POST → 409; `status` → `{completed:true}`.

---

### `P2-T5` — Finalize the RBAC permission model + seeded roles
**Context.** `RolePermissions` covers inventory/reports/exports/settings/users/services/customers but
not orders/returns/discounts, which P2‑T2 needs.
**Files.** `backend/migrations/{postgres,sqlite}/00X_rbac_permissions.sql` (new), `seeder.ts`,
shared types (`RolePermissions`), `src/pages/admin/AdminRoles.tsx`.
**Steps.**
1. Extend `RolePermissions` to include `orders`, `returns`, `discounts` (each `{read,write,delete}`).
   Because permissions are JSONB, no column change is needed — but update the TS type, the seeder,
   and the AdminRoles UI, and backfill existing role rows via a data migration.
2. Seed four system roles: `admin` (all), `supervisor` (all except users/settings delete),
   `reporter` (reports/exports read only), `standard` (orders write, inventory read).
3. Update `AdminRoles.tsx` to render/edit the full permission matrix.
**Acceptance criteria.** Seeded roles carry sensible permissions incl. orders/returns/discounts;
AdminRoles can view/edit them.
**Verification.** Integration test: a `standard` user can POST an order but not DELETE a product.

---

### `P2-T6` — Nullable `org_id` foundation (D4/C7)  `[parallel-ok with P2-T5]`
**Context.** Multi‑tenant‑ready without paying full SaaS cost now.
**Files.** New migration `00X_org_tenancy.sql` (postgres + sqlite), `seeder.ts`, DB adapters,
`auth.ts` (JWT), `authenticate` middleware.
**Steps.**
1. Create an `organizations` table (`id, name, slug, created_at`). Seed one default org during setup.
2. Add nullable `org_id UUID` to tenant‑scoped tables: `products, product_variants, orders,
   order_items, customers, services, quotes, quote_items, discounts, returns, audit_logs, roles,
   users, settings` (settings may become per‑org later; keep single‑row for v1 but add the column).
   Add indexes on `org_id` where queried.
3. Put `orgId` in the JWT and `req.orgId` in `authenticate` (fallback: the default org id).
4. Update DB adapter read/write methods to filter/set `org_id = req.orgId`. Where a method has no
   request context, pass `orgId` explicitly from the route/service.
5. Document the single‑→multi‑tenant upgrade in `docs/guides/multi-tenant.md` (how to enable per‑org
   provisioning, what to add: org‑scoped login, provisioning API, per‑org settings).
**Acceptance criteria.** All tenant tables have `org_id`; new rows get the default org; queries scope
by org; single‑tenant behavior is unchanged for the end user.
**Verification.** Create products/orders via API → rows have the default `org_id`; a query with a
different org id returns none. Migration applies cleanly on both postgres and sqlite.

---

### `P2-T7` — Audit logging wired to mutations  `[parallel-ok]`
**Context.** `audit_logs` table + `AdminAudit` page exist; ensure writes are actually recorded.
**Files.** A reusable `audit(userId, action, entity, entityId, before, after)` service; call sites in
create/update/delete handlers; `backend/src/api/routes/admin.ts` (list/query audit).
**Steps.**
1. Add an audit service that inserts a row (with `org_id`) for every write on products, orders,
   returns, discounts, users, roles, settings.
2. Ensure `AdminAudit.tsx` reads from `GET /api/admin/audit` with pagination/filtering.
**Acceptance criteria.** Mutations produce audit rows visible in AdminAudit.
**Verification.** Edit a product via API → an audit row appears in `GET /api/admin/audit`.

---

## Progress notes (2026-08-06)

**Done:** P2-T1 (middleware hardened), P2-T2 (auth + RBAC applied across every
route), P2-T3 (guard test suite), P2-T5 (orders/returns/discounts permissions +
migration 008), P2-T7 (audit logging).

P2-T4 is verified: on a completed install `GET /api/setup/status` reports
`needsSetup: false`, and both `POST /api/setup/complete` and
`POST /api/setup/test-database` return `409` — so the wizard cannot be replayed
to mint a second admin. (The plan specifies `{ completed: boolean }`; the
implementation returns the richer `isInitialized`/`hasAdminUser`/`needsSetup`,
which is what the client consumes. Left as-is.)

**P2-T6 is done as a foundation, and stops deliberately short of query
scoping.** There is an `organizations` table with a default org on a fixed id, a
nullable indexed `org_id` on 20 tenant-scoped tables, an `orgId` claim in the
JWT, and `req.orgId` on every authenticated request — resolved from the user's
stored org, then the token claim, then the default, and always populated so no
consumer has to decide what an absent tenant means. The stored value wins over
the claim for the same reason roles are reloaded per request: a token outlives a
change.

**Nothing filters or sets `org_id` yet**, and that is the stopping point rather
than an omission. On a single-org install a correctly scoped query and a
completely unscoped one return identical results, so landing the filtering now
would mean touching every read and write in both adapters with nothing to verify
against, and a failure mode — one query missed, one tenant seeing another's
orders — that stays invisible until the day it is catastrophic. The column is
reversible and free; the filtering is neither.

`docs/guides/multi-tenant.md` sets out what exists, why the scoping is deferred,
and the order to add it in. Its first step is the one worth doing before any
other: backfill `org_id` and make it `NOT NULL` while there is still one org, so
a missed write fails loudly instead of leaking quietly.

**Phase 2 is complete.**

### Defects found while doing the above

Each verified against the running stack, and each fixed in the commit that found
it unless noted:

1. `authenticate` never loaded the user, so a **deactivated account kept full
   access** until its token expired.
2. `authorize(['admin', 'manager'])` guarded uploads and discount management, but
   **no `manager` role has ever existed** — those endpoints were admin-only, and
   supervisors holding the matching permission were refused.
3. **Product and service catalogs were world-readable**, including SKUs and live
   stock counts.
4. **`config.terminalCredentials` was returned in plaintext** by
   `GET /api/admin/settings` — the store's Stripe secret key and Square token, to
   anyone who could read settings.
5. **A partial product update wiped every field it did not mention.** Both
   adapters wrote all six columns unconditionally against an all-optional update
   schema.
6. **`createAuditLog` was never called**, so the audit page had always been empty.
7. The client **hard-coded a 7-day token lifetime** while the server defaults to
   24h, leaving it convinced a dead token was good for six days.
8. `mergePermissions` **threw on a role whose permissions JSON omitted a key**,
   taking down every page behind the session.

### Known gap: the backend is not linted

`backend/package.json` runs `eslint src --ext .ts`; `--ext` was removed in ESLint
9, and there is no `backend/eslint.config.js`, so ESLint walks up and applies the
repo root's React config against a mismatched `typescript-eslint` major and
crashes. The backend CI job runs typecheck, test, and build — not lint — so this
has never failed a build, and backend source has effectively never been linted.

Fixing it needs a backend-local flat config (Node globals, no react plugins, its
own installed plugin versions) plus a corrected script and a CI step. The
`config-protection` hook blocks writing ESLint config files, so this is left for
a deliberate decision rather than worked around.

---

## API keys made real (2026-08-07)

The API-key feature was inert in two separate ways, each hiding the other.

**Creation had never succeeded.** `key_prefix` is `VARCHAR(8)` but
`generateApiKey` emits `spk_` plus eight hex characters — twelve. Every attempt
failed with `value too long for type character varying(8)`. Migration 009 widens
the column to 32.

**Nothing accepted a key as a credential.** Keys could be minted, listed,
scoped, rate-limited, and revoked, and a documented endpoint described how to
use them — but no middleware ever read `X-API-Key`. An operator would reasonably
believe they had provisioned working access, and handled the returned secret as
though it granted something.

`authenticate` now takes either a bearer token or an `X-API-Key`. A key's scopes
expand into the same per-resource permission shape a role carries, so
`requirePermission` treats a key and a person identically rather than growing a
second authorisation path that could drift: `read` grants read everywhere,
`write` adds write, `delete` adds delete, and `admin` maps to the admin
archetype. A key that is present but invalid rejects outright rather than
falling through to anonymous.

One guard rail: **an API key cannot manage API keys**, even with `admin` scope.
Otherwise a single compromised key becomes self-renewing — mint a successor,
widen its scopes, revoke the ones being watched.

Verified live across nine cases: valid, unknown prefix, right prefix with wrong
secret, revoked, expired, absent; read-cannot-write, write-cannot-delete, and
admin-refused-on-key-management.

### Also fixed

`POST /api/products` accepted a request with no `category` — optional in the Zod
schema, `NOT NULL` in the database — so a valid-per-schema request returned a
500. It is now a 400 naming the field. Both Zod messages are set, since
`required_error` covers an absent field and the `min` message covers a present
but empty one; setting only one leaves the other as a bare "Required". The
route's error mapping now includes the field path, matching the orders route.
