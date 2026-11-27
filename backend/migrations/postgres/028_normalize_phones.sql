-- Customer phones are now stored as 10 bare digits (see src/utils/phone.ts), so
-- a sale matches its customer exactly. Bring existing rows to the same shape.
UPDATE customers SET phone = regexp_replace(phone, '\D', '', 'g') WHERE phone ~ '\D';
UPDATE customers SET phone = substr(phone, 2) WHERE length(phone) = 11 AND phone LIKE '1%';
UPDATE orders SET customer_phone = regexp_replace(customer_phone, '\D', '', 'g') WHERE customer_phone ~ '\D';
UPDATE orders SET customer_phone = substr(customer_phone, 2) WHERE length(customer_phone) = 11 AND customer_phone LIKE '1%';

INSERT INTO schema_migrations (version, name) VALUES (28, '028_normalize_phones')
ON CONFLICT (version) DO NOTHING;
