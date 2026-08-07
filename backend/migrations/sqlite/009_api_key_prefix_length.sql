-- Counterpart to the Postgres migration of the same number.
--
-- SQLite does not enforce VARCHAR lengths, so key creation already worked here;
-- this exists to keep the two schemas in step and the version numbers aligned.
-- No column change is possible or needed.

INSERT INTO schema_migrations (version, name) VALUES (9, '009_api_key_prefix_length');
