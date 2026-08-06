-- Add the orders, returns, and discounts permission resources.
--
-- SQLite counterpart of the Postgres migration of the same number; see that file
-- for why each role gets what it gets. `permissions` is TEXT holding JSON here,
-- so the merge uses json_patch() rather than Postgres's `||` — same semantics:
-- keys in the patch are added or replaced, everything else is left alone.

-- Admin: everything, matching the rest of its grants.
UPDATE roles
SET permissions = json_patch(permissions, json('{
      "orders":    {"read": true, "write": true, "delete": true},
      "returns":   {"read": true, "write": true, "delete": true},
      "discounts": {"read": true, "write": true, "delete": true}
    }'))
WHERE system_role = 'admin';

-- Supervisor: can ring and refund, cannot erase the record.
UPDATE roles
SET permissions = json_patch(permissions, json('{
      "orders":    {"read": true, "write": true, "delete": false},
      "returns":   {"read": true, "write": true, "delete": false},
      "discounts": {"read": true, "write": true, "delete": false}
    }'))
WHERE system_role = 'supervisor';

-- Reporter: read-only, consistent with its other grants.
UPDATE roles
SET permissions = json_patch(permissions, json('{
      "orders":    {"read": true, "write": false, "delete": false},
      "returns":   {"read": true, "write": false, "delete": false},
      "discounts": {"read": true, "write": false, "delete": false}
    }'))
WHERE system_role = 'reporter';

-- Standard: the cashier. Takes payments and applies configured discounts;
-- starting a return is a supervisor action. Also gains the reads the POS screen
-- needs — tax rate, branding, and enabled tenders live in settings, and a sale
-- can be attached to an existing customer.
UPDATE roles
SET permissions = json_patch(permissions, json('{
      "orders":    {"read": true, "write": true,  "delete": false},
      "returns":   {"read": true, "write": false, "delete": false},
      "discounts": {"read": true, "write": false, "delete": false},
      "settings":  {"read": true, "write": false, "delete": false},
      "services":  {"read": true, "write": false, "delete": false},
      "customers": {"read": true, "write": false, "delete": false}
    }'))
WHERE system_role = 'standard';

-- Custom roles: read-only on the new resources, since nobody chose to grant
-- write on something that did not exist when the role was created.
UPDATE roles
SET permissions = json_patch(permissions, json('{
      "orders":    {"read": true, "write": false, "delete": false},
      "returns":   {"read": true, "write": false, "delete": false},
      "discounts": {"read": true, "write": false, "delete": false}
    }'))
WHERE system_role IS NULL;

INSERT INTO schema_migrations (version, name) VALUES (8, '008_rbac_orders_permissions');
