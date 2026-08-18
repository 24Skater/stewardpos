-- Register shifts: which employee is standing at which till, right now.
--
-- Migration 016 gave every order a `cashier_user_id`, but filled it with the
-- authenticated *user* — whoever logged this browser in, possibly hours ago and
-- possibly not the person ringing the sale. On a shared terminal that is not
-- attribution, it is a guess, so "track employee sales" was fiction.
--
-- A shift is the missing fact: cashier U is working register R from time T.
-- It is opened by entering a PIN and closed by signing out or going idle. It is
-- deliberately NOT a session — see the PIN columns below.
--
-- Timestamps are TIMESTAMP, never BIGINT: `pg` returns int8 as a string, and
-- the adapters convert with `new Date(row.x).getTime()`, which yields
-- Invalid Date on a string of digits.

-- PINs live on `users` rather than in their own table: a PIN is an attribute of
-- an employee, not a thing an employee has many of.
--
-- A PIN is a weak secret — six digits, typed in public, on a screen other people
-- can see. It is bcrypt-hashed like a password, and it authorises a *shift*, not
-- a session: it never mints a JWT. The device is already authenticated by its
-- register credential (migration 017); the PIN only says who is standing there.
--
-- `pin_failed_count` / `pin_locked_until` implement lockout. Without it a
-- six-digit space is a few hours of brute force against an endpoint that, by
-- design, anyone standing at the till can reach.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_set_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMP;

-- Unused until manager override lands in the next phase. Added here rather than
-- in its own migration because it belongs to the same idea as the PIN — only a
-- PIN holder can be asked to approve something — and because a second ALTER
-- against `users` next phase would be churn for no benefit.
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_override BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS register_shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- NOT NULL because it leads the partial unique index below. NULLs are
  -- distinct from one another in a unique index, so a nullable register_id
  -- would let a register hold unlimited "open" shifts — the exact thing that
  -- index exists to forbid.
  register_id UUID NOT NULL REFERENCES registers(id),
  user_id UUID NOT NULL REFERENCES users(id),

  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Idle timeout is measured from here, NOT from started_at. Measured from the
  -- start, a busy six-hour shift would be force-ended five minutes in, mid-sale.
  -- Every authenticated action on this register bumps it.
  last_activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  ended_at TIMESTAMP,
  -- signed_out | idle_timeout | superseded | revoked | forced
  --
  -- 'superseded' is the common real-world case, not an edge case: the previous
  -- cashier walked away without signing out and the next one signed on.
  end_reason VARCHAR(20),

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- At most one open shift per register: two would make "who rang this sale"
-- unanswerable, which is the whole point of the table.
CREATE UNIQUE INDEX IF NOT EXISTS idx_register_shifts_one_open_per_register
  ON register_shifts (register_id)
  WHERE ended_at IS NULL;

-- Per-employee reporting reads this way round.
CREATE INDEX IF NOT EXISTS idx_register_shifts_user ON register_shifts (user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_register_shifts_register ON register_shifts (register_id, started_at);

INSERT INTO schema_migrations (version, name) VALUES (18, '018_register_shifts')
ON CONFLICT (version) DO NOTHING;
