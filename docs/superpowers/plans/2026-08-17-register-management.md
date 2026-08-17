# Register Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status:** Design, phasing and all five open decisions (§7) **locked 2026-08-17**. Task-level TDD
> steps are written for Phases 1–3; Phases 4–7 carry full scope, file lists and test matrices, and
> their step-by-step TDD scripts get written at the start of each phase once the preceding phase's
> schema is on `main`. Ready to execute from Task 1.1.

**Goal:** Turn StewardPOS from a single implicit till into a managed estate of named, uniquely
identified registers — each bound to a location, each attributing its own sales, drawer and staff —
with admin enrolment, revocation, PIN sign-in and manager override.

**Architecture:** A new `locations` → `registers` hierarchy hangs under the existing (currently
unenforced) `organizations` tenancy. Registers are *enrolled devices*, reusing the proven
`api_keys` prefix+hash+revoke pattern rather than inventing a second credential scheme. Every
money-moving row (`orders`, `returns`, `cash_drawer_sessions`, `payments`) gains a `register_id`
and a `cashier_user_id`, which is what makes per-register and per-employee reporting possible at
all. PIN sign-in creates a *register shift*, not a JWT session; manager override is a single-action
grant that never becomes a session.

**Tech Stack:** Express 4 + TypeScript, `zod` at every boundary, `bcryptjs` for PIN hashing,
paired SQLite/Postgres migrations (next free version: **015**), React 18 + TanStack Query 5 +
shadcn/ui admin surfaces, `vitest` + `supertest` for backend, `vitest` + Testing Library for
frontend, Playwright for E2E.

---

## 1. What exists today (verified, not assumed)

Each of these is a hard blocker or a constraint the plan must route around. Line references are
against `main` at `d62c34c`.

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| B1 | **No register entity of any kind.** No table, no type, no route. | `grep -ri register` returns only prose in comments and `src/lib/register-math.ts` (pure arithmetic). | Everything in this plan is net-new. There is nothing to migrate *from*, only rows to backfill. |
| B2 | **Exactly one cash drawer can be open per install, globally.** | `backend/migrations/sqlite/011_cash_drawer_sessions.sql:20-21` — `CREATE UNIQUE INDEX idx_drawer_one_open ON cash_drawer_sessions(status) WHERE status='open'`. Postgres counterpart identical. | Register 2 physically cannot open a drawer while Register 1 is open. This index **must** become per-register before any multi-register drawer work. Highest-risk single change in the plan. |
| B3 | **Orders record no cashier.** | `orders` columns across `001`, `007`, `010`, `014`: `id, created_at, subtotal, discount_total, tax_total, total, payment_method, customer_email, customer_phone, card_transaction_id, card_auth_code, amount_tendered, change_given, org_id`. No user FK. | "Track employee sales" is currently impossible. Employee attribution is a schema change, not a report change. |
| B4 | **Drawer routes have no register concept.** | `backend/src/api/routes/drawer.ts:43` `getOpenDrawerSession()` takes no argument; `:51` `getExpectedDrawerCash(sessionId)`. | Adapter signatures change on both `PostgresAdapter` and `SQLiteAdapter`. `DatabaseAdapter` is a union of the two concrete classes — a signature mismatch breaks *every* call site's typecheck at once. Change both in the same commit. |
| B5 | **Terminal credentials are per-install, not per-device.** | `backend/src/terminal/TerminalAdapterFactory.ts:71,78` reads `config.squareDeviceId` / `config.cloverDeviceId` from global settings. | Three registers with three card readers cannot work. Card reader binding must move onto the register row. Not mentioned in the brief but is a hard requirement for physical multi-register. |
| B6 | **RBAC has 10 resources and no register-shaped one.** | `src/lib/permissions.ts:39-50` `PERMISSION_RESOURCES`; mirrored by `PermissionResource` in `backend/src/api/middleware/authorize.ts:35`. | Adding `registers` requires editing both lists in lock-step. The comment at `src/lib/permissions.ts:8-11` documents exactly this trap: a resource in one list only produces a control that always 403s. |
| B7 | **`organizations` exists but is nullable and unfiltered.** | `014_org_tenancy.sql` adds `org_id` to 19 tables, all nullable, no query filters them. | Registers slot **under** org. Do not build a parallel tenancy — that is the single most expensive mistake available here. |
| B8 | **Migrations are strict paired lock-step.** | `backend/migrations/{sqlite,postgres}/NNN_name.sql`, each ending `INSERT INTO schema_migrations`. | Every migration in this plan is two files, same number, same name, semantically identical. |

---

## 2. Review from the POS-veteran seat

You asked what a former POS designer and developer would add. These are the items missing from the
brief that cause real production pain, ordered by how expensive they are to retrofit later.

### 2.1 Location must be an entity, not a text field

The brief says "Coffee Shop 1 located in church address, located in 1st floor coffee shop." That is
three facts: an organisation, a site with a postal address, and a placement description. If the
address lives as free text on the register row, then three registers at the same site carry three
independently-drifting copies of the address, and "sales by site" is a string-matching exercise.

**Model it as `locations`** (name, address, timezone) with registers as children carrying a free-text
`placement` ("1st floor coffee shop"). This also gives you per-site timezone, which the reporting
layer needs the moment a mobile register travels — `ReportRange` is epoch-ms and the service is what
turns a date into an instant (`backend/src/adapters/db/reports.types.ts:22-25`), so it needs to know
*whose* midnight.

### 2.2 "Web only" and "with/without drawer" are two different axes

The brief treats these as one list. They are orthogonal, and collapsing them means you cannot express
"mobile tablet that accepts cash into a pouch" or "fixed register that is card-only."

- **`type`** — `fixed` | `mobile` | `web` | `kiosk`. What kind of thing it is.
- **Capabilities** — `has_cash_drawer`, `accepts_cash`, `can_refund`, `can_open_drawer_no_sale`.
  What it is allowed to do.

A `web` register with `has_cash_drawer = false` must be *prevented from opening a drawer session at
all*, not merely discouraged. Otherwise the drawer variance report silently accumulates phantom
sessions with no physical till behind them.

### 2.3 Revocation needs defined semantics, not just a flag

"Revoke register" is easy to add and easy to get wrong. Four questions the brief does not answer, and
the answers this plan takes:

| Question | This plan's answer |
|---|---|
| What happens to the in-flight sale on a revoked register? | Current cart is preserved client-side, checkout is refused with `409`. No half-written orders. |
| What happens to its open drawer session? | Revocation is **blocked** while a drawer is open, unless the admin passes `force: true`, which closes the session at expected-cash with a `revoked_with_open_drawer` note and a variance flagged for review. Silently orphaning a drawer session loses money. |
| Can a register with sales history be deleted? | Never. `status` moves to `retired`. Historical orders keep pointing at it. Reports must still name it. |
| Can it be un-revoked? | Yes, but re-enrolment is required — the device credential is destroyed, not paused. This is the difference between "revoke" and "disable". Both exist. |

