-- Persona POS Initial Schema
-- SQLite Version
-- Migration: 001_initial_schema

-- Categories Table
CREATE TABLE categories (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL UNIQUE,
  icon TEXT
);

-- Products Table
CREATE TABLE products (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  base_price REAL NOT NULL,
  image TEXT,
  barcode TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Product Variants Table
CREATE TABLE product_variants (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size TEXT,
  color TEXT,
  price_override REAL,
  price_delta REAL,
  sku TEXT,
  barcode TEXT,
  stock INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER DEFAULT 1
);

-- Orders Table
CREATE TABLE orders (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  subtotal REAL NOT NULL,
  discount_total REAL DEFAULT 0,
  tax_total REAL DEFAULT 0,
  total REAL NOT NULL,
  payment_method TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT
);

-- Order Items Table
CREATE TABLE order_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  size TEXT,
  color TEXT,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  line_discount REAL DEFAULT 0,
  line_total REAL NOT NULL,
  notes TEXT
);

-- Customers Table
CREATE TABLE customers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  org TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT,
  notes TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Services Table
CREATE TABLE services (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  base_price REAL,
  unit_type TEXT DEFAULT 'flat',
  is_active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Users Table
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  last_login_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Roles Table
CREATE TABLE roles (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL UNIQUE,
  system_role TEXT,
  permissions TEXT NOT NULL
);

-- User Roles Junction Table (many-to-many)
CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Audit Logs Table
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  timestamp INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before TEXT,
  after TEXT
);

-- Quotes Table
CREATE TABLE quotes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  customer_id TEXT REFERENCES customers(id),
  status TEXT DEFAULT 'draft',
  subtotal REAL NOT NULL,
  tax_total REAL DEFAULT 0,
  total REAL NOT NULL,
  notes TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  expires_at INTEGER
);

-- Quote Items Table
CREATE TABLE quote_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  service_id TEXT REFERENCES services(id),
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL
);

-- Settings Table (single row)
CREATE TABLE settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  tax_rate_default REAL DEFAULT 0,
  store_name TEXT DEFAULT 'StewardPOS',
  store_email TEXT,
  store_phone TEXT,
  timezone TEXT DEFAULT 'UTC',
  logo_url TEXT,
  icon_url TEXT,
  brand_color TEXT,
  config TEXT
);

-- Migration Tracking Table
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Indexes for Performance
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_barcode ON products(barcode);
CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE INDEX idx_variants_barcode ON product_variants(barcode);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX idx_quotes_customer ON quotes(customer_id);
CREATE INDEX idx_quote_items_quote ON quote_items(quote_id);

-- Insert migration record
INSERT INTO schema_migrations (version, name) VALUES (1, '001_initial_schema');
