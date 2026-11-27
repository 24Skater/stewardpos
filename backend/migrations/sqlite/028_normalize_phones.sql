-- Customer phones are now stored as 10 bare digits (see src/utils/phone.ts), so
-- a sale matches its customer exactly. Bring existing rows to the same shape.
-- SQLite has no regexp_replace; strip the separators people actually type.
UPDATE customers SET phone = replace(replace(replace(replace(replace(replace(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', '')
WHERE phone IS NOT NULL;
UPDATE customers SET phone = substr(phone, 2) WHERE length(phone) = 11 AND phone LIKE '1%';
UPDATE orders SET customer_phone = replace(replace(replace(replace(replace(replace(customer_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', '')
WHERE customer_phone IS NOT NULL;
UPDATE orders SET customer_phone = substr(customer_phone, 2) WHERE length(customer_phone) = 11 AND customer_phone LIKE '1%';

INSERT INTO schema_migrations (version, name) VALUES (28, '028_normalize_phones');
