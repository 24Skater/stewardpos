-- Per-account lockout for password sign-in.
--
-- A cashier's PIN has had this since migration 018: five wrong guesses and the
-- account stops answering for fifteen minutes. A password had nothing. The only
-- thing standing in front of `POST /api/auth/login` was `loginLimiter`, which
-- counts per IP — so an attacker with a few hundred addresses had, in effect,
-- unlimited attempts against any single account, while the six-digit PIN next
-- to it was properly defended.
--
-- That asymmetry was backwards in one specific way. Until the password policy
-- landed, `POST /api/admin/users` accepted six characters, so accounts created
-- under the old rule may still hold passwords no better than the PIN — with
-- none of the PIN's protection.
--
-- Mirrors `pin_failed_count` / `pin_locked_until` deliberately, down to the
-- column shapes, so the two lockouts read the same and `services/pins.ts`
-- stays the reference implementation for both.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_locked_until TIMESTAMP;

INSERT INTO schema_migrations (version, name) VALUES (25, '025_password_lockout')
ON CONFLICT (version) DO NOTHING;
