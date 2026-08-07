-- Tender breakdown for an order.
--
-- `orders.payment_method` is a single varchar, so a sale could only ever have
-- been paid one way. Split tender — $20 cash and the rest on a card, or a store
-- credit topped up with cash — had nowhere to be recorded, which also left
-- store credit unusable as a tender despite being issuable as a refund.
--
-- `orders.payment_method` stays as a denormalised summary so existing reads and
-- reports keep working; it holds the single method, or 'Split' when there are
-- several.

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  -- 'cash' | 'card' | 'store_credit' | 'zelle' | 'other'
  method VARCHAR(30) NOT NULL,
  -- The amount applied to the sale. For cash this is its share of the total, not
  -- what the customer handed over — the tendered amount and change live on the
  -- order.
  amount DECIMAL(10, 2) NOT NULL,

  -- A store credit code, a card transaction id, a Zelle confirmation.
  reference VARCHAR(255),

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(method);

INSERT INTO schema_migrations (version, name) VALUES (12, '012_payments')
ON CONFLICT (version) DO NOTHING;
