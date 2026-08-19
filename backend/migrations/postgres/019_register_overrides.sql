-- Manager override: a supervisor authorising one privileged action at a till.
--
-- A cashier hits a rule that says no — a discount past its approval threshold,
-- a drawer closing short, a void. Today the only answer is to log the cashier
-- out and log a supervisor in, which loses the cart and attributes the sale to
-- the wrong person. An override is the alternative: a supervisor enters their
-- PIN, authorises exactly that one action, and walks away. The cashier's shift
-- is never touched.
--
-- The grant is deliberately narrow. It names one action, expires in ninety
-- seconds, and is consumed once. A grant that could be reused, or reused for a
-- different action than it was issued for, is just a second login with extra
-- steps — and the whole point is that it is NOT a session.
--
-- One row serves as both the grant and the audit record, so a grant that was
-- requested and never used still leaves a trace. That is deliberate: a
-- supervisor being asked to approve something repeatedly and declining is a
-- signal worth being able to see.
--
-- Timestamps are TIMESTAMP, never BIGINT: `pg` returns int8 as a string, and
-- the adapters convert with `new Date(row.x).getTime()`, which yields
-- Invalid Date on a string of digits.

-- Above this, a drawer closing short needs a supervisor. NULL disables the
-- check. Lives on organizations because it is store policy, not a property of
-- any one till.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS drawer_variance_threshold DECIMAL(10, 2);

CREATE TABLE IF NOT EXISTS register_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- NOT NULL because it leads the lookup below and because an override that
  -- cannot be tied to a till is not an audit record, it is a rumour.
  register_id UUID NOT NULL REFERENCES registers(id),
  shift_id UUID REFERENCES register_shifts(id),

  -- Who approved, and who was standing there asking. Both matter: the point of
  -- the record is that two different people were involved.
  approver_user_id UUID NOT NULL REFERENCES users(id),
  requested_by_user_id UUID REFERENCES users(id),

  -- discount_approval | drawer_variance | void | no_sale
  --
  -- The grant is checked against this on consume. A grant issued for one action
  -- and spent on another would let "approve this discount" become "approve this
  -- void", which is the failure that makes narrow grants worth having.
  action VARCHAR(40) NOT NULL,

  -- The grant secret, hashed. Same prefix-plus-bcrypt shape as api_keys and
  -- register_credentials: a short prefix stored plainly for lookup, the hash
  -- for verification, the secret itself returned to the caller exactly once.
  grant_prefix VARCHAR(32) NOT NULL,
  grant_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP,

  -- Filled in when the grant is spent, so the row says what was actually done
  -- rather than only what was permitted.
  entity VARCHAR(40),
  entity_id VARCHAR(64),
  before_value TEXT,
  after_value TEXT,
  reason TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_register_overrides_prefix ON register_overrides (grant_prefix);
CREATE INDEX IF NOT EXISTS idx_register_overrides_register ON register_overrides (register_id, created_at);
CREATE INDEX IF NOT EXISTS idx_register_overrides_approver ON register_overrides (approver_user_id, created_at);

INSERT INTO schema_migrations (version, name) VALUES (19, '019_register_overrides')
ON CONFLICT (version) DO NOTHING;
