-- Widen `api_keys.key_prefix`.
--
-- The column was VARCHAR(8), but `generateApiKey` produces `spk_` followed by
-- eight hex characters — twelve in all. Every attempt to create an API key
-- therefore failed with "value too long for type character varying(8)", which
-- means the feature has never worked: the management UI could list and revoke
-- keys, but no key ever existed to list.
--
-- 32 leaves room for a longer scheme prefix later without a second migration.

ALTER TABLE api_keys ALTER COLUMN key_prefix TYPE VARCHAR(32);

INSERT INTO schema_migrations (version, name) VALUES (9, '009_api_key_prefix_length')
ON CONFLICT (version) DO NOTHING;
