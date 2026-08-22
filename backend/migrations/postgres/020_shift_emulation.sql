-- Who an admin was standing in for, when they assumed a till.
--
-- An admin can open any register from a back-office browser to cover a break or
-- reproduce what a cashier sees. The sale is still attributed to the ADMIN via
-- user_id: sales-by-cashier, drawer-variance-by-register and no-sale-counts all
-- exist to answer "who was standing at this till", and an admin able to file
-- sales under someone else's name would make all three unable to settle the
-- disputes they were built for.
--
-- This column records the intent, so the audit trail shows whose shift was being
-- covered, without ever becoming the attributed identity. NULL on every ordinary
-- shift, which is all of them today.
ALTER TABLE register_shifts
  ADD COLUMN emulated_user_id UUID REFERENCES users(id);

COMMENT ON COLUMN register_shifts.emulated_user_id IS
  'Cashier an admin was standing in for. Never the attributed identity: see user_id.';

INSERT INTO schema_migrations (version, name) VALUES (20, '020_shift_emulation')
ON CONFLICT (version) DO NOTHING;
