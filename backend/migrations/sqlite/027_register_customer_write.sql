-- The register can create customers, so a cashier can add one mid-sale instead
-- of leaving the till for the admin screen. Delete stays with admins.
UPDATE roles
SET permissions = json_patch(permissions, json('{
      "customers": {"read": true, "write": true, "delete": false}
    }'))
WHERE system_role = 'standard';

INSERT INTO schema_migrations (version, name) VALUES (27, '027_register_customer_write');
