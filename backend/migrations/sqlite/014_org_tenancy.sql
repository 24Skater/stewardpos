-- Counterpart to the Postgres migration of the same number; see that file for
-- why the columns are nullable and not yet filtered on.
--
-- SQLite has no ALTER TABLE ... ADD COLUMN IF NOT EXISTS and no DO block, so
-- these are written out. The migrator runs each file once, tracked in
-- schema_migrations, so re-running is not a concern.

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

INSERT OR IGNORE INTO organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization', 'default');

ALTER TABLE products ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_products_org ON products(org_id);
ALTER TABLE product_variants ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_product_variants_org ON product_variants(org_id);
ALTER TABLE orders ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_orders_org ON orders(org_id);
ALTER TABLE order_items ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_order_items_org ON order_items(org_id);
ALTER TABLE customers ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_customers_org ON customers(org_id);
ALTER TABLE services ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_services_org ON services(org_id);
ALTER TABLE quotes ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_quotes_org ON quotes(org_id);
ALTER TABLE quote_items ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_quote_items_org ON quote_items(org_id);
ALTER TABLE discount_types ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_discount_types_org ON discount_types(org_id);
ALTER TABLE promo_codes ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_promo_codes_org ON promo_codes(org_id);
ALTER TABLE returns ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_returns_org ON returns(org_id);
ALTER TABLE return_items ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_return_items_org ON return_items(org_id);
ALTER TABLE audit_logs ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(org_id);
ALTER TABLE roles ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_roles_org ON roles(org_id);
ALTER TABLE users ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
ALTER TABLE settings ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_settings_org ON settings(org_id);
ALTER TABLE categories ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_categories_org ON categories(org_id);
ALTER TABLE payments ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_payments_org ON payments(org_id);
ALTER TABLE store_credits ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_store_credits_org ON store_credits(org_id);
ALTER TABLE cash_drawer_sessions ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_org ON cash_drawer_sessions(org_id);

INSERT INTO schema_migrations (version, name) VALUES (14, '014_org_tenancy');
