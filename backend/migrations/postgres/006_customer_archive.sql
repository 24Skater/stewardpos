-- Migration: Customer Archive Table
-- Creates an archive table for soft-deleted customers

-- Create archived_customers table (mirrors customers table structure)
CREATE TABLE IF NOT EXISTS archived_customers (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    organization VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    zip VARCHAR(20),
    country VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    archived_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    archived_by UUID REFERENCES users(id),
    archive_reason TEXT
);

-- Create index for searching archived customers
CREATE INDEX idx_archived_customers_email ON archived_customers(email);
CREATE INDEX idx_archived_customers_name ON archived_customers(name);
CREATE INDEX idx_archived_customers_archived_at ON archived_customers(archived_at);

-- Create archived_quotes table for quotes associated with archived customers
CREATE TABLE IF NOT EXISTS archived_quotes (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL,
    quote_number VARCHAR(50),
    status VARCHAR(50),
    items JSONB,
    subtotal DECIMAL(10, 2),
    tax DECIMAL(10, 2),
    total DECIMAL(10, 2),
    notes TEXT,
    valid_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    created_by UUID,
    archived_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_archived_quotes_customer_id ON archived_quotes(customer_id);

-- Create archived_orders table for orders associated with archived customers
CREATE TABLE IF NOT EXISTS archived_orders (
    id UUID PRIMARY KEY,
    customer_id UUID,
    order_number VARCHAR(50),
    status VARCHAR(50),
    items JSONB,
    subtotal DECIMAL(10, 2),
    tax DECIMAL(10, 2),
    discount DECIMAL(10, 2),
    total DECIMAL(10, 2),
    payment_method VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    created_by UUID,
    archived_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_archived_orders_customer_id ON archived_orders(customer_id);

-- Record migration
INSERT INTO schema_migrations (version, name) VALUES (6, '006_customer_archive');

