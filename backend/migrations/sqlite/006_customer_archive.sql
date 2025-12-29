-- Migration: Customer Archive Table
-- Creates an archive table for soft-deleted customers

-- Create archived_customers table (mirrors customers table structure)
CREATE TABLE IF NOT EXISTS archived_customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    organization TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    country TEXT,
    notes TEXT,
    created_at TEXT,
    updated_at TEXT,
    archived_at TEXT DEFAULT CURRENT_TIMESTAMP,
    archived_by TEXT REFERENCES users(id),
    archive_reason TEXT
);

-- Create indexes for searching archived customers
CREATE INDEX IF NOT EXISTS idx_archived_customers_email ON archived_customers(email);
CREATE INDEX IF NOT EXISTS idx_archived_customers_name ON archived_customers(name);
CREATE INDEX IF NOT EXISTS idx_archived_customers_archived_at ON archived_customers(archived_at);

-- Create archived_quotes table for quotes associated with archived customers
CREATE TABLE IF NOT EXISTS archived_quotes (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    quote_number TEXT,
    status TEXT,
    items TEXT,
    subtotal REAL,
    tax REAL,
    total REAL,
    notes TEXT,
    valid_until TEXT,
    created_at TEXT,
    updated_at TEXT,
    created_by TEXT,
    archived_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_archived_quotes_customer_id ON archived_quotes(customer_id);

-- Create archived_orders table for orders associated with archived customers
CREATE TABLE IF NOT EXISTS archived_orders (
    id TEXT PRIMARY KEY,
    customer_id TEXT,
    order_number TEXT,
    status TEXT,
    items TEXT,
    subtotal REAL,
    tax REAL,
    discount REAL,
    total REAL,
    payment_method TEXT,
    notes TEXT,
    created_at TEXT,
    updated_at TEXT,
    created_by TEXT,
    archived_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_archived_orders_customer_id ON archived_orders(customer_id);

-- Record migration
INSERT INTO schema_migrations (version, name) VALUES (6, '006_customer_archive');