### 2.4 The attribution chain is the whole feature

Everything you asked to report on reduces to one question: *for this order, which register, which
cashier, which drawer session, and who authorised the exception?* Four columns on `orders`:
`register_id`, `cashier_user_id`, `drawer_session_id`, `override_by_user_id`. Same four on `returns`.
Get these in early (Phase 2) — every later phase reads them, and backfilling them after volume
accumulates is painful.

### 2.5 PIN sign-in is a shift, not a login

A PIN is a weak secret — six digits, entered in public, on a shared screen. It must never mint
a JWT. What it does is open a **register shift**: a row saying "user U is the active cashier on
register R from time T." Sales during the shift attribute to U. Non-negotiables:

- **Six digits (locked, D4).** `pin_length` is an org setting with a **minimum of 6** and a default of
  6. Four is not offered: a 4-digit space is 10k candidates and falls to brute force in under an hour
  even behind a lockout, once you account for an attacker with physical access to the pad over weeks.
- **bcrypt-hashed**, same cost factor as passwords. Never stored or logged reversibly.
- **Unique per organisation.** If two employees share a PIN, attribution is a coin flip and the
  feature is worse than nothing. Enforce at write time with a clear error.
- **Rate limited and locked out** — 5 failures locks the user's PIN for 15 minutes, recorded in the
  audit log. This is what makes even a 6-digit PIN defensible on a shared screen.
- **Idle auto-lock**, register-configurable (default 5 min). Without it, the shift outlives the person
  standing there and attribution becomes fiction.
- **Never in an API response or an audit payload.** The audit service already snapshots `before`/`after`
  (`backend/src/services/audit.ts`) — PIN fields need explicit redaction, or you write hashes into a
  table that admins can read.

### 2.6 Manager override is a grant, not an elevation

The brief asks for "manager PIN override to allow administrative functions on registers." The correct
shape is a **single-action, time-boxed grant**: the supervisor enters a PIN, the server returns a token
valid for one named action for 90 seconds, the cashier's shift is untouched, and the override is
written to the audit log with the action, the approver, and the value overridden. It must never log the
cashier out or hand back a session.

**What needs override in a real store** — this is the list the brief is missing:

| Action | Why it is an override |
|---|---|
| Price override on a line | Direct margin loss |
| Discount above `approvalThreshold` | **Already modelled** — `discount_types.requires_approval` / `approval_threshold` exist from migration `004`. Wire the override flow into this hook rather than building a second approval concept. |
| Return or refund without a receipt | Classic fraud vector |
| No-sale drawer open | The single best theft signal in a POS; count per register per shift |
| Voiding a completed transaction | Post-void is how shrinkage is hidden |
| Closing a drawer with variance over threshold | Forces a second pair of eyes on a short till |
| Selling into negative inventory | Masks a count error |
| Reprinting a gift receipt | Refund-fraud enabler |

### 2.7 Estate visibility

With 3+ registers an admin's first question is "which ones are alive?" Registers heartbeat every 60s;
`last_seen_at` drives a derived status (`online` < 2 min, `idle` < 15 min, `offline` beyond). This is
cheap now and impossible to add convincingly later.

### 2.8 Reports the estate actually needs

Beyond "how many sales per register," which the brief asks for:

- Sales by register, by employee, by location, over a range — with comparison across registers
- Average ticket and transaction count per register (identifies an under-used lane)
- Hourly heatmap per register (staffing decisions)
- **Drawer variance by register and by employee** — the report that catches problems
- **No-sale count per register per shift** — the report that catches theft
- Override log: who authorised what, on which register
- Web-vs-drawer split, which you asked for explicitly, falls out of `type` + `has_cash_drawer`

### 2.9 Things this plan deliberately does *not* do

Stated so they are not accidentally half-built:

- **Offline mode.** A mobile register losing signal is a genuinely hard distributed-systems problem
  (conflict resolution on inventory, order-number collisions, drawer reconciliation). Out of scope.
  Registers require connectivity. Say so in the UI.
- **Cross-register cart handoff / parked sales moving between registers.**
- **Per-register pricing or catalogue.** Catalogue stays org-wide.
- **Time and attendance.** A register shift is not a timeclock; do not let it become one.
- **Enforcing org filtering on the 19 tables from `014`.** Separate work, separate blast radius.

---

## 3. Domain model

```
organizations (exists, 014)
  └── locations (new)                 name, address, city/state/zip, timezone, status
        └── registers (new)           name, register_number, display_code, type,
                                      capabilities, status, settings, last_seen_at
              ├── register_credentials (new)   enrolment token: prefix + bcrypt hash + revoked_at
              ├── register_shifts (new)        cashier sign-in/out, PIN-driven
              ├── cash_drawer_sessions (011)   + register_id, + shift_id
              └── orders / returns / payments  + register_id, + cashier_user_id,
                                               + drawer_session_id, + override_by_user_id

users (exists)  + pin_hash, pin_set_at, pin_failed_count, pin_locked_until, can_override
register_overrides (new)   action, register_id, approver, target entity, before/after value
```

### 3.1 Identity fields on a register

Your brief asks for name, register number and auto-generated unique ID. Three distinct fields, each
with a job:

| Field | Example | Generated | Purpose |
|---|---|---|---|
| `id` | `01J8ZQ...` (UUID/ULID) | Yes, server | Foreign keys. Never shown to a user. |
| `register_number` | `1`, `2`, `3` | Yes, next free **per location** | What staff say out loud. Unique within a location, not globally — "Register 1" at the Church site and "Register 1" at the Annex are both legitimate. |
| `display_code` | `CHR-COF-01` | Yes, from location slug + number; admin may override | Printed on receipts and shown in reports. Human-readable, stable, unambiguous across locations. |

Receipts print `display_code` and the cashier's name. The receipt branding surface already exists
(migration `005`, `AdminSettings.tsx`), so this is an additive change to the render, not new plumbing.

### 3.2 Migration 015 — `locations` and `registers`

Written here in full because it is the foundation every later task depends on. SQLite shown.

**Postgres conversion rules — verified against the existing pairs, follow exactly:**

