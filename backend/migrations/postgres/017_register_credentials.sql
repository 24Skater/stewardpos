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
-- `register_id` is NOT NULL — required by the partial unique indexes below:
-- NULLs are distinct from one another in a Postgres unique index, so a
-- nullable `register_id` would silently let every register share unlimited
-- "live" credentials, which is the exact bug those indexes exist to prevent.

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
-- No CONCURRENTLY on either: the migrator sends each file as one
-- multi-statement string over the simple query protocol, which Postgres
-- itself wraps in an implicit transaction, and CONCURRENTLY cannot run
-- inside one.

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

INSERT INTO schema_migrations (version, name) VALUES (17, '017_register_credentials')
ON CONFLICT (version) DO NOTHING;
