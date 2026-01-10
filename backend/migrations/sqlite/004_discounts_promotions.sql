-- Migration: Discounts and Promotions System
-- Version: 4
-- SQLite version

-- ========================================
-- DISCOUNT TYPES TABLE (Quick Discounts)
-- ========================================
CREATE TABLE IF NOT EXISTS discount_types (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  description TEXT,
  code TEXT UNIQUE,
  discount_type TEXT NOT NULL,
  discount_value REAL NOT NULL,
  min_purchase REAL DEFAULT 0,
  max_discount REAL,
  applies_to TEXT DEFAULT 'all',
  applicable_ids TEXT, -- JSON array
  requires_approval INTEGER DEFAULT 0,
  approval_threshold REAL,
  requires_employee_id INTEGER DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  color TEXT DEFAULT 'gray',
  icon TEXT,
  show_in_pos INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- ========================================
-- PROMO CODES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS promo_codes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  discount_type TEXT NOT NULL,
  discount_value REAL NOT NULL,
  buy_quantity INTEGER,
  get_quantity INTEGER,
  get_product_id TEXT,
  min_purchase REAL DEFAULT 0,
  max_discount REAL,
  min_items INTEGER DEFAULT 0,
  applies_to TEXT DEFAULT 'all',
  applicable_ids TEXT, -- JSON array
  excluded_ids TEXT, -- JSON array
  first_order_only INTEGER DEFAULT 0,
  specific_customers TEXT, -- JSON array
  customer_groups TEXT, -- JSON array
  max_uses INTEGER,
  max_uses_per_customer INTEGER DEFAULT 1,
  current_uses INTEGER DEFAULT 0,
  starts_at INTEGER NOT NULL,
  expires_at INTEGER,
  stackable INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- ========================================
-- EMPLOYEE DISCOUNTS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS employee_discounts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) UNIQUE,
  discount_percentage REAL NOT NULL DEFAULT 10.00,
  max_discount_amount REAL,
  current_month_usage REAL DEFAULT 0,
  last_reset_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  requires_manager_approval_above REAL,
  allowed_categories TEXT, -- JSON array
  is_active INTEGER DEFAULT 1,
  approved_by TEXT REFERENCES users(id),
  approved_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- ========================================
-- DISCOUNT USAGE LOG
-- ========================================
CREATE TABLE IF NOT EXISTS discount_usage (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  order_id TEXT REFERENCES orders(id),
  quote_id TEXT REFERENCES quotes(id),
  discount_source TEXT NOT NULL,
  discount_type_id TEXT REFERENCES discount_types(id),
  promo_code_id TEXT REFERENCES promo_codes(id),
  employee_discount_id TEXT REFERENCES employee_discounts(id),
  discount_code TEXT,
  discount_name TEXT,
  discount_type TEXT,
  discount_value REAL,
  discount_amount REAL NOT NULL,
  manual_reason TEXT,
  customer_id TEXT REFERENCES customers(id),
  customer_email TEXT,
  requires_approval INTEGER DEFAULT 0,
  approved_by TEXT REFERENCES users(id),
  approval_status TEXT DEFAULT 'none',
  applied_by TEXT REFERENCES users(id),
  applied_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- ========================================
-- LOYALTY PROGRAM TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS loyalty_programs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  description TEXT,
  points_per_dollar REAL DEFAULT 1.00,
  points_redemption_rate REAL DEFAULT 100.00,
  min_points_redemption INTEGER DEFAULT 100,
  tiers TEXT DEFAULT '[]', -- JSON array
  excluded_categories TEXT, -- JSON array
  is_active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- ========================================
-- CUSTOMER LOYALTY POINTS
-- ========================================
CREATE TABLE IF NOT EXISTS customer_loyalty (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  program_id TEXT NOT NULL REFERENCES loyalty_programs(id),
  current_points INTEGER DEFAULT 0,
  lifetime_points INTEGER DEFAULT 0,
  current_tier TEXT DEFAULT 'standard',
  tier_achieved_at INTEGER,
  last_earn_at INTEGER,
  last_redeem_at INTEGER,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  UNIQUE(customer_id, program_id)
);

-- ========================================
-- LOYALTY POINTS TRANSACTIONS
-- ========================================
CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  customer_loyalty_id TEXT NOT NULL REFERENCES customer_loyalty(id),
  order_id TEXT REFERENCES orders(id),
  transaction_type TEXT NOT NULL,
  points INTEGER NOT NULL,
  description TEXT,
  order_total REAL,
  discount_amount REAL,
  processed_by TEXT REFERENCES users(id),
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- ========================================
-- INDEXES
-- ========================================
CREATE INDEX IF NOT EXISTS idx_discount_types_active ON discount_types(is_active);
CREATE INDEX IF NOT EXISTS idx_discount_types_code ON discount_types(code);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(is_active, starts_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_employee_discounts_user ON employee_discounts(user_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_order ON discount_usage(order_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_customer ON discount_usage(customer_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_promo ON discount_usage(promo_code_id);
CREATE INDEX IF NOT EXISTS idx_customer_loyalty_customer ON customer_loyalty(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_loyalty ON loyalty_transactions(customer_loyalty_id);

-- ========================================
-- SEED DEFAULT QUICK DISCOUNTS
-- ========================================
INSERT OR IGNORE INTO discount_types (id, name, description, code, discount_type, discount_value, color, icon, display_order) VALUES
  ('dt-senior', 'Senior Discount', '10% discount for customers 65+', 'SENIOR', 'percentage', 10.00, 'blue', 'user', 1),
  ('dt-military', 'Military Discount', '15% discount for active/veteran military', 'MILITARY', 'percentage', 15.00, 'green', 'shield', 2),
  ('dt-student', 'Student Discount', '10% discount with valid student ID', 'STUDENT', 'percentage', 10.00, 'purple', 'graduation-cap', 3),
  ('dt-firstresponder', 'First Responder', '10% discount for first responders', 'FIRST_RESPONDER', 'percentage', 10.00, 'red', 'heart', 4),
  ('dt-birthday', 'Birthday Discount', '20% discount on customer birthday', 'BIRTHDAY', 'percentage', 20.00, 'pink', 'cake', 5),
  ('dt-damaged', 'Damaged Item', 'Discount for damaged/display items', 'DAMAGED', 'percentage', 25.00, 'orange', 'alert-triangle', 6);

-- Insert migration record
INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (4, '004_discounts_promotions');

