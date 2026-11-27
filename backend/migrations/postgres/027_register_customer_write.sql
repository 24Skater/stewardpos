-- The register can create customers, so a cashier can add one mid-sale instead
-- of leaving the till for the admin screen. Delete stays with admins.
UPDATE roles
SET permissions = permissions || jsonb_build_object(
      'customers', jsonb_build_object('read', true, 'write', true, 'delete', false)
    )
WHERE system_role = 'standard';

INSERT INTO schema_migrations (version, name) VALUES (27, '027_register_customer_write')
ON CONFLICT (version) DO NOTHING;
