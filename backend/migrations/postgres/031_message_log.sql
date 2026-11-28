-- One row per outbound message attempt (email now, SMS later). `logged` means
-- written to the server log only; it is never a delivery.
CREATE TABLE IF NOT EXISTS message_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'sms')),
  template VARCHAR(100) NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('sent', 'failed', 'logged', 'suppressed')),
  provider_message_id VARCHAR(255),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_log_created ON message_log(created_at DESC);

INSERT INTO schema_migrations (version, name) VALUES (31, '031_message_log')
ON CONFLICT (version) DO NOTHING;
