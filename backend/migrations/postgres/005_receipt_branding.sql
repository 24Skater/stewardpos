-- Migration: Receipt Branding Settings
-- Version: 5

-- Add receipt branding columns to settings table
ALTER TABLE settings ADD COLUMN IF NOT EXISTS store_address TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS store_city TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS store_state TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS store_zip TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS store_number TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_logo_url TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_header_text TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_footer_text TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_show_logo BOOLEAN DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_show_barcode BOOLEAN DEFAULT true;

-- Insert migration record
INSERT INTO schema_migrations (version, name) VALUES (5, '005_receipt_branding')
ON CONFLICT (version) DO NOTHING;

