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
-- `register_id` is NOT NULL — required by the partial unique index below:
-- NULLs are distinct from one another in a unique index, so a nullable
-- `register_id` would silently let every register share unlimited "live"
-- credentials, which is the exact bug this table exists to prevent.
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

-- A register may have at most one LIVE (unrevoked) credential at a time —
-- whether that credential is still an unredeemed pairing code or an
-- enrolled device's active token. Issuing a fresh pairing code therefore has
-- to revoke any prior live credential first, or this insert collides; that
-- collision is deliberate, not a bug to work around, because a lost pairing
-- code — or a device being re-paired — should replace the old credential,
-- not accumulate a second live one beside it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_register_credentials_one_live_per_register
  ON register_credentials(register_id) WHERE revoked_at IS NULL;

INSERT INTO schema_migrations (version, name) VALUES (17, '017_register_credentials');
