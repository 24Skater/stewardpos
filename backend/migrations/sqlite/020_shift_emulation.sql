-- Counterpart to the Postgres migration of the same number; see that file for
-- why this column records intent without ever becoming the attributed identity.

ALTER TABLE register_shifts ADD COLUMN emulated_user_id TEXT REFERENCES users(id);

INSERT INTO schema_migrations (version, name) VALUES (20, '020_shift_emulation');
