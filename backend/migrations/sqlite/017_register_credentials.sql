-- Counterpart to the Postgres migration of the same number; see that file for
-- why a register needs a destroyable credential at all.

-- Register credentials: pairing codes and the device tokens they mint.
--
-- `X-Register-Id` (migration 016) is a claim, not proof — any authenticated
-- browser can send any register id, so "revoke a register" meant nothing:
-- the next browser just named it again. This table gives a register a real
-- credential that can be destroyed. A row starts life as a short-lived,
-- single-use pairing code (`pairing_code_*`); redeeming it mints a
-- long-lived device token (`token_*`) on the SAME row, so a register's
-- credential history — one pairing code, one token, until revoked — reads
-- as a single lifecycle rather than two tables that have to agree.
--
-- `token_prefix` / `token_hash` are nullable: a freshly issued pairing code
-- has no token yet, only after `redeemPairingCode` fills them in.
--
-- `register_id` is NOT NULL — required by the partial unique indexes below:
-- NULLs are distinct from one another in a unique index, so a nullable
-- `register_id` would silently let every register share unlimited "live"
-- credentials, which is the exact bug those indexes exist to prevent.
CREATE TABLE IF NOT EXISTS register_credentials (
  id TEXT PRIMARY KEY,
  register_id TEXT NOT NULL REFERENCES registers(id),

  -- The short, human-typeable code an operator reads off one screen and
  -- types into another to pair a device. Single-use: `enrolled_at` below
  -- marks it spent.
  pairing_code_prefix TEXT NOT NULL,
  pairing_code_hash TEXT NOT NULL,
  pairing_expires_at INTEGER NOT NULL,

  -- Minted when the pairing code is redeemed. NULL until then.
  token_prefix TEXT,
  token_hash TEXT,
  enrolled_at INTEGER,
  last_used_at INTEGER,

  -- Destroying the credential, not deleting the row: an audit trail of who
  -- revoked a device and why must survive the revocation itself.
  revoked_at INTEGER,
  revoked_by TEXT REFERENCES users(id),
  revoke_reason TEXT,

  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_register_credentials_pairing_prefix
  ON register_credentials(pairing_code_prefix);
CREATE INDEX IF NOT EXISTS idx_register_credentials_token_prefix
  ON register_credentials(token_prefix);
CREATE INDEX IF NOT EXISTS idx_register_credentials_register
  ON register_credentials(register_id);

-- Two separate partial unique indexes, not one covering both "kinds" of live
-- row (unredeemed pairing code vs. enrolled device token) — a single
-- `WHERE revoked_at IS NULL` index would forbid a pending pairing row from
-- ever coexisting with a live token, which is exactly the case that matters:
-- generating a fresh code for a register that is CURRENTLY TRADING must not
-- collide with, and therefore must not force revoking, the token that
-- register is trading on. Issuing a code is not destructive; only redeeming
-- one is — see `services/registerEnrolment.ts` for where the actual
-- hand-over (revoke the old enrolled credential, mint the new one) happens.
--
-- At most one unredeemed pairing code per register. Issuing a second
-- (before the first is redeemed) revokes the first — a lost or unwanted
-- code should be replaceable — but this never touches an enrolled token.
CREATE UNIQUE INDEX IF NOT EXISTS idx_register_credentials_one_pairing_per_register
  ON register_credentials(register_id) WHERE revoked_at IS NULL AND token_hash IS NULL;

-- At most one enrolled (redeemed) credential per register. Redemption is
-- the one moment a register's device identity actually changes hands, so
-- it is the one place the OLD enrolled credential gets revoked — atomically
-- with minting the new token, not sooner.
CREATE UNIQUE INDEX IF NOT EXISTS idx_register_credentials_one_enrolled_per_register
  ON register_credentials(register_id) WHERE revoked_at IS NULL AND token_hash IS NOT NULL;

INSERT INTO schema_migrations (version, name) VALUES (17, '017_register_credentials');
