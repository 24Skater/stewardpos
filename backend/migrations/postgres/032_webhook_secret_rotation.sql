-- After a rotation the old secret keeps signing until it expires, so a receiver
-- can switch over without dropping events.
ALTER TABLE webhook_subscriptions
  ADD COLUMN IF NOT EXISTS secret_prev_enc TEXT,
  ADD COLUMN IF NOT EXISTS secret_prev_expires_at TIMESTAMPTZ;

INSERT INTO schema_migrations (version, name) VALUES (32, '032_webhook_secret_rotation')
ON CONFLICT (version) DO NOTHING;
