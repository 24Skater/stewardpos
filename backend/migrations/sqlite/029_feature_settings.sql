-- Feature switches and provider choices that later features read from one place.
-- Both default to '{}': every feature is off until an admin turns it on.
ALTER TABLE settings ADD COLUMN features TEXT NOT NULL DEFAULT '{}';
ALTER TABLE settings ADD COLUMN providers TEXT NOT NULL DEFAULT '{}';

INSERT INTO schema_migrations (version, name) VALUES (29, '029_feature_settings');
