-- Counterpart to the Postgres migration of the same number; see that file for
-- why registers belong to a location and why numbering is scoped per-location.

-- Org-level policy. Lives on organizations rather than settings because both
-- are per-tenant and settings is already a wide single-row table.
ALTER TABLE organizations ADD COLUMN max_registers INTEGER;      -- NULL = unlimited
ALTER TABLE organizations ADD COLUMN pin_length INTEGER NOT NULL DEFAULT 6;

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  -- NOT NULL, unlike the org_id 014 added elsewhere: those columns landed on
  -- already-populated tables, where NOT NULL would have failed the migration
  -- outright. `locations` is brand new and empty, and the backfill below
  -- supplies org_id on both seed rows, so that constraint doesn't apply here
  -- — and a nullable org_id would silence the uniqueness this table exists
  -- to enforce (see the composite FK on `registers` below).
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  address TEXT, city TEXT, state TEXT, zip TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'active',   -- active | retired
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  -- Backs the composite FK on `registers(location_id, org_id)` below, so a
  -- register can never claim an org other than the one that owns its
  -- location.
  UNIQUE (id, org_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_org_slug ON locations(org_id, slug);

CREATE TABLE IF NOT EXISTS registers (
  id TEXT PRIMARY KEY,
  -- NOT NULL for the same reason as `locations.org_id` above: this table is
  -- new and empty, and a nullable org_id would let two registers both hold
  -- org_id IS NULL — NULLs are distinct in a unique index, so
  -- idx_registers_display_code would not actually enforce org-uniqueness
  -- for exactly the rows the application creates.
  org_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,                       -- 'Coffee Shop 1'
  register_number INTEGER NOT NULL,         -- unique within location
  display_code TEXT NOT NULL,               -- 'MAIN-01', 'CHURCH-COFFEE-01' — <location slug>-<zero-padded number>
  placement TEXT,                           -- '1st floor coffee shop'
  type TEXT NOT NULL DEFAULT 'fixed',       -- fixed | mobile | web | kiosk
  has_cash_drawer INTEGER NOT NULL DEFAULT 1,
  accepts_cash INTEGER NOT NULL DEFAULT 1,
  can_refund INTEGER NOT NULL DEFAULT 1,
  can_open_drawer_no_sale INTEGER NOT NULL DEFAULT 0,
  require_sign_in INTEGER NOT NULL DEFAULT 0,
  idle_lock_seconds INTEGER NOT NULL DEFAULT 300,
  terminal_provider TEXT,                   -- null | square | clover | stripe
  terminal_device_id TEXT,                  -- per-register reader binding
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | active | disabled | retired
  last_seen_at INTEGER,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  -- A register's org must match its location's org. Independent FKs would
  -- let a register claim org B while sitting at a location owned by org A —
  -- leaking org A's location address/city/state/zip into org B's register
  -- list, and making display_code's org-scoped uniqueness meaningless
  -- because it would be scoped to an org the register doesn't operate in.
  FOREIGN KEY (location_id, org_id) REFERENCES locations(id, org_id)
);
-- A retired register's number and display_code are never released for
-- reuse: an old receipt must always resolve to the physical till that
-- printed it, even after that till is decommissioned. A store whose till
-- dies will want to call the replacement "Register 1" again — it can't;
-- it gets the next number instead. This is a deliberate decision, not an
-- oversight, so a future "cleanup" doesn't relax it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_registers_loc_number
  ON registers(location_id, register_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_registers_display_code
  ON registers(org_id, display_code);
CREATE INDEX IF NOT EXISTS idx_registers_status ON registers(status);

-- Backfill: one location and one register so existing history is attributable
-- rather than landing in an unlabelled bucket in every report.
--
-- Guarded with WHERE EXISTS rather than relying on the FK to fail loudly:
-- neither INSERT OR IGNORE nor untargeted ON CONFLICT DO NOTHING (Postgres
-- side) catches a foreign key violation, so on a database whose default org
-- row is missing, this insert would otherwise abort migration 015 outright
-- and the container would not boot.
INSERT OR IGNORE INTO locations (id, org_id, name, slug, timezone)
SELECT '00000000-0000-0000-0000-0000000000a1',
       '00000000-0000-0000-0000-000000000001',
       'Main Location', 'main', 'UTC'
WHERE EXISTS (SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001');

-- Also guarded on the location existing: the composite FK means this insert
-- fails outright if the location row above didn't land.
INSERT OR IGNORE INTO registers
  (id, org_id, location_id, name, register_number, display_code, type, status)
SELECT '00000000-0000-0000-0000-0000000000b1',
       '00000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-0000000000a1',
       'Register 1', 1, 'MAIN-01', 'fixed', 'active'
WHERE EXISTS (SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001')
  AND EXISTS (SELECT 1 FROM locations WHERE id = '00000000-0000-0000-0000-0000000000a1');

INSERT INTO schema_migrations (version, name) VALUES (15, '015_registers');
