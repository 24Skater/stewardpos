-- Step 1 of the multi-tenant plan: make `org_id` mandatory.
--
-- Migration 014 added a nullable `org_id` to twenty tenant-scoped tables and
-- deliberately stopped there. This is the next step, and it does three things
-- per table, in an order that matters:
--
--   1. backfill every NULL to the default organization
--   2. give the column that same value as its DEFAULT
--   3. make the column NOT NULL
--
-- ## Why the DEFAULT is not optional
--
-- Not one of the forty-four INSERT statements in the two adapters names
-- `org_id`. Skipping step 2 therefore does not "tighten" anything - it stops
-- the application writing at all:
--
--     ERROR:  null value in column "org_id" of relation "customers"
--             violates not-null constraint
--
-- That is a shop that cannot take a sale. The guide used to recommend exactly
-- that, describing it as a no-op; see docs/guides/multi-tenant.md, and
-- `adapters/db/__tests__/orgIdWriteCoverage.test.ts`, which fails the build if a
-- future migration reintroduces the constraint without a default behind it.
--
-- ## What this buys today: nothing, and that is the point
--
-- On a single-org install the DEFAULT satisfies the constraint on every write,
-- so behaviour is bit-for-bit identical before and after. That is what makes it
-- safe to land now, ahead of the scoping work, rather than as part of it.
--
-- What it buys is structural. Once writes actually set `org_id` (step 3) the
-- DEFAULT comes off, and from that moment a query that forgets the column fails
-- immediately instead of silently writing a row into the wrong tenant - which is
-- the failure that is invisible until it is catastrophic.
--
-- ## Reversibility
--
-- Fully reversible while the DEFAULT is in place:
--
--     ALTER TABLE <t> ALTER COLUMN org_id DROP NOT NULL;
--     ALTER TABLE <t> ALTER COLUMN org_id DROP DEFAULT;
--
-- No data is lost by either; the backfilled values stay, and they were always
-- what a NULL meant.
--
-- ## Locking
--
-- `SET NOT NULL` takes an ACCESS EXCLUSIVE lock and, before Postgres 12, scanned
-- the whole table to verify. On 12+ the scan is skipped when an existing CHECK
-- proves the column non-null, which we do not have - so it does scan. At the row
-- counts a single shop reaches this is milliseconds, but it is worth knowing
-- before running it against a large install: take it during a quiet period.

DO $$
DECLARE
  target TEXT;
  -- Deliberately the same list as migration 014, in the same order. If the two
  -- ever disagree, a table has an org_id that nothing requires - which is the
  -- state this migration exists to end.
  tenant_tables TEXT[] := ARRAY[
    'products', 'product_variants', 'orders', 'order_items', 'customers',
    'services', 'quotes', 'quote_items', 'discount_types', 'promo_codes',
    'returns', 'return_items', 'audit_logs', 'roles', 'users', 'settings',
    'categories', 'payments', 'store_credits', 'cash_drawer_sessions'
  ];
BEGIN
  FOREACH target IN ARRAY tenant_tables LOOP
    -- Skip rather than fail, matching 014: the list is shared with SQLite, and
    -- an install predating one of these tables should still migrate.
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = target) THEN

      EXECUTE format(
        'UPDATE %I SET org_id = ''00000000-0000-0000-0000-000000000001'' WHERE org_id IS NULL',
        target
      );

      -- Before the constraint, never after. Between the two statements every
      -- existing row is already backfilled, so there is no window in which a
      -- write could fail.
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN org_id SET DEFAULT ''00000000-0000-0000-0000-000000000001''',
        target
      );

      EXECUTE format('ALTER TABLE %I ALTER COLUMN org_id SET NOT NULL', target);
    END IF;
  END LOOP;
END $$;

INSERT INTO schema_migrations (version, name) VALUES (26, '026_org_id_required')
ON CONFLICT (version) DO NOTHING;
