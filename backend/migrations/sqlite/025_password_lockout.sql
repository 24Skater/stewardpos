-- Counterpart to the Postgres migration of the same number; see that file for
-- why password sign-in needed the lockout the PIN has had since 018.
--
-- `password_locked_until` is INTEGER here and TIMESTAMP there, matching how
-- `pin_locked_until` already differs between the two: SQLite stores epoch
-- milliseconds, Postgres a timestamp, and both adapters normalise to a number
-- on the way out.

ALTER TABLE users ADD COLUMN password_failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_locked_until INTEGER;

INSERT INTO schema_migrations (version, name) VALUES (25, '025_password_lockout');
