-- Who has agreed to be texted. Phones are 10 bare digits (see normalizePhone).
CREATE TABLE IF NOT EXISTS sms_consent (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  phone VARCHAR(10) NOT NULL,
  status VARCHAR(10) NOT NULL CHECK (status IN ('opted_in', 'opted_out')),
  source VARCHAR(50) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, phone)
);

INSERT INTO schema_migrations (version, name) VALUES (33, '033_sms_consent')
ON CONFLICT (version) DO NOTHING;
