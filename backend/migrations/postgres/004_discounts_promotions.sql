-- Migration: Discounts and Promotions System
-- Version: 4
-- Features: Promo codes, quick discounts, employee discounts, loyalty programs

-- ========================================
-- DISCOUNT TYPES TABLE (Quick Discounts)
-- ========================================
CREATE TABLE discount_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Basic info
  name VARCHAR(100) NOT NULL,
  description TEXT,
  code VARCHAR(50) UNIQUE, -- Internal code like SENIOR, MILITARY, EMPLOYEE
  
  -- Discount value
  discount_type VARCHAR(20) NOT NULL, -- 'percentage', 'fixed', 'buy_x_get_y'
  discount_value DECIMAL(10, 2) NOT NULL, -- Percentage (0-100) or fixed amount
  
  -- Conditions
  min_purchase DECIMAL(10, 2) DEFAULT 0,
  max_discount DECIMAL(10, 2), -- Cap for percentage discounts
  
  -- Applicability
  applies_to VARCHAR(20) DEFAULT 'all', -- 'all', 'products', 'services', 'categories'
  applicable_ids TEXT[], -- Array of product/service/category IDs
  
  -- Restrictions
  requires_approval BOOLEAN DEFAULT false,
  approval_threshold DECIMAL(10, 2), -- Amount above which approval is needed
  requires_employee_id BOOLEAN DEFAULT false,
  
  -- Display
  display_order INTEGER DEFAULT 0,
  color VARCHAR(20) DEFAULT 'gray', -- For UI display
  icon VARCHAR(50),
  show_in_pos BOOLEAN DEFAULT true,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Audit
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- PROMO CODES TABLE
-- ========================================
CREATE TABLE promo_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Code info
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  
  -- Discount value
  discount_type VARCHAR(20) NOT NULL, -- 'percentage', 'fixed', 'free_shipping', 'buy_x_get_y', 'free_item'
  discount_value DECIMAL(10, 2) NOT NULL,
  
  -- Buy X Get Y specific
  buy_quantity INTEGER,
  get_quantity INTEGER,
  get_product_id UUID,
  
  -- Conditions
  min_purchase DECIMAL(10, 2) DEFAULT 0,
  max_discount DECIMAL(10, 2), -- Cap for percentage discounts
  min_items INTEGER DEFAULT 0, -- Minimum items in cart
  
  -- Applicability
  applies_to VARCHAR(20) DEFAULT 'all', -- 'all', 'products', 'services', 'categories', 'specific_items'
  applicable_ids TEXT[],
  excluded_ids TEXT[], -- Excluded products/categories
  
  -- Customer restrictions
  first_order_only BOOLEAN DEFAULT false,
  specific_customers TEXT[], -- Customer IDs who can use
  customer_groups TEXT[], -- VIP, wholesale, etc.
  
  -- Usage limits
  max_uses INTEGER, -- Total uses allowed
  max_uses_per_customer INTEGER DEFAULT 1,
  current_uses INTEGER DEFAULT 0,
  
  -- Validity
  starts_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP,
  
  -- Stacking rules
  stackable BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 0, -- Higher priority applied first
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Tracking
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- EMPLOYEE DISCOUNTS TABLE
-- ========================================
CREATE TABLE employee_discounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Employee link
  user_id UUID NOT NULL REFERENCES users(id),
  
  -- Discount settings
  discount_percentage DECIMAL(5, 2) NOT NULL DEFAULT 10.00, -- e.g., 10%
  max_discount_amount DECIMAL(10, 2), -- Monthly cap
  
  -- Usage tracking
  current_month_usage DECIMAL(10, 2) DEFAULT 0,
  last_reset_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Restrictions
  requires_manager_approval_above DECIMAL(10, 2), -- Amount needing approval
  allowed_categories TEXT[], -- Empty = all categories
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Audit
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(user_id)
);

