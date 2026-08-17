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
  org_id UUID REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  address TEXT, city VARCHAR(100), state VARCHAR(50), zip VARCHAR(20),
  timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  status VARCHAR(20) NOT NULL DEFAULT 'active',   -- active | retired
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_org_slug ON locations(org_id, slug);

CREATE TABLE IF NOT EXISTS registers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organizations(id),
  location_id UUID NOT NULL REFERENCES locations(id),
  name VARCHAR(255) NOT NULL,                       -- 'Coffee Shop 1'
  register_number INTEGER NOT NULL,                 -- unique within location
  display_code VARCHAR(50) NOT NULL,                -- 'CHR-COF-01'
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
  last_seen_at TIMESTAMP,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_registers_loc_number
  ON registers(location_id, register_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_registers_display_code
  ON registers(org_id, display_code);
CREATE INDEX IF NOT EXISTS idx_registers_status ON registers(status);
CREATE INDEX IF NOT EXISTS idx_registers_location ON registers(location_id);

-- Backfill: one location and one register so existing history is attributable
-- rather than landing in an unlabelled bucket in every report.
INSERT INTO locations (id, org_id, name, slug, timezone)
VALUES ('00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-000000000001',
        'Main Location', 'main', 'UTC')
ON CONFLICT (id) DO NOTHING;

INSERT INTO registers
  (id, org_id, location_id, name, register_number, display_code, type, status)
VALUES ('00000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a1',
        'Register 1', 1, 'MAIN-01', 'fixed', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO schema_migrations (version, name) VALUES (15, '015_registers')
ON CONFLICT (version) DO NOTHING;