| SQLite | Postgres | Why |
|---|---|---|
| `TEXT` id / FK | `UUID`, `PRIMARY KEY DEFAULT uuid_generate_v4()` | Matches `001` onward |
| `TEXT` short string | `VARCHAR(n)` | Matches existing column sizing |
| `INTEGER` epoch-ms timestamp | **`TIMESTAMP ... DEFAULT CURRENT_TIMESTAMP`** — *not* `BIGINT` | See warning below |
| `REAL` money | `DECIMAL(10,2)` | House money rule |
| `INTEGER 0/1` flag | `BOOLEAN ... DEFAULT TRUE/FALSE` | Matches existing flags |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT (id) DO NOTHING` | Matches existing backfills |

> ⚠️ **Never use `BIGINT` for a timestamp on the Postgres side.** SQLite stores epoch-ms integers and
> Postgres stores `TIMESTAMP`; the adapter reconciles them at the boundary with
> `new Date(row.created_at).getTime()` (`PostgresAdapter.ts:77,123,377,…` — the pattern is universal).
> `pg` returns `int8` as a **JavaScript string**, so a `BIGINT` column makes that call
> `new Date("1755400000000")` → `Invalid Date`, silently. Every timestamp column in this plan —
> `created_at`, `updated_at`, `last_seen_at`, `enrolled_at`, `revoked_at`, `started_at`, `ended_at`,
> `pin_set_at`, `pin_locked_until` — is `TIMESTAMP` in Postgres and `INTEGER` in SQLite.

```sql
-- backend/migrations/sqlite/015_registers.sql

-- Org-level policy (D4, D5). Lives on organizations rather than settings because
-- both are per-tenant and settings is already a wide single-row table.
ALTER TABLE organizations ADD COLUMN max_registers INTEGER;      -- NULL = unlimited
ALTER TABLE organizations ADD COLUMN pin_length INTEGER NOT NULL DEFAULT 6;

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  address TEXT, city TEXT, state TEXT, zip TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'active',   -- active | retired
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_org_slug ON locations(org_id, slug);

