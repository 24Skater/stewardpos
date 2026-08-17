-- Registers.
--
-- StewardPOS has had no concept of a till: every terminal in a store shared
-- the same undifferentiated session state, so a shop running three registers
-- had no way to open, close, or report on them separately — and no way to
-- know which physical till a given sale came out of.
--
-- `locations` is a real entity (a site, with an address and a timezone) so a
-- multi-site org has somewhere for registers to belong to. `registers` are
-- children of a location, and `register_number` is unique per location, not
-- globally — "Register 1" can exist at two sites without collision.
-- `display_code` is the org-unique, human-readable identifier ('MAIN-01')
-- printed on receipts, so it carries its own uniqueness scoped to the org.
--
-- PIN length and register count are organization policy, not a fixed rule,
-- so they land as columns on `organizations` rather than a hardcoded floor —
-- `pin_length` defaults to 6, the floor the application enforces, and
-- `max_registers` defaults to NULL (unlimited) until an org opts into a cap.

-- Org-level policy. Lives on organizations rather than settings because both
-- are per-tenant and settings is already a wide single-row table.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_registers INTEGER;      -- NULL = unlimited
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pin_length INTEGER NOT NULL DEFAULT 6;

CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- NOT NULL, unlike the org_id 014 added elsewhere: those columns landed on
  -- already-populated tables, where NOT NULL would have failed the migration
  -- outright. `locations` is brand new and empty, and the backfill below
  -- supplies org_id on both seed rows, so that constraint doesn't apply here
  -- — and a nullable org_id would silence the uniqueness this table exists
  -- to enforce (see the composite FK on `registers` below).
  org_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  address TEXT, city VARCHAR(100), state VARCHAR(50), zip VARCHAR(20),
  timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  status VARCHAR(20) NOT NULL DEFAULT 'active',   -- active | retired
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Backs the composite FK on `registers(location_id, org_id)` below, so a
  -- register can never claim an org other than the one that owns its
  -- location.
  CONSTRAINT uq_locations_id_org UNIQUE (id, org_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_org_slug ON locations(org_id, slug);

CREATE TABLE IF NOT EXISTS registers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- NOT NULL for the same reason as `locations.org_id` above: this table is
  -- new and empty, and a nullable org_id would let two registers both hold
  -- org_id IS NULL — NULLs are distinct in a unique index, so
  -- idx_registers_display_code would not actually enforce org-uniqueness
  -- for exactly the rows the application creates.
  org_id UUID NOT NULL REFERENCES organizations(id),
  location_id UUID NOT NULL REFERENCES locations(id),
  name VARCHAR(255) NOT NULL,                       -- 'Coffee Shop 1'
  register_number INTEGER NOT NULL,                 -- unique within location
  display_code VARCHAR(50) NOT NULL,                -- 'MAIN-01', 'CHURCH-COFFEE-01' — <location slug>-<zero-padded number>
  placement VARCHAR(255),                           -- '1st floor coffee shop'
  type VARCHAR(20) NOT NULL DEFAULT 'fixed',        -- fixed | mobile | web | kiosk
  has_cash_drawer BOOLEAN NOT NULL DEFAULT TRUE,
  accepts_cash BOOLEAN NOT NULL DEFAULT TRUE,
  can_refund BOOLEAN NOT NULL DEFAULT TRUE,
  can_open_drawer_no_sale BOOLEAN NOT NULL DEFAULT FALSE,
  require_sign_in BOOLEAN NOT NULL DEFAULT FALSE,
  idle_lock_seconds INTEGER NOT NULL DEFAULT 300,
  terminal_provider VARCHAR(30),                    -- null | square | clover | stripe
  terminal_device_id VARCHAR(255),                  -- per-register reader binding
  status VARCHAR(20) NOT NULL DEFAULT 'pending',    -- pending | active | disabled | retired
  -- TIMESTAMPTZ, unlike created_at/updated_at below: this is a heartbeat
  -- compared against "now" to decide whether a till is online. A naive
  -- TIMESTAMP comes back to Node as a value parsed in the process's local
  -- timezone, so if the app container and the database disagree, a live
  -- register would read as hours stale and show offline.
  last_seen_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
-- neither untargeted ON CONFLICT DO NOTHING nor INSERT OR IGNORE (SQLite
-- side) catches a foreign key violation, so on a database whose default org
-- row is missing, this insert would otherwise abort migration 015 outright
-- and the container would not boot.
INSERT INTO locations (id, org_id, name, slug, timezone)
SELECT '00000000-0000-0000-0000-0000000000a1',
       '00000000-0000-0000-0000-000000000001',
       'Main Location', 'main', 'UTC'
WHERE EXISTS (SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- Also guarded on the location existing: the composite FK means this insert
-- fails outright if the location row above didn't land.
INSERT INTO registers
  (id, org_id, location_id, name, register_number, display_code, type, status)
SELECT '00000000-0000-0000-0000-0000000000b1',
       '00000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-0000000000a1',
       'Register 1', 1, 'MAIN-01', 'fixed', 'active'
WHERE EXISTS (SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001')
  AND EXISTS (SELECT 1 FROM locations WHERE id = '00000000-0000-0000-0000-0000000000a1')
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations (version, name) VALUES (15, '015_registers')
ON CONFLICT (version) DO NOTHING;
