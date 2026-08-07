-- Multi-tenant foundation.
--
-- Every install today is one shop. This adds the structure a second one would
-- need — an `organizations` table and a nullable `org_id` on the tables that
-- belong to a tenant — without changing any behaviour.
--
-- The columns are deliberately NULLABLE and deliberately not yet filtered on.
-- Adding the column is reversible and free; making every query org-scoped is
-- neither, and on a single-org install it is unverifiable: the correct and the
-- broken version return identical results until a second org exists. So the
-- shape lands now and the scoping lands per-table, with tests, when there is
-- something to test it against. See docs/guides/multi-tenant.md.

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  -- Unique because it is what an org-scoped login would resolve against.
  slug VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The org every existing row implicitly belongs to. Fixed id rather than a
-- generated one so the application can fall back to it without a lookup, and so
-- this migration is idempotent across environments.
INSERT INTO organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization', 'default')
ON CONFLICT (id) DO NOTHING;

-- Tenant-scoped tables. `settings` is included even though it stays a single
-- row for v1: adding the column later means another migration on a live table,
-- and the column costs nothing while unused.
DO $$
DECLARE
  target TEXT;
  tenant_tables TEXT[] := ARRAY[
    'products', 'product_variants', 'orders', 'order_items', 'customers',
    'services', 'quotes', 'quote_items', 'discount_types', 'promo_codes',
    'returns', 'return_items', 'audit_logs', 'roles', 'users', 'settings',
    'categories', 'payments', 'store_credits', 'cash_drawer_sessions'
  ];
BEGIN
  FOREACH target IN ARRAY tenant_tables LOOP
    -- Skip rather than fail: the table list is shared with SQLite, and a
    -- deployment that predates one of these tables should still migrate.
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = target) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id)', target);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_org ON %I(org_id)', target, target);
    END IF;
  END LOOP;
END $$;

INSERT INTO schema_migrations (version, name) VALUES (14, '014_org_tenancy')
ON CONFLICT (version) DO NOTHING;
