-- Feature switches and provider choices that later features read from one place.
-- Both default to '{}': every feature is off until an admin turns it on.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS providers JSONB NOT NULL DEFAULT '{}';

INSERT INTO schema_migrations (version, name) VALUES (29, '029_feature_settings')
ON CONFLICT (version) DO NOTHING;