CREATE TABLE IF NOT EXISTS registers (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,                       -- 'Coffee Shop 1'
  register_number INTEGER NOT NULL,         -- unique within location
  display_code TEXT NOT NULL,               -- 'CHR-COF-01'
  placement TEXT,                           -- '1st floor coffee shop'
  type TEXT NOT NULL DEFAULT 'fixed',       -- fixed | mobile | web | kiosk
  has_cash_drawer INTEGER NOT NULL DEFAULT 1,
  accepts_cash INTEGER NOT NULL DEFAULT 1,
  can_refund INTEGER NOT NULL DEFAULT 1,
  can_open_drawer_no_sale INTEGER NOT NULL DEFAULT 0,
  require_sign_in INTEGER NOT NULL DEFAULT 0,
  idle_lock_seconds INTEGER NOT NULL DEFAULT 300,
  terminal_provider TEXT,                   -- null | square | clover | stripe
  terminal_device_id TEXT,                  -- per-register reader binding (B5)
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | active | disabled | retired
  last_seen_at INTEGER,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_registers_loc_number
  ON registers(location_id, register_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_registers_display_code
  ON registers(org_id, display_code);
CREATE INDEX IF NOT EXISTS idx_registers_status ON registers(status);
CREATE INDEX IF NOT EXISTS idx_registers_location ON registers(location_id);

-- Backfill: one location and one register so existing history is attributable
-- rather than landing in an unlabelled bucket in every report.
INSERT OR IGNORE INTO locations (id, org_id, name, slug, timezone)
VALUES ('00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-000000000001',
        'Main Location', 'main', 'UTC');

INSERT OR IGNORE INTO registers
  (id, org_id, location_id, name, register_number, display_code, type, status)
VALUES ('00000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a1',
        'Register 1', 1, 'MAIN-01', 'fixed', 'active');

INSERT INTO schema_migrations (version, name) VALUES (15, '015_registers');
```

### 3.3 Migration 016 — attribution columns and the drawer index fix (B2, B3)

```sql
-- backend/migrations/sqlite/016_register_attribution.sql
ALTER TABLE orders ADD COLUMN register_id TEXT REFERENCES registers(id);
ALTER TABLE orders ADD COLUMN cashier_user_id TEXT REFERENCES users(id);
ALTER TABLE orders ADD COLUMN drawer_session_id TEXT REFERENCES cash_drawer_sessions(id);
ALTER TABLE orders ADD COLUMN override_by_user_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_orders_register ON orders(register_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_cashier  ON orders(cashier_user_id, created_at);

ALTER TABLE returns ADD COLUMN register_id TEXT REFERENCES registers(id);
ALTER TABLE returns ADD COLUMN cashier_user_id TEXT REFERENCES users(id);
ALTER TABLE returns ADD COLUMN override_by_user_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_returns_register ON returns(register_id, created_at);

ALTER TABLE payments ADD COLUMN register_id TEXT REFERENCES registers(id);

ALTER TABLE cash_drawer_sessions ADD COLUMN register_id TEXT REFERENCES registers(id);
ALTER TABLE cash_drawer_sessions ADD COLUMN shift_id TEXT;

-- Backfill every historical row onto the migrated default register (3.2).
UPDATE orders               SET register_id = '00000000-0000-0000-0000-0000000000b1' WHERE register_id IS NULL;
UPDATE returns              SET register_id = '00000000-0000-0000-0000-0000000000b1' WHERE register_id IS NULL;
UPDATE payments             SET register_id = '00000000-0000-0000-0000-0000000000b1' WHERE register_id IS NULL;
UPDATE cash_drawer_sessions SET register_id = '00000000-0000-0000-0000-0000000000b1' WHERE register_id IS NULL;

-- B2: replace the global one-open-drawer index with a per-register one.
-- Order matters. Dropping before creating leaves a window with no constraint;
-- the migrator runs each file in a transaction, so the window never commits.
DROP INDEX IF EXISTS idx_drawer_one_open;
CREATE UNIQUE INDEX IF NOT EXISTS idx_drawer_one_open_per_register
  ON cash_drawer_sessions(register_id, status) WHERE status = 'open';

INSERT INTO schema_migrations (version, name) VALUES (16, '016_register_attribution');
```

> **Postgres note:** `DROP INDEX IF EXISTS idx_drawer_one_open;` then the partial unique index with
> the same `WHERE status = 'open'` predicate. Do **not** use `CONCURRENTLY` — the migrator wraps each
> file in a transaction and `CREATE INDEX CONCURRENTLY` cannot run inside one.

### 3.4 Migration 017 — PIN, shifts, credentials, overrides

```sql
-- backend/migrations/sqlite/017_register_access.sql
ALTER TABLE users ADD COLUMN pin_hash TEXT;
ALTER TABLE users ADD COLUMN pin_set_at INTEGER;
ALTER TABLE users ADD COLUMN pin_failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pin_locked_until INTEGER;
ALTER TABLE users ADD COLUMN can_override INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS register_credentials (
  id TEXT PRIMARY KEY,
  register_id TEXT NOT NULL REFERENCES registers(id),
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  enrolled_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER,
  revoked_by TEXT REFERENCES users(id),
  revoke_reason TEXT,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_regcred_prefix ON register_credentials(token_prefix);
CREATE UNIQUE INDEX IF NOT EXISTS idx_regcred_one_active
  ON register_credentials(register_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS register_shifts (
  id TEXT PRIMARY KEY,
  register_id TEXT NOT NULL REFERENCES registers(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  end_reason TEXT,                  -- signed_out | idle_timeout | revoked | forced
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_one_open_per_register
  ON register_shifts(register_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shift_user ON register_shifts(user_id, started_at);

CREATE TABLE IF NOT EXISTS register_overrides (
  id TEXT PRIMARY KEY,
  register_id TEXT NOT NULL REFERENCES registers(id),
  shift_id TEXT REFERENCES register_shifts(id),
  approver_user_id TEXT NOT NULL REFERENCES users(id),
  requested_by_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,             -- price_override | discount_approval | no_receipt_return |
                                    -- no_sale | void | drawer_variance | negative_stock | gift_reprint
  entity TEXT, entity_id TEXT,
  before_value TEXT, after_value TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_overrides_register ON register_overrides(register_id, created_at);
CREATE INDEX IF NOT EXISTS idx_overrides_approver ON register_overrides(approver_user_id, created_at);

INSERT INTO schema_migrations (version, name) VALUES (17, '017_register_access');
```

**PIN uniqueness (§2.5) cannot be a DB constraint** — bcrypt salts mean two identical PINs hash
differently. It is enforced in the service layer: on set, load all active users' `pin_hash` in the org
and `bcrypt.compare` the candidate against each. At a few hundred users this is acceptable; it is
documented in the service with that caveat.

---

## 4. Phases

Each phase ends green on `main` with its own PR. CI only runs for PRs onto `main`/`develop`, so do not
stack these — merge each before branching the next.

### Phase 1 — Locations and registers (schema + CRUD + admin page)

**Delivers:** an admin can create locations, create registers under them, and see the list. No
behaviour change to the POS yet. Safe to ship alone.

| Task | Files |
|---|---|
| 1.1 Migration 015, both dialects | `backend/migrations/{sqlite,postgres}/015_registers.sql` |
| 1.2 Adapter methods on **both** adapters in one commit (B4) | `backend/src/adapters/db/{SQLiteAdapter,PostgresAdapter}.ts` |
| 1.3 `registers` service — numbering, display-code generation, validation | Create `backend/src/services/registers.ts` |
| 1.4 Routes with zod schemas | Create `backend/src/api/routes/registers.ts`, `locations.ts`; mount in `backend/src/app.ts` |
| 1.5 `registers` RBAC resource in **both** lists (B6) | `src/lib/permissions.ts:39-50`, `backend/src/api/middleware/authorize.ts` |
| 1.6 Typed SDK + query hooks | Create `src/lib/api/registers.ts`, `src/hooks/queries/useRegisters.ts`; export from `src/lib/api/index.ts`, `src/hooks/queries/{index,keys}.ts` |
| 1.7 Admin page + route | Create `src/pages/admin/AdminRegisters.tsx`; add route in `src/App.tsx` (mirroring the `/admin/*` guard pattern at `:79-92`); add tile to `src/pages/admin/Dashboard.tsx` |

**Task 1.1 — TDD steps**

- [ ] **Step 1: Write the failing migration test**

  In `backend/src/services/__tests__/migrator.test.ts`, add a new `describeSqlite` block alongside
  the existing ones.

  **Harness facts you must work with** (verified against the file, do not assume otherwise):
  - There is **no** `freshMigratedDb()` helper. The file opens **one shared `db`** in `beforeAll`
    after running the full migration chain, and it is opened **`{ readonly: true }`**.
  - Because it is readonly, **no test in this file can INSERT.** Constraint-violation tests belong in
    the adapter tests (Task 1.2), not here.
  - Existing helpers available: `columns(table: string): string[]` (via `PRAGMA table_info`) and
    `tables(): string[]`. Reuse them rather than writing new ones.
  - Use `describeSqlite`, not bare `describe` — it skips when the native binding is missing locally
    and throws in CI.

  ```ts
  describeSqlite('migration 015: locations and registers', () => {
    it('creates the locations and registers tables', () => {
      const present = tables();
      expect(present).toContain('locations');
      expect(present).toContain('registers');
    });

    it('gives registers the identity, capability and policy columns', () => {
      const cols = columns('registers');
      for (const col of [
        'id', 'org_id', 'location_id', 'name', 'register_number', 'display_code',
        'placement', 'type', 'has_cash_drawer', 'accepts_cash', 'can_refund',
        'can_open_drawer_no_sale', 'require_sign_in', 'idle_lock_seconds',
        'terminal_provider', 'terminal_device_id', 'status', 'last_seen_at',
      ]) {
        expect(cols, `registers is missing column: ${col}`).toContain(col);
      }
    });

    it('backfills one location and one register so existing history is attributable', () => {
      const loc = db.prepare("SELECT * FROM locations WHERE slug = 'main'").get() as
        { id: string; timezone: string } | undefined;
      expect(loc).toBeDefined();
      expect(loc!.timezone).toBe('UTC');

      const regs = db.prepare('SELECT * FROM registers').all() as Array<{
        display_code: string; register_number: number; status: string; location_id: string;
      }>;
      expect(regs).toHaveLength(1);
      expect(regs[0].display_code).toBe('MAIN-01');
      expect(regs[0].register_number).toBe(1);
      expect(regs[0].status).toBe('active');
      expect(regs[0].location_id).toBe(loc!.id);
    });

    it('defaults org policy to a 6-digit PIN and an unlimited register cap (D4, D5)', () => {
      const org = db.prepare("SELECT * FROM organizations WHERE slug = 'default'").get() as
        { pin_length: number; max_registers: number | null };
      expect(org.pin_length).toBe(6);
      expect(org.max_registers).toBeNull();
    });

    it('declares the uniqueness the estate depends on', () => {
      const idx = (db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('registers','locations')"
      ).all() as Array<{ name: string }>).map((r) => r.name);
      expect(idx).toContain('idx_registers_loc_number');
      expect(idx).toContain('idx_registers_display_code');
      expect(idx).toContain('idx_locations_org_slug');
    });
  });
  ```

  **Also update the two existing chain assertions** — they hard-code the version reached:
  `expect(applied.count).toBeGreaterThanOrEqual(14)` and
  `expect(version).toBeGreaterThanOrEqual(14)` both become `15`. Leaving them at 14 means the chain
  test passes even if `015` never applied, which is precisely the failure it exists to catch.

- [ ] **Step 2: Run it and confirm it fails**

  Run: `cd backend && npx vitest run src/services/__tests__/migrator.test.ts -t "migration 015"`
  Expected: FAIL — `no such table: locations` on the backfill and index cases, and the `tables()`
  assertion reporting neither table present. If instead every test *skips*, the `better-sqlite3`
  native binding is missing locally — that is an environment problem, not a passing run. Fix the
  binding before continuing; a skip here proves nothing.

- [ ] **Step 3: Write both migration files**

  Create `backend/migrations/sqlite/015_registers.sql` exactly as §3.2, and
  `backend/migrations/postgres/015_registers.sql` as its counterpart using the conversion table in
  §3.2 — in particular timestamps are `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`, **never** `BIGINT`
  (read the warning; it is a silent `Invalid Date` bug, not a style preference). Head both files with
  the cross-reference comment the existing pairs use.

- [ ] **Step 4: Run both suites**

  Run: `cd backend && npx vitest run src/services/__tests__/migrator.test.ts`
  Expected: PASS.
  Run: `cd backend && npx vitest run src/adapters/db/__tests__/integration/provisioning.integration.test.ts`
  Expected: PASS (Postgres parity — this is what catches a dialect drift).

- [ ] **Step 5: Commit**

  ```bash
  git add backend/migrations/sqlite/015_registers.sql \
          backend/migrations/postgres/015_registers.sql \
          backend/src/services/__tests__/migrator.test.ts
  git commit -m "feat(registers): add locations and registers schema with backfilled default"
  ```

**Task 1.3 — the two rules worth writing tests for first**

Register numbering and display-code generation are the only real logic in Phase 1, so they carry the
unit tests. Write these in `backend/src/services/__tests__/registers.test.ts` before the service:

```ts
describe('nextRegisterNumber', () => {
  it('starts at 1 in an empty location', async () => {
    expect(await nextRegisterNumber(adapter, 'loc-empty')).toBe(1);
  });
  it('fills the lowest free number, not max+1, so retiring #2 reuses it', async () => {
    // registers 1 and 3 exist
    expect(await nextRegisterNumber(adapter, 'loc-gap')).toBe(2);
  });
  it('numbers independently per location', async () => {
    expect(await nextRegisterNumber(adapter, 'loc-b')).toBe(1); // even though loc-a has 1,2,3
  });
});

describe('buildDisplayCode', () => {
  it('joins the location slug and a zero-padded number', () => {
    expect(buildDisplayCode('church-coffee', 1)).toBe('CHURCH-COFFEE-01');
  });
  it('pads to two digits and does not truncate past nine', () => {
    expect(buildDisplayCode('main', 12)).toBe('MAIN-12');
  });
  it('uppercases and strips characters that would break a receipt line', () => {
    expect(buildDisplayCode('1st Floor / Café', 3)).toBe('1ST-FLOOR-CAFE-03');
  });
});

describe('register cap (D5)', () => {
  it('allows creation up to organizations.max_registers', async () => {
    await setOrgLimit('org-1', { maxRegisters: 3 });
    for (let i = 0; i < 3; i++) await createRegister('org-1', 'loc-a', `R${i}`);
    expect(await activeRegisterCount('org-1')).toBe(3);
  });
  it('refuses the one past the cap with 422, not 500', async () => {
    await setOrgLimit('org-1', { maxRegisters: 3 });
    for (let i = 0; i < 3; i++) await createRegister('org-1', 'loc-a', `R${i}`);
    await expect(createRegister('org-1', 'loc-a', 'R4'))
      .rejects.toMatchObject({ status: 422, code: 'REGISTER_LIMIT_REACHED' });
  });
  it('counts only active and pending registers, so retiring one frees a slot', async () => {
    await setOrgLimit('org-1', { maxRegisters: 1 });
    const r = await createRegister('org-1', 'loc-a', 'R1');
    await retireRegister(r.id);
    await expect(createRegister('org-1', 'loc-a', 'R2')).resolves.toBeDefined();
  });
  it('treats a null cap as unlimited', async () => {
    await setOrgLimit('org-1', { maxRegisters: null });
    for (let i = 0; i < 25; i++) await createRegister('org-1', 'loc-a', `R${i}`);
    expect(await activeRegisterCount('org-1')).toBe(25);
  });
});
```

### Phase 2 — Attribution (the load-bearing phase)

**Delivers:** every order, return, payment and drawer session records its register; the global
one-open-drawer index becomes per-register.

**This is the highest-risk phase.** B2's index swap and B4's adapter signature change land together.
Both adapters change in one commit or the union type breaks every call site.

| Task | Files |
|---|---|
| 2.1 Migration 016, both dialects, with backfill | `backend/migrations/{sqlite,postgres}/016_register_attribution.sql` |
| 2.2 `getOpenDrawerSession(registerId)` on both adapters | `backend/src/adapters/db/{SQLiteAdapter,PostgresAdapter}.ts` |
| 2.3 Drawer routes take a register; refuse if `has_cash_drawer` is false (§2.2) | `backend/src/api/routes/drawer.ts:40-153` |
| 2.4 Checkout stamps register + cashier + drawer session | `backend/src/api/routes/orders.ts` |
| 2.5 Returns stamp register + cashier | `backend/src/api/routes/returns.ts` |
| 2.6 Client sends its register on every money call | `src/lib/api/{orders,drawer,returns}.ts`, `src/pages/POS.tsx` |

**The three tests that must exist before 2.1 merges:**

```ts
it('lets two registers hold an open drawer at the same time', async () => {
  await adapter.openDrawerSession({ registerId: 'R1', openingFloat: 100, userId: 'u1' });
  const second = adapter.openDrawerSession({ registerId: 'R2', openingFloat: 50, userId: 'u2' });
  await expect(second).resolves.toMatchObject({ registerId: 'R2', status: 'open' });
});

it('still refuses a second open drawer on the same register', async () => {
  await adapter.openDrawerSession({ registerId: 'R1', openingFloat: 100, userId: 'u1' });
  await expect(
    adapter.openDrawerSession({ registerId: 'R1', openingFloat: 20, userId: 'u2' })
  ).rejects.toThrow(/already open/i);
});

it('backfills every pre-existing order onto the migrated default register', async () => {
  // seed orders against a db migrated only to 015, then run 016
  const orphans = db.prepare('SELECT COUNT(*) c FROM orders WHERE register_id IS NULL').get();
  expect(orphans.c).toBe(0);
});
```

### Phase 3 — Enrolment, heartbeat and revocation

**Delivers:** a register is a paired device. Admin issues a pairing code, the device redeems it once,
holds a token, heartbeats, and can be revoked.

Reuse the `api_keys` shape (`002_api_keys.sql`, `backend/src/api/routes/apikeys.ts`) rather than
inventing a second credential scheme: short prefix stored plainly for lookup, bcrypt hash for
verification, `revoked_at` for the kill switch, `last_used_at` for liveness.

| Task | Files |
|---|---|
| 3.1 Migration 017 credentials portion | `backend/migrations/{sqlite,postgres}/017_register_access.sql` |
| 3.2 Pairing-code issue / redeem / rotate service | Create `backend/src/services/registerEnrolment.ts` |
| 3.3 `registerAuth` middleware — resolves a device token to a register | Create `backend/src/api/middleware/registerAuth.ts` |
| 3.4 Enrolment + heartbeat + revoke routes | `backend/src/api/routes/registers.ts` |
| 3.5 Device-side token storage and pairing screen | Create `src/lib/register-device.ts`, `src/pages/PairRegister.tsx` |
| 3.6 Admin revoke UI with the open-drawer guard (§2.3) | `src/pages/admin/AdminRegisters.tsx` |

**Revocation tests — these encode §2.3 and are the ones that matter:**

```ts
it('refuses to revoke a register with an open drawer unless forced', async () => {
  await openDrawer('R1', 100);
  await expect(revokeRegister('R1', { by: 'admin' }))
    .rejects.toMatchObject({ status: 409 });
});

it('force-revoke closes the drawer at expected cash and flags it for review', async () => {
  await openDrawer('R1', 100);
  await sellCash('R1', 25);
  await revokeRegister('R1', { by: 'admin', force: true });
  const session = await lastDrawerSession('R1');
  expect(session.status).toBe('closed');
  expect(session.countedCash).toBe(125);
  expect(session.notes).toContain('revoked_with_open_drawer');
});

it('refuses checkout from a revoked register with 409, writing no order', async () => {
  await revokeRegister('R1', { by: 'admin' });
  const before = await orderCount();
  await expect(checkout('R1', cart)).rejects.toMatchObject({ status: 409 });
  expect(await orderCount()).toBe(before);
});

it('never deletes a register that has sales; it retires it', async () => {
  await sellCash('R1', 10);
  await deleteRegister('R1');
  expect((await getRegister('R1')).status).toBe('retired');
});

it('destroys the device credential on revoke, so re-enrolment is required', async () => {
  const token = await enrol('R1');
  await revokeRegister('R1', { by: 'admin' });
  await expect(heartbeat(token)).rejects.toMatchObject({ status: 401 });
});
```

### Phase 4 — PIN sign-in and register shifts

**Delivers:** `require_sign_in` on a register forces a PIN before ringing; sales attribute to the
signed-in employee; idle auto-lock ends the shift.

| Task | Files |
|---|---|
| 4.1 Migration 017 PIN + shifts portion (lands with 3.1) | `backend/migrations/{sqlite,postgres}/017_register_access.sql` |
| 4.2 PIN service — set, verify, org-uniqueness, lockout (§2.5) | Create `backend/src/services/pins.ts` |
| 4.3 Shift service — start, end, idle expiry, one-open-per-register | Create `backend/src/services/registerShifts.ts` |
| 4.4 Shift routes, rate-limited via existing `express-rate-limit` | `backend/src/api/routes/registers.ts` |
| 4.5 Audit redaction for every PIN field (§2.5) | `backend/src/services/audit.ts` |
| 4.6 Admin: set/reset an employee PIN, revoke register access | `src/pages/admin/AdminRoles.tsx` or a new `AdminEmployeeAccess.tsx` |
| 4.7 POS: PIN pad, lock screen, idle timer | Create `src/components/register/PinPad.tsx`, `LockScreen.tsx`; wire into `src/pages/POS.tsx` |

**Security tests — every one of these is required before merge:**

```ts
it('stores a PIN only as a bcrypt hash', async () => {
  await setPin('u1', '482197');
  const row = await rawUser('u1');
  expect(row.pin_hash).not.toContain('482197');
  expect(row.pin_hash).toMatch(/^\$2[aby]\$/);
});

it('refuses a PIN already in use by another active user in the org', async () => {
  await setPin('u1', '482197');
  await expect(setPin('u2', '482197')).rejects.toThrow(/already in use/i);
});

it('locks the PIN for 15 minutes after 5 failures and audits the lockout', async () => {
  for (let i = 0; i < 5; i++) await verifyPin('u1', '0000').catch(() => {});
  await expect(verifyPin('u1', '482197')).rejects.toMatchObject({ code: 'PIN_LOCKED' });
  expect(await auditEntries({ action: 'pin_lockout', userId: 'u1' })).toHaveLength(1);
});

it('never returns a PIN field on any user endpoint', async () => {
  const res = await request(app).get('/api/admin/users').set(adminAuth);
  expect(JSON.stringify(res.body)).not.toMatch(/pin_hash|pinHash/);
});

it('redacts PIN fields from audit before/after snapshots', async () => {
  await setPin('u1', '482197');
  const entry = await lastAudit({ entity: 'user', entityId: 'u1' });
  expect(JSON.stringify(entry)).not.toMatch(/\$2[aby]\$|482197/);
});

it('a PIN sign-in issues a shift, never a JWT', async () => {
  const res = await request(app).post('/api/registers/R1/shifts').send({ pin: '482197' });
  expect(res.body.data.shiftId).toBeDefined();
  expect(JSON.stringify(res.body)).not.toMatch(/token|jwt/i);
});

it('ends the shift after the register idle timeout and attributes nothing after it', async () => {
  await startShift('R1', '482197');
  await advanceTime(301_000);                    // idle_lock_seconds default 300
  await expect(checkout('R1', cart)).rejects.toMatchObject({ code: 'SHIFT_EXPIRED' });
});

it('attributes an order to the signed-in cashier', async () => {
  const { shiftId } = await startShift('R1', '482197');
  const order = await checkout('R1', cart, { shiftId });
  expect(order.cashierUserId).toBe('u1');
});

it('refuses to ring on a require_sign_in register with no open shift', async () => {
  await setRegister('R1', { requireSignIn: true });
  await expect(checkout('R1', cart)).rejects.toMatchObject({ code: 'SHIFT_REQUIRED' });
});
```

### Phase 5 — Manager override

**Delivers:** a supervisor PIN authorises one named action for 90 seconds without disturbing the
cashier's shift, and every use is logged.

Wire `discount_approval` into the **existing** `discount_types.requires_approval` /
`approval_threshold` columns from migration `004` (§2.6) — do not build a second approval concept.

| Task | Files |
|---|---|
| 5.1 Override service — grant, consume-once, expiry, `can_override` check | Create `backend/src/services/registerOverrides.ts` |
| 5.2 `POST /api/registers/:id/overrides` returning a one-shot grant | `backend/src/api/routes/registers.ts` |
| 5.3 Enforce the grant at each of the eight action sites (§2.6 table) | `backend/src/api/routes/{orders,returns,discounts,drawer}.ts` |
| 5.4 Override prompt component | Create `src/components/register/OverridePrompt.tsx` |
| 5.5 Admin override log view | Create `src/pages/admin/AdminOverrides.tsx`; route in `src/App.tsx` |

```ts
it('grants an override for exactly one action', async () => {
  const g = await requestOverride('R1', { action: 'price_override', pin: 'mgr-pin' });
  await consume(g.token, 'price_override');
  await expect(consume(g.token, 'price_override')).rejects.toMatchObject({ code: 'OVERRIDE_SPENT' });
});

it('refuses a grant used for a different action than it was issued for', async () => {
  const g = await requestOverride('R1', { action: 'price_override', pin: 'mgr-pin' });
  await expect(consume(g.token, 'no_receipt_return'))
    .rejects.toMatchObject({ code: 'OVERRIDE_ACTION_MISMATCH' });
});

it('expires a grant after 90 seconds', async () => {
  const g = await requestOverride('R1', { action: 'no_sale', pin: 'mgr-pin' });
  await advanceTime(91_000);
  await expect(consume(g.token, 'no_sale')).rejects.toMatchObject({ code: 'OVERRIDE_EXPIRED' });
});

it('refuses a PIN belonging to a user without can_override', async () => {
  await expect(requestOverride('R1', { action: 'void', pin: 'cashier-pin' }))
    .rejects.toMatchObject({ status: 403 });
});

it('leaves the cashier shift untouched after an override', async () => {
  const { shiftId } = await startShift('R1', 'cashier-pin');
  await requestOverride('R1', { action: 'price_override', pin: 'mgr-pin' });
  expect((await currentShift('R1')).id).toBe(shiftId);
});

it('records the approver, the action and both values', async () => {
  await overridePrice('R1', { line: 'L1', from: 10.00, to: 7.50, pin: 'mgr-pin' });
  const log = await lastOverride('R1');
  expect(log).toMatchObject({
    action: 'price_override', approverUserId: 'mgr', beforeValue: '10.00', afterValue: '7.50',
  });
});

it('routes a discount above approval_threshold through the same override flow', async () => {
  // discount_types row from migration 004 with requires_approval = 1, approval_threshold = 20
  await expect(applyDiscount('R1', { code: 'BIG', percent: 30 }))
    .rejects.toMatchObject({ code: 'OVERRIDE_REQUIRED', action: 'discount_approval' });
});
```

### Phase 6 — Reporting

**Delivers:** the reports from §2.8. Extends the existing reports layer rather than replacing it.

`backend/src/adapters/db/reports.types.ts` gains `RegisterFilter { registerIds?: string[];
locationIds?: string[]; cashierUserIds?: string[] }`, threaded through the existing `ReportRange`
signatures. New shapes: `SalesByRegister`, `SalesByCashier`, `DrawerVarianceByRegister`,
`NoSaleCount`, `RegisterHourly`.

| Task | Files |
|---|---|
| 6.1 Report types | `backend/src/adapters/db/reports.types.ts` |
| 6.2 Aggregations on both adapters | `backend/src/adapters/db/{SQLiteAdapter,PostgresAdapter}.ts` |
| 6.3 Service composition, integer-cents derived figures | `backend/src/services/reports.ts` |
| 6.4 Routes + filters | `backend/src/api/routes/reports.ts` |
| 6.5 SDK + hooks | `src/lib/api/reports.ts`, `src/hooks/queries/useReports.ts` |
| 6.6 Register report components | Create `src/components/reports/RegisterReport.tsx`, `CashierReport.tsx` |
| 6.7 Register filter on the existing reports pages | `src/pages/admin/AdminReports.tsx`, `src/pages/Reports.tsx` |
| 6.8 Register + cashier columns in exports | `src/lib/export-utils.ts`, `src/lib/export-core.ts`, `src/pages/admin/AdminExports.tsx` |

Reporting tests must cover: totals split by register summing to the unfiltered total; a retired
register still appearing in historical reports; sales attributing to the cashier on shift at
checkout time and not to whoever is on shift when the report runs; web-vs-drawer split deriving from
`type` + `has_cash_drawer`; and per-location timezone producing the correct day boundary (§2.1).

### Phase 7 — Estate polish

| Task | Files |
|---|---|
| 7.1 Heartbeat-derived online/idle/offline status (§2.7) | `backend/src/services/registers.ts`, `src/pages/admin/AdminRegisters.tsx` |
| 7.2 Per-register terminal binding, replacing the global device id (B5) | `backend/src/terminal/TerminalAdapterFactory.ts:71,78` |
| 7.3 `display_code` + cashier name on receipts | `backend/src/api/routes/receipts.ts`, `src/pages/admin/AdminReceipts.tsx` |
| 7.4 Register picker in POS header | `src/pages/POS.tsx` |
| 7.5 Docs | Create `docs/guides/register-management.md`; update `docs/guides/operations.md`, `docs/reference/environment.md` |

---

## 5. Test matrix

Coverage floor is 80% per the project standard. Counts are the minimum that must exist, not a target.

| Layer | Location | Min | Must cover |
|---|---|---|---|
| Migration | `backend/src/services/__tests__/migrator.test.ts` | 12 | 015/016/017 apply clean; backfill leaves zero orphans; drawer index swap; per-location number uniqueness; SQLite↔Postgres parity |
| Adapter unit | `backend/src/adapters/db/__tests__/sqliteQueries.test.ts` | 25 | Every new register/shift/credential/override query, both dialects |
| Adapter integration | `backend/src/adapters/db/__tests__/integration/registers.integration.test.ts` (new) | 15 | Real Postgres: partial unique indexes, FK behaviour, concurrent drawer opens |
| Service unit | `backend/src/services/__tests__/{registers,pins,registerShifts,registerOverrides,registerEnrolment}.test.ts` | 45 | Numbering, display codes, PIN policy, shift lifecycle, grant lifecycle, enrolment |
| Route | `backend/src/api/routes/__tests__/{registers,locations}.test.ts` | 35 | Every endpoint × {authorised, unauthorised, revoked register, validation failure} |
| Security | `backend/src/api/routes/__tests__/registerSecurity.test.ts` (new) | 15 | The §2.5 list plus: cross-org register access 404s; a device token cannot call admin routes; PIN endpoints are rate limited |
| Concurrency | `backend/src/adapters/db/__tests__/integration/registerConcurrency.integration.test.ts` (new) | 6 | Two simultaneous opens on one register → exactly one wins; two registers selling the last unit; two redemptions of one pairing code → one succeeds |
| Reports | `backend/src/services/__tests__/reports.test.ts` | 20 | §2.8 aggregations; split-sums-to-total; retired registers; timezone boundaries |
| Frontend unit | `src/lib/__tests__/register-device.test.ts`, `src/hooks/queries/__tests__/queries.test.tsx` | 20 | Token storage, query keys, cache invalidation on revoke |
| Component | `src/components/__tests__/{PinPad,LockScreen,OverridePrompt,RegisterReport}.test.tsx` | 25 | PIN never rendered in the DOM; masked entry; lock screen traps focus; override prompt clears on cancel |
| Page render | `src/pages/__tests__/adminPages.render.test.tsx` | 6 | `AdminRegisters`, `AdminOverrides` render against stubbed lists — extend the existing model-stub pattern |
| E2E | `e2e/registers.spec.ts`, `e2e/register-shift.spec.ts`, `e2e/register-override.spec.ts` (new) | 12 | Create→enrol→sell→report; two registers concurrently; revoke mid-shift; PIN sign-in/out; override an over-threshold discount |
| Accessibility | `e2e/accessibility.spec.ts` | 4 | PIN pad keyboard-operable; lock screen announced; admin table has row headers; 44px touch targets on the pad |
| Load | `scripts/loadtest-orders.mjs` | — | Extend to drive N registers concurrently; assert no cross-register drawer or order-number collisions |

**Manual QA (cannot be automated):** physical drawer kick on a `has_cash_drawer` register; card reader
bound per register; a mobile register moving between two locations' networks; receipt printing showing
the right `display_code`.

---

## 6. Dependency map

```
                        ┌──────────────────────────────┐
                        │ Decisions §7 — LOCKED ✔      │
                        └───────────────┬──────────────┘
                                        ▼
                    ┌──────────────────────────────────────┐
                    │ P1  015 locations + registers + CRUD │
                    └───────┬───────────────────┬──────────┘
                            ▼                   ▼
        ┌────────────────────────────┐   ┌──────────────────────┐
        │ P2  016 attribution        │   │ P3  017 credentials  │
        │     + drawer index (B2,B3) │   │     enrol / revoke   │
        └───────┬────────────┬───────┘   └───────┬──────────────┘
                │            │                   │
                │            └───────┬───────────┘
                │                    ▼
                │       ┌────────────────────────────┐
                │       │ P4  017 PIN + shifts       │
                │       └────────────┬───────────────┘
                │                    ▼
                │       ┌────────────────────────────┐
                │       │ P5  manager override       │
                │       └────────────┬───────────────┘
                ▼                    ▼
        ┌──────────────────────────────────────────┐
        │ P6  reporting (needs P2 columns,         │
        │     P4 cashier, P5 override log)         │
        └────────────────────┬─────────────────────┘
                             ▼
        ┌──────────────────────────────────────────┐
        │ P7  heartbeat, terminal binding, receipts│
        └──────────────────────────────────────────┘
```

**Critical path:** P1 → P2 → P4 → P5 → P6. P3 can run parallel to P2 after P1 (different tables), and
P7 is independent once P6 lands.

### Cross-cutting dependencies — each of these breaks something if missed

| Dep | What it is | Where it bites |
|---|---|---|
| D-ADAPTER | `DatabaseAdapter` is a union of two concrete classes | Any signature added to one adapter and not the other breaks the typecheck at **every** call site. Both adapters, one commit, always. |
| D-MIGRATION | Paired SQLite/Postgres files per version | A missing counterpart passes local SQLite tests and fails only in the Postgres integration suite. |
| D-RBAC | `PERMISSION_RESOURCES` in two files (B6) | Adding `registers` to one only yields a UI control that always 403s. |
| D-DRAWER-INDEX | B2's global unique index | Must be dropped and recreated per-register **in the same transaction** or a concurrent open slips through. |
| D-TERMINAL | Global `squareDeviceId` / `cloverDeviceId` (B5) | Blocks any real multi-register card acceptance. P7 must land before physical rollout even though it is last in the plan. |
| D-AUDIT | `audit()` snapshots `before`/`after` wholesale | PIN hashes land in a readable table unless P4.5 redaction ships **with** the PIN columns, not after. |
| D-MONEY | Integer cents server-side, `DECIMAL(10,2)` at the boundary | Every new report aggregate. Per-register subtotals that each round independently will not sum to the unfiltered total. |
| D-ORG | `org_id` nullable and unfiltered everywhere (B7) | Registers must carry `org_id` for the day filtering is enforced, but must not depend on it now. |
| D-CI | CI runs only for PRs onto `main`/`develop` | Stacked phase PRs show no checks. Merge each phase before branching the next. |
| D-SEED | `backend/src/services/seeder.ts` | Must seed a location and register, or a fresh dev install has a POS that cannot ring. |
| D-SETUP | `backend/src/api/routes/setup.ts` (500 lines) | First-run wizard must create the first location + register, or a new install lands in the `pending` state with no way out. |

**No new runtime packages.** `bcryptjs`, `zod`, `jsonwebtoken`, `express-rate-limit` and
`better-sqlite3`/`pg` are all already dependencies and cover everything above.

---

## 7. Decisions — all resolved 2026-08-17

All five are **locked**. The schema in §3 reflects them. Do not re-open without a plan amendment.

| # | Question | Decision | Consequence in this plan |
|---|---|---|---|
| D1 | Is `locations` a real entity, or is address free text on the register? | **Real entity** | `locations` table in `015` (§3.2); registers carry `location_id` + free-text `placement`; per-site `timezone` drives report day boundaries (§2.1) |
| D2 | Device enrolment, or a register as a browser-selected label? | **Enrolled device** | Phase 3 is in scope: pairing codes, `register_credentials`, `registerAuth` middleware, heartbeat, real revocation (§2.3) |
| D3 | Is `register_number` unique per location or globally? | **Per location** | `idx_registers_loc_number` on `(location_id, register_number)`; cross-site ambiguity resolved by `display_code` (§3.1) |
| D4 | PIN length | **Six digits, minimum enforced** | `organizations.pin_length NOT NULL DEFAULT 6`, service rejects any value below 6; all Phase 4 fixtures are 6-digit (§2.5) |
| D5 | Register cap | **Configurable ceiling, in Phase 1** | `organizations.max_registers` (NULL = unlimited); `422 REGISTER_LIMIT_REACHED` past the cap; retired registers free a slot (Task 1.3 tests) |

**D4 note:** `pin_length` is a floor, not a fixed width — an org may raise it to 8, never lower it
below 6. Validate on write in `backend/src/services/pins.ts` and reject with a field error, so the
admin UI can render it against the input rather than as a toast.

**D5 note:** the cap counts registers in `pending` and `active` only. `disabled` still counts (the
device is expected back); `retired` does not. This is the distinction that keeps "we swapped a broken
till" from consuming a licence slot forever.

---

## 8. Effort

| Phase | Backend | Frontend | Tests | Notes |
|---|---|---|---|---|
| P1 Locations + registers | M | M | M | Foundation, low risk |
| P2 Attribution | M | S | L | **Highest risk** — index swap + adapter signatures |
| P3 Enrolment + revoke | M | M | L | Pattern already proven by `api_keys` |
| P4 PIN + shifts | L | L | XL | Security-critical; every §2.5 test required |
| P5 Override | M | M | L | Reuses P4's PIN verification |
| P6 Reporting | L | L | L | Widest surface, lowest risk |
| P7 Polish | S | M | M | Contains D-TERMINAL, needed before physical rollout |

Ship P1–P3 and you have a managed, revocable register estate with per-register sales and drawers —
which is most of what you asked for. P4–P5 add the staff-accountability layer. P6 is where the
reporting you described actually appears.