-- ========================================
-- DISCOUNT USAGE LOG (Audit Trail)
-- ========================================
CREATE TABLE discount_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Link to order
  order_id UUID REFERENCES orders(id),
  quote_id UUID REFERENCES quotes(id),
  
  -- Discount details
  discount_source VARCHAR(50) NOT NULL, -- 'promo_code', 'quick_discount', 'employee', 'manual', 'loyalty'
  discount_type_id UUID REFERENCES discount_types(id),
  promo_code_id UUID REFERENCES promo_codes(id),
  employee_discount_id UUID REFERENCES employee_discounts(id),
  
  -- Discount info
  discount_code VARCHAR(100),
  discount_name VARCHAR(255),
  discount_type VARCHAR(20), -- 'percentage', 'fixed'
  discount_value DECIMAL(10, 2),
  discount_amount DECIMAL(10, 2) NOT NULL, -- Actual amount discounted
  
  -- Manual discount specific
  manual_reason TEXT,
  
  -- Customer info
  customer_id UUID REFERENCES customers(id),
  customer_email VARCHAR(255),
  
  -- Approval
  requires_approval BOOLEAN DEFAULT false,
  approved_by UUID REFERENCES users(id),
  approval_status VARCHAR(20) DEFAULT 'none', -- 'none', 'pending', 'approved', 'rejected'
  
  -- Applied by
  applied_by UUID REFERENCES users(id),
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- LOYALTY PROGRAM TABLE
-- ========================================
CREATE TABLE loyalty_programs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Program info
  name VARCHAR(100) NOT NULL,
  description TEXT,
  
  -- Points settings
  points_per_dollar DECIMAL(5, 2) DEFAULT 1.00, -- Points earned per $1 spent
  points_redemption_rate DECIMAL(5, 2) DEFAULT 100.00, -- Points needed for $1 discount
  min_points_redemption INTEGER DEFAULT 100, -- Minimum points to redeem
  
  -- Tiers (stored as JSON)
  tiers JSONB DEFAULT '[]'::jsonb, -- [{name: "Gold", minPoints: 1000, multiplier: 1.5}]
  
  -- Restrictions
  excluded_categories TEXT[],
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Audit
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- CUSTOMER LOYALTY POINTS
-- ========================================
CREATE TABLE customer_loyalty (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Links
  customer_id UUID NOT NULL REFERENCES customers(id),
  program_id UUID NOT NULL REFERENCES loyalty_programs(id),
  
  -- Points
  current_points INTEGER DEFAULT 0,
  lifetime_points INTEGER DEFAULT 0,
  
  -- Tier
  current_tier VARCHAR(50) DEFAULT 'standard',
  tier_achieved_at TIMESTAMP,
  
  -- Tracking
  last_earn_at TIMESTAMP,
  last_redeem_at TIMESTAMP,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Audit
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(customer_id, program_id)
);

-- ========================================
-- LOYALTY POINTS TRANSACTIONS
-- ========================================
CREATE TABLE loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Links
  customer_loyalty_id UUID NOT NULL REFERENCES customer_loyalty(id),
  order_id UUID REFERENCES orders(id),
  
  -- Transaction
  transaction_type VARCHAR(20) NOT NULL, -- 'earn', 'redeem', 'adjust', 'expire'
  points INTEGER NOT NULL, -- Positive for earn, negative for redeem
  
  -- Details
  description TEXT,
  order_total DECIMAL(10, 2),
  
  -- Applied discount (for redemptions)
  discount_amount DECIMAL(10, 2),
  
  -- Audit
  processed_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- INDEXES
-- ========================================
CREATE INDEX idx_discount_types_active ON discount_types(is_active);
CREATE INDEX idx_discount_types_code ON discount_types(code);
CREATE INDEX idx_promo_codes_code ON promo_codes(code);
CREATE INDEX idx_promo_codes_active ON promo_codes(is_active, starts_at, expires_at);
CREATE INDEX idx_employee_discounts_user ON employee_discounts(user_id);
CREATE INDEX idx_discount_usage_order ON discount_usage(order_id);
CREATE INDEX idx_discount_usage_customer ON discount_usage(customer_id);
CREATE INDEX idx_discount_usage_promo ON discount_usage(promo_code_id);
CREATE INDEX idx_customer_loyalty_customer ON customer_loyalty(customer_id);
CREATE INDEX idx_loyalty_transactions_loyalty ON loyalty_transactions(customer_loyalty_id);

-- ========================================
-- SEED DEFAULT QUICK DISCOUNTS
-- ========================================
INSERT INTO discount_types (name, description, code, discount_type, discount_value, color, icon, display_order) VALUES
  ('Senior Discount', '10% discount for customers 65+', 'SENIOR', 'percentage', 10.00, 'blue', 'user', 1),
  ('Military Discount', '15% discount for active/veteran military', 'MILITARY', 'percentage', 15.00, 'green', 'shield', 2),
  ('Student Discount', '10% discount with valid student ID', 'STUDENT', 'percentage', 10.00, 'purple', 'graduation-cap', 3),
  ('First Responder', '10% discount for first responders', 'FIRST_RESPONDER', 'percentage', 10.00, 'red', 'heart', 4),
  ('Birthday Discount', '20% discount on customer birthday', 'BIRTHDAY', 'percentage', 20.00, 'pink', 'cake', 5),
  ('Damaged Item', 'Discount for damaged/display items', 'DAMAGED', 'percentage', 25.00, 'orange', 'alert-triangle', 6);

-- Insert migration record
INSERT INTO schema_migrations (version, name) VALUES (4, '004_discounts_promotions')
ON CONFLICT (version) DO NOTHING;

