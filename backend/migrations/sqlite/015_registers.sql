-- Counterpart to the Postgres migration of the same number; see that file for
-- why registers belong to a location and why numbering is scoped per-location.

-- Org-level policy. Lives on organizations rather than settings because both
-- are per-tenant and settings is already a wide single-row table.
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
  terminal_device_id TEXT,                  -- per-register reader binding
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
