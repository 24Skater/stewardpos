-- Persona POS Initial Schema
-- PostgreSQL Version
-- Migration: 001_initial_schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Categories Table
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  icon VARCHAR(50)
);

-- Products Table
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(255) NOT NULL,
  base_price DECIMAL(10, 2) NOT NULL,
  image TEXT,
  barcode VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Product Variants Table
CREATE TABLE product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size VARCHAR(50),
  color VARCHAR(50),
  price_override DECIMAL(10, 2),
  price_delta DECIMAL(10, 2),
  sku VARCHAR(100),
  barcode VARCHAR(100),
  stock INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN DEFAULT true
);

-- Orders Table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  subtotal DECIMAL(10, 2) NOT NULL,
  discount_total DECIMAL(10, 2) DEFAULT 0,
  tax_total DECIMAL(10, 2) DEFAULT 0,
  total DECIMAL(10, 2) NOT NULL,
  payment_method VARCHAR(50) NOT NULL,
  customer_email VARCHAR(255),
  customer_phone VARCHAR(50)
);

-- Order Items Table
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  variant_id UUID NOT NULL,
  name_snapshot VARCHAR(255) NOT NULL,
  size VARCHAR(50),
  color VARCHAR(50),
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  line_discount DECIMAL(10, 2) DEFAULT 0,
  line_total DECIMAL(10, 2) NOT NULL,
  notes TEXT
);

-- Customers Table
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  org VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(50),
  zip VARCHAR(20),
  country VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Services Table
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(255) NOT NULL,
  description TEXT,
  base_price DECIMAL(10, 2),
  unit_type VARCHAR(50) DEFAULT 'flat',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users Table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Roles Table
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  system_role VARCHAR(50),
  permissions JSONB NOT NULL
);

-- User Roles Junction Table (many-to-many)
CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Audit Logs Table
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  entity VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  before JSONB,
  after JSONB
);

-- Quotes Table
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id),
  status VARCHAR(50) DEFAULT 'draft',
  subtotal DECIMAL(10, 2) NOT NULL,
  tax_total DECIMAL(10, 2) DEFAULT 0,
  total DECIMAL(10, 2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP
);

-- Quote Items Table
CREATE TABLE quote_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id),
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(10, 2) NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  line_total DECIMAL(10, 2) NOT NULL
);

-- Settings Table (single row)
CREATE TABLE settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  tax_rate_default DECIMAL(5, 4) DEFAULT 0,
  store_name VARCHAR(255) DEFAULT 'My Store',
  store_email VARCHAR(255),
  store_phone VARCHAR(50),
  timezone VARCHAR(100) DEFAULT 'UTC',
  logo_url TEXT,
  icon_url TEXT,
  brand_color VARCHAR(7),
  config JSONB,
  CONSTRAINT single_row CHECK (id = 1)
);

-- Migration Tracking Table
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
