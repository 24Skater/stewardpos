-- Migration: Returns and Refunds System
-- Version: 3
-- Best practices: Full audit trail, flexible refund types, stock restoration tracking

-- Returns Table (tracks the return transaction)
CREATE TABLE returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Link to original order
  original_order_id UUID NOT NULL REFERENCES orders(id),
  
  -- Return metadata
  return_number VARCHAR(50) NOT NULL UNIQUE,
  return_type VARCHAR(20) NOT NULL DEFAULT 'return', -- 'return', 'exchange', 'void'
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'completed', 'rejected'
  
  -- Customer info (copied from order for reference)
  customer_email VARCHAR(255),
  customer_phone VARCHAR(50),
  customer_id UUID REFERENCES customers(id),
  
  -- Financial summary
  subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0,
  tax_total DECIMAL(10, 2) NOT NULL DEFAULT 0,
  total DECIMAL(10, 2) NOT NULL DEFAULT 0,
  
  -- Refund details
  refund_method VARCHAR(50), -- 'original_payment', 'store_credit', 'cash', 'card'
  refund_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processed', 'failed'
  refund_processed_at TIMESTAMP,
  refund_reference VARCHAR(255), -- External refund transaction ID
  
  -- Store credit (if applicable)
  store_credit_amount DECIMAL(10, 2) DEFAULT 0,
  store_credit_code VARCHAR(50),
  
  -- Reason and notes
  reason_code VARCHAR(50), -- 'defective', 'wrong_item', 'not_needed', 'damaged', 'other'
  reason_details TEXT,
  internal_notes TEXT,
  
  -- Stock handling
  restock_items BOOLEAN DEFAULT true,
  restocking_fee DECIMAL(10, 2) DEFAULT 0,
  
  -- Audit trail
  created_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Return Items Table (individual items being returned)
CREATE TABLE return_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_id UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  
  -- Link to original order item
  original_order_item_id UUID REFERENCES order_items(id),
  product_id UUID NOT NULL,
  variant_id UUID,
  
  -- Item details (snapshot from order)
  name_snapshot VARCHAR(255) NOT NULL,
  size VARCHAR(50),
  color VARCHAR(50),
  
  -- Quantities
  original_quantity INTEGER NOT NULL, -- How many were ordered
  return_quantity INTEGER NOT NULL, -- How many being returned
  
  -- Pricing
  unit_price DECIMAL(10, 2) NOT NULL,
  line_total DECIMAL(10, 2) NOT NULL,
  
  -- Item condition
  condition VARCHAR(20) DEFAULT 'good', -- 'good', 'damaged', 'defective', 'opened'
  
  -- Stock handling for this item
  restocked BOOLEAN DEFAULT false,
  restocked_at TIMESTAMP,
  
  -- Notes
  notes TEXT
);

-- Refund Transactions Table (tracks actual money movement)
CREATE TABLE refund_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_id UUID REFERENCES returns(id),
  order_id UUID REFERENCES orders(id),
  
  -- Transaction type
  transaction_type VARCHAR(20) NOT NULL, -- 'full_refund', 'partial_refund', 'void', 'store_credit'
  
  -- Amount
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  
  -- Payment processor info
  payment_method VARCHAR(50) NOT NULL,
  processor_transaction_id VARCHAR(255),
  processor_response TEXT,
  
  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'reversed'
  failure_reason TEXT,
  
  -- Audit
  processed_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- Store Credits Table
CREATE TABLE store_credits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Link to customer or return
  customer_id UUID REFERENCES customers(id),
  customer_email VARCHAR(255),
  return_id UUID REFERENCES returns(id),
  
  -- Credit details
  code VARCHAR(50) NOT NULL UNIQUE,
  original_amount DECIMAL(10, 2) NOT NULL,
  remaining_amount DECIMAL(10, 2) NOT NULL,
  
  -- Status and validity
  status VARCHAR(20) DEFAULT 'active', -- 'active', 'used', 'expired', 'cancelled'
  expires_at TIMESTAMP,
  
  -- Audit
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMP,
  used_order_id UUID REFERENCES orders(id)
);

-- Receipt Emails Log (track sent receipts for resend functionality)
CREATE TABLE receipt_emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Link to order or return
  order_id UUID REFERENCES orders(id),
  return_id UUID REFERENCES returns(id),
  
  -- Email details
  recipient_email VARCHAR(255) NOT NULL,
  subject VARCHAR(255),
  receipt_type VARCHAR(20) NOT NULL, -- 'sale', 'return', 'refund', 'void'
  
  -- Status
  status VARCHAR(20) DEFAULT 'sent', -- 'sent', 'failed', 'bounced'
  error_message TEXT,
  
  -- Audit
  sent_by UUID REFERENCES users(id),
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_returns_order ON returns(original_order_id);
CREATE INDEX idx_returns_customer ON returns(customer_id);
CREATE INDEX idx_returns_customer_email ON returns(customer_email);
CREATE INDEX idx_returns_status ON returns(status);
CREATE INDEX idx_returns_created ON returns(created_at DESC);
CREATE INDEX idx_returns_number ON returns(return_number);
CREATE INDEX idx_return_items_return ON return_items(return_id);
CREATE INDEX idx_return_items_product ON return_items(product_id);
CREATE INDEX idx_refund_transactions_return ON refund_transactions(return_id);
CREATE INDEX idx_refund_transactions_order ON refund_transactions(order_id);
CREATE INDEX idx_store_credits_customer ON store_credits(customer_id);
CREATE INDEX idx_store_credits_code ON store_credits(code);
CREATE INDEX idx_receipt_emails_order ON receipt_emails(order_id);

-- Insert migration record
INSERT INTO schema_migrations (version, name) VALUES (3, '003_returns_refunds')
ON CONFLICT (version) DO NOTHING;

