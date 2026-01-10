-- Migration: Returns and Refunds System
-- Version: 3
-- SQLite version

-- Returns Table
CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  original_order_id TEXT NOT NULL REFERENCES orders(id),
  return_number TEXT NOT NULL UNIQUE,
  return_type TEXT NOT NULL DEFAULT 'return',
  status TEXT NOT NULL DEFAULT 'pending',
  customer_email TEXT,
  customer_phone TEXT,
  customer_id TEXT REFERENCES customers(id),
  subtotal REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  refund_method TEXT,
  refund_status TEXT DEFAULT 'pending',
  refund_processed_at INTEGER,
  refund_reference TEXT,
  store_credit_amount REAL DEFAULT 0,
  store_credit_code TEXT,
  reason_code TEXT,
  reason_details TEXT,
  internal_notes TEXT,
  restock_items INTEGER DEFAULT 1,
  restocking_fee REAL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Return Items Table
CREATE TABLE IF NOT EXISTS return_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  return_id TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  original_order_item_id TEXT REFERENCES order_items(id),
  product_id TEXT NOT NULL,
  variant_id TEXT,
  name_snapshot TEXT NOT NULL,
  size TEXT,
  color TEXT,
  original_quantity INTEGER NOT NULL,
  return_quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL,
  condition TEXT DEFAULT 'good',
  restocked INTEGER DEFAULT 0,
  restocked_at INTEGER,
  notes TEXT
);

-- Refund Transactions Table
CREATE TABLE IF NOT EXISTS refund_transactions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  return_id TEXT REFERENCES returns(id),
  order_id TEXT REFERENCES orders(id),
  transaction_type TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  payment_method TEXT NOT NULL,
  processor_transaction_id TEXT,
  processor_response TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  failure_reason TEXT,
  processed_by TEXT REFERENCES users(id),
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  completed_at INTEGER
);

-- Store Credits Table
CREATE TABLE IF NOT EXISTS store_credits (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  customer_id TEXT REFERENCES customers(id),
  customer_email TEXT,
  return_id TEXT REFERENCES returns(id),
  code TEXT NOT NULL UNIQUE,
  original_amount REAL NOT NULL,
  remaining_amount REAL NOT NULL,
  status TEXT DEFAULT 'active',
  expires_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  used_at INTEGER,
  used_order_id TEXT REFERENCES orders(id)
);

-- Receipt Emails Log
CREATE TABLE IF NOT EXISTS receipt_emails (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  order_id TEXT REFERENCES orders(id),
  return_id TEXT REFERENCES returns(id),
  recipient_email TEXT NOT NULL,
  subject TEXT,
  receipt_type TEXT NOT NULL,
  status TEXT DEFAULT 'sent',
  error_message TEXT,
  sent_by TEXT REFERENCES users(id),
  sent_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(original_order_id);
CREATE INDEX IF NOT EXISTS idx_returns_customer ON returns(customer_id);
CREATE INDEX IF NOT EXISTS idx_returns_customer_email ON returns(customer_email);
CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);
CREATE INDEX IF NOT EXISTS idx_returns_created ON returns(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_number ON returns(return_number);
CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_return_items_product ON return_items(product_id);
CREATE INDEX IF NOT EXISTS idx_refund_transactions_return ON refund_transactions(return_id);
CREATE INDEX IF NOT EXISTS idx_refund_transactions_order ON refund_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_store_credits_customer ON store_credits(customer_id);
CREATE INDEX IF NOT EXISTS idx_store_credits_code ON store_credits(code);
CREATE INDEX IF NOT EXISTS idx_receipt_emails_order ON receipt_emails(order_id);

-- Insert migration record
INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (3, '003_returns_refunds');

