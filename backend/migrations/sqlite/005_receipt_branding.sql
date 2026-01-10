-- Migration: Receipt Branding Settings
-- Version: 5

-- Add receipt branding columns to settings table
ALTER TABLE settings ADD COLUMN store_address TEXT;
ALTER TABLE settings ADD COLUMN store_city TEXT;
ALTER TABLE settings ADD COLUMN store_state TEXT;
ALTER TABLE settings ADD COLUMN store_zip TEXT;
ALTER TABLE settings ADD COLUMN store_number TEXT;
ALTER TABLE settings ADD COLUMN receipt_logo_url TEXT;
ALTER TABLE settings ADD COLUMN receipt_header_text TEXT;
ALTER TABLE settings ADD COLUMN receipt_footer_text TEXT;
ALTER TABLE settings ADD COLUMN receipt_show_logo INTEGER DEFAULT 1;
ALTER TABLE settings ADD COLUMN receipt_show_barcode INTEGER DEFAULT 1;

-- Insert migration record
INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (5, '005_receipt_branding');

