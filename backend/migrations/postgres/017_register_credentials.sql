-- Register credentials: pairing codes and the device tokens they mint.
--
-- Phase 2 (migration 016) let a request attribute itself to a register via
-- `X-Register-Id` — but that header is an unverified claim. Any authenticated
-- browser can send any register id, so "revoke a register" meant nothing: the
-- next browser just named it again. This migration gives a register a real,
-- destroyable credential, following the same prefix + bcrypt-hash pattern as
-- `api_keys` (migration 002): a short plainly-stored prefix for lookup, a
-- bcrypt hash for verification, and the secret shown to the caller exactly
-- once.
--
-- A row starts life as a short-lived, single-use pairing code
-- (`pairing_code_*`); redeeming it mints a long-lived device token
-- (`token_*`) on the SAME row, so a register's credential history — one
-- pairing code, one token, until revoked — reads as a single lifecycle
-- rather than two tables that have to agree with each other.
--
-- `token_prefix` / `token_hash` are nullable: a freshly issued pairing code
-- has no token yet, only after `redeemPairingCode` fills them in.
--
-- Timestamps are TIMESTAMP, never BIGINT: `pg` returns int8 as a string, and
-- the adapters convert with `new Date(row.x).getTime()`, which yields
-- Invalid Date on a string of digits — this has bitten this project before.
--
-- `register_id` is NOT NULL — required by the partial unique index below:
-- NULLs are distinct from one another in a Postgres unique index, so a
-- nullable `register_id` would silently let every register share unlimited
-- "live" credentials, which is the exact bug this table exists to prevent.

CREATE TABLE IF NOT EXISTS register_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  register_id UUID NOT NULL REFERENCES registers(id),

  -- The short, human-typeable code an operator reads off one screen and
  -- types into another to pair a device. Single-use: `enrolled_at` below
  -- marks it spent.
  pairing_code_prefix VARCHAR(16) NOT NULL,
  pairing_code_hash VARCHAR(255) NOT NULL,
  pairing_expires_at TIMESTAMP NOT NULL,

  -- Minted when the pairing code is redeemed. NULL until then.
  token_prefix VARCHAR(16),
  token_hash VARCHAR(255),
  enrolled_at TIMESTAMP,
  last_used_at TIMESTAMP,

  -- Destroying the credential, not deleting the row: an audit trail of who
  -- revoked a device and why must survive the revocation itself.
  revoked_at TIMESTAMP,
  revoked_by UUID REFERENCES users(id),
  revoke_reason TEXT,

  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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
--
-- No CONCURRENTLY: the migrator sends each file as one multi-statement
-- string over the simple query protocol, which Postgres itself wraps in an
-- implicit transaction, and CONCURRENTLY cannot run inside one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_register_credentials_one_live_per_register
  ON register_credentials(register_id) WHERE revoked_at IS NULL;

INSERT INTO schema_migrations (version, name) VALUES (17, '017_register_credentials')
ON CONFLICT (version) DO NOTHING;
