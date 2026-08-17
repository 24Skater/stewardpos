-- Counterpart to the Postgres migration of the same number; see that file for
-- why the backfill has to be per-organisation rather than pointed at the one
-- register 015 seeded.

-- Money-moving rows learn which till they came from. Before this, every
-- terminal in an install shared one undifferentiated stream, so a shop
-- running three registers had no way to attribute a sale, a return, a
-- payment, or a drawer session to the physical machine that produced it.
--
-- `cashier_user_id` / `override_by_user_id` are new and carry no history —
-- nobody recorded who rang a historical sale, so they stay NULL for
-- everything that predates this migration. `register_id` is different: every
-- historical row DID come out of some physical till, even though the
-- database never wrote down which one, so it gets backfilled below rather
-- than left NULL.
--
-- `shift_id` is a plain column, not a foreign key: `register_shifts` doesn't
-- exist yet and lands in a later migration. Adding an FK to a table that
-- isn't there would fail the migration outright.

ALTER TABLE orders ADD COLUMN register_id TEXT REFERENCES registers(id);
ALTER TABLE orders ADD COLUMN cashier_user_id TEXT REFERENCES users(id);
ALTER TABLE orders ADD COLUMN drawer_session_id TEXT REFERENCES cash_drawer_sessions(id);
ALTER TABLE orders ADD COLUMN override_by_user_id TEXT REFERENCES users(id);

ALTER TABLE returns ADD COLUMN register_id TEXT REFERENCES registers(id);
ALTER TABLE returns ADD COLUMN cashier_user_id TEXT REFERENCES users(id);
ALTER TABLE returns ADD COLUMN override_by_user_id TEXT REFERENCES users(id);

ALTER TABLE payments ADD COLUMN register_id TEXT REFERENCES registers(id);

ALTER TABLE cash_drawer_sessions ADD COLUMN register_id TEXT REFERENCES registers(id);
ALTER TABLE cash_drawer_sessions ADD COLUMN shift_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_register_created ON orders(register_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_cashier_created ON orders(cashier_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_returns_register_created ON returns(register_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_register ON payments(register_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_register ON cash_drawer_sessions(register_id);

-- Step 1: give every organisation without a location one of its own.
--
-- 015 already gave the default org a location ('main' / 00000000-…-a1), so
-- this NOT EXISTS is naturally a no-op for it — no need to special-case its
-- id here. Every *other* org, seeded before this migration existed, has had
-- no location at all, because `locations` didn't exist until 015 and 015
-- only backfilled the default org.
--
-- Ids are generated, never hardcoded — 015's fixed ids were fine for a
-- singleton seed row; this runs once per organisation on an unknown set of
-- orgs, so a fixed id would collide on the second row.
INSERT INTO locations (id, org_id, name, slug, timezone)
SELECT lower(hex(randomblob(16))), o.id, 'Main Location', 'main', 'UTC'
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.org_id = o.id);

-- Step 2: give every organisation without a register one, at its location.
--
-- "Its location" is whichever location that org has first (by creation
-- order) — either the one just created above, or one the org already had
-- from ordinary `createLocation` use before this migration ran. Guarded on
-- EXISTS rather than relying on the composite FK to fail loudly, same
-- reasoning as 015: neither INSERT OR IGNORE nor untargeted ON CONFLICT DO
-- NOTHING catches an FK violation, so a data anomaly here would otherwise
-- abort the whole migration and take the container down with it.
INSERT INTO registers (id, org_id, location_id, name, register_number, display_code, type, status)
SELECT
  lower(hex(randomblob(16))),
  o.id,
  (SELECT l.id FROM locations l WHERE l.org_id = o.id ORDER BY l.created_at ASC, l.id ASC LIMIT 1),
  'Register 1',
  1,
  (SELECT UPPER(l.slug) FROM locations l WHERE l.org_id = o.id ORDER BY l.created_at ASC, l.id ASC LIMIT 1) || '-01',
  'fixed',
  'active'
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM registers r WHERE r.org_id = o.id)
  AND EXISTS (SELECT 1 FROM locations l WHERE l.org_id = o.id);

-- Step 3: attribute every historical money-moving row to its org's
-- lowest-numbered register.
--
-- This is deliberately NOT the single register 015 seeded — that would
-- misattribute every other organisation's entire history to org A's till.
-- Every org is guaranteed a register by step 2 above (either pre-existing or
-- just created), so this always finds a match.
--
-- Rows whose org_id is NULL predate 014 (before multi-tenancy existed at
-- all) and belong to the default org.
UPDATE orders
SET register_id = (
  SELECT r.id FROM registers r
  WHERE r.org_id = COALESCE(orders.org_id, '00000000-0000-0000-0000-000000000001')
  ORDER BY r.register_number ASC, r.created_at ASC, r.id ASC
  LIMIT 1
)
WHERE register_id IS NULL;

UPDATE returns
SET register_id = (
  SELECT r.id FROM registers r
  WHERE r.org_id = COALESCE(returns.org_id, '00000000-0000-0000-0000-000000000001')
  ORDER BY r.register_number ASC, r.created_at ASC, r.id ASC
  LIMIT 1
)
WHERE register_id IS NULL;

UPDATE payments
SET register_id = (
  SELECT r.id FROM registers r
  WHERE r.org_id = COALESCE(payments.org_id, '00000000-0000-0000-0000-000000000001')
  ORDER BY r.register_number ASC, r.created_at ASC, r.id ASC
  LIMIT 1
)
WHERE register_id IS NULL;

UPDATE cash_drawer_sessions
SET register_id = (
  SELECT r.id FROM registers r
  WHERE r.org_id = COALESCE(cash_drawer_sessions.org_id, '00000000-0000-0000-0000-000000000001')
  ORDER BY r.register_number ASC, r.created_at ASC, r.id ASC
  LIMIT 1
)
WHERE register_id IS NULL;

-- Step 4: point any currently-open session's in-flight cash orders at it.
--
-- Once orders carry drawer_session_id, expected-cash math joins on it
-- directly instead of a time window (a later task). A closed session's
-- expected_cash was already computed and stored at close time, so it needs
-- nothing here. An open session has cash sales rung against it right now
-- that must not go orphaned, or the till's expected cash would silently drop
-- to just its opening float mid-shift.
--
-- The old global "one open drawer" constraint (still in force until the
-- index swap below) guarantees at most one open session exists at this
-- point, so there is no ambiguity about which session an in-flight cash
-- order belongs to.
UPDATE orders
SET drawer_session_id = (
  SELECT s.id FROM cash_drawer_sessions s
  WHERE s.status = 'open' AND orders.created_at >= s.opened_at
  ORDER BY s.opened_at DESC
  LIMIT 1
)
WHERE LOWER(payment_method) = 'cash'
  AND EXISTS (
    SELECT 1 FROM cash_drawer_sessions s
    WHERE s.status = 'open' AND orders.created_at >= s.opened_at
  );

-- Step 5: swap the one-open-drawer-globally constraint for one-open-drawer-
-- per-register. Must run after the register_id backfill above — a unique
-- index built while every row's register_id was still NULL would have
-- collapsed every session into one conflicting NULL group.
DROP INDEX IF EXISTS idx_drawer_one_open;
CREATE UNIQUE INDEX IF NOT EXISTS idx_drawer_one_open_per_register
  ON cash_drawer_sessions(register_id, status) WHERE status = 'open';

INSERT INTO schema_migrations (version, name) VALUES (16, '016_register_attribution');
