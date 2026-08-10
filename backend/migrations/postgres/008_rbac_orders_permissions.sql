-- Add the orders, returns, and discounts permission resources.
--
-- The RBAC model covered inventory, reports, exports, settings, users, services,
-- and customers, but nothing for the register's own surface — so orders,
-- receipts, returns, and terminal could only be authenticated, never authorised.
--
-- `permissions` is JSONB, so no column changes: this backfills existing role
-- rows so they carry the new keys with values matching what each system role is
-- meant to be able to do. Roles created by the seeder already include them.
--
-- Custom roles (system_role IS NULL) get read-only on the new resources: they
-- were created before these existed, so granting write would hand out an ability
-- nobody chose to give them.

-- Admin: everything, matching the rest of its grants.
UPDATE roles
SET permissions = permissions || jsonb_build_object(
      'orders',    jsonb_build_object('read', true, 'write', true, 'delete', true),
      'returns',   jsonb_build_object('read', true, 'write', true, 'delete', true),
      'discounts', jsonb_build_object('read', true, 'write', true, 'delete', true)
    )
WHERE system_role = 'admin';

-- Supervisor: can ring and refund, cannot erase the record.
UPDATE roles
SET permissions = permissions || jsonb_build_object(
      'orders',    jsonb_build_object('read', true, 'write', true, 'delete', false),
      'returns',   jsonb_build_object('read', true, 'write', true, 'delete', false),
      'discounts', jsonb_build_object('read', true, 'write', true, 'delete', false)
    )
WHERE system_role = 'supervisor';

-- Reporter: read-only, consistent with its other grants.
UPDATE roles
SET permissions = permissions || jsonb_build_object(
      'orders',    jsonb_build_object('read', true, 'write', false, 'delete', false),
      'returns',   jsonb_build_object('read', true, 'write', false, 'delete', false),
      'discounts', jsonb_build_object('read', true, 'write', false, 'delete', false)
    )
WHERE system_role = 'reporter';

-- Standard: the cashier. Takes payments and applies the discounts the store has
-- configured; starting a return is a supervisor action.
UPDATE roles
SET permissions = permissions || jsonb_build_object(
      'orders',    jsonb_build_object('read', true, 'write', true,  'delete', false),
      'returns',   jsonb_build_object('read', true, 'write', false, 'delete', false),
      'discounts', jsonb_build_object('read', true, 'write', false, 'delete', false)
    )
WHERE system_role = 'standard';

-- Custom roles: read-only on the new resources.
UPDATE roles
SET permissions = permissions || jsonb_build_object(
      'orders',    jsonb_build_object('read', true, 'write', false, 'delete', false),
      'returns',   jsonb_build_object('read', true, 'write', false, 'delete', false),
      'discounts', jsonb_build_object('read', true, 'write', false, 'delete', false)
    )
WHERE system_role IS NULL;

-- The same backfill also brings the register's role up to what the POS screen
-- reads: tax rate, branding, and enabled tenders all live in settings, and a
-- sale can be attached to an existing customer.
UPDATE roles
SET permissions = permissions || jsonb_build_object(
      'settings',  jsonb_build_object('read', true, 'write', false, 'delete', false),
      'services',  jsonb_build_object('read', true, 'write', false, 'delete', false),
      'customers', jsonb_build_object('read', true, 'write', false, 'delete', false)
    )
WHERE system_role = 'standard';

INSERT INTO schema_migrations (version, name) VALUES (8, '008_rbac_orders_permissions')
ON CONFLICT (version) DO NOTHING;
