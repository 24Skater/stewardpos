-- Admin-edited message templates. No row means the built-in default applies.
CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  key VARCHAR(50) NOT NULL,
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'sms')),
  subject VARCHAR(255) NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, key, channel)
);

INSERT INTO schema_migrations (version, name) VALUES (34, '034_message_templates')
ON CONFLICT (version) DO NOTHING;
