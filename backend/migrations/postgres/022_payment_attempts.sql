-- What the till was trying to charge, recorded before the card is presented.
--
-- Until now the amount put on a card came from the browser: the register
-- computed a total and posted it to /api/terminal/charge, which validated only
-- that it was a positive integer. Nothing tied that figure to a sale the server
-- had priced, so a modified client could pay $1 for a $100 cart and still
-- produce a well-formed order.
--
-- The other half of the same gap: the order was created only *after* the card
-- was approved. If that request never landed — dropped wifi, a closed tab, a
-- restarted server — the customer had paid and StewardPOS held no record of it
-- at all, findable only by reading the Stripe dashboard.
--
-- A row here is created before the charge and carries the server's own priced
-- amount, so the browser never names a price. Its id travels in the
-- PaymentIntent's metadata and doubles as the idempotency key, which makes the
-- link navigable in both directions: from a Stripe payout back to a sale, and
-- from an approved charge forward to the order it should have produced.
--
-- Deliberately NOT an order in a pending state. Creating the order first would
-- mean an unpaid sale holding stock, a store credit redeemed before the card
-- was charged, and a one-time discount override already burned — each needing a
-- compensating reversal on abandonment. `createOrder` stays one atomic
-- transaction that runs once, when the money is real.

CREATE TABLE IF NOT EXISTS payment_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Nullable and unfiltered, matching every other tenant column: see 014.
  org_id UUID,

  -- Who was taking the money. A charge with no order is a question someone has
  -- to answer, and these are how it reaches the right till and the right person.
  register_id UUID REFERENCES registers(id),
  cashier_user_id UUID REFERENCES users(id),
  shift_id UUID REFERENCES register_shifts(id),

  -- The server's own figure, in minor units, because that is what a processor
  -- bills in. This is the number that goes to the card.
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',

  provider VARCHAR(30) NOT NULL,
  -- The processor's id for the payment; `pi_...` on Stripe. Null until the
  -- charge has actually been created.
  charge_id VARCHAR(255),

  -- pending    — priced and recorded, card not yet presented
  -- authorized — the processor approved it; the order does not exist yet
  -- completed  — an order was created and linked
  -- failed     — declined, or the charge could not be started
  -- cancelled  — abandoned deliberately at the till
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  failure_reason TEXT,

  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,

  -- The priced cart as it stood. Without it, an `authorized` row with no order
  -- says a card was charged $40 and nothing about what for, which is not enough
  -- for anyone to finish or refund the sale.
  cart_snapshot JSONB
);

-- The reconciliation question — "what did we charge and never record?" — is a
-- scan for authorized rows with no order, so it gets the index.
CREATE INDEX IF NOT EXISTS idx_payment_attempts_unreconciled
  ON payment_attempts(status, created_at)
  WHERE order_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_charge_id
  ON payment_attempts(charge_id);

INSERT INTO schema_migrations (version, name) VALUES (22, '022_payment_attempts')
ON CONFLICT (version) DO NOTHING;
