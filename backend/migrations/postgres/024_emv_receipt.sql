-- The card-network fields an in-person EMV receipt has to carry.
--
-- Accepting chip cards obliges the merchant to put certain things on the
-- customer's receipt. `application_preferred_name` (the application the card
-- and reader agreed on) and `dedicated_file_name` (the AID) are required
-- everywhere; `account_type` is required outside the US. The optional ones —
-- authorization response code, application cryptogram, TVR, TSI — are what an
-- issuer asks for when a transaction is disputed.
--
-- Stripe returns all of it on the charge as soon as the payment is confirmed,
-- and until now StewardPOS kept only the authorization code and the transaction
-- id. Every printed receipt for a chip payment has therefore been missing
-- fields the networks require, and the data to fix it was fetched and thrown
-- away on each sale.
--
-- Stored as JSON rather than a column each: this is a block handed to us by the
-- processor, printed as a block, and never queried field by field. Columns
-- would invite a migration every time a network adds one.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS card_receipt JSONB;

COMMENT ON COLUMN orders.card_receipt IS
  'EMV receipt fields from the processor, required on receipts for chip payments.';

INSERT INTO schema_migrations (version, name) VALUES (24, '024_emv_receipt')
ON CONFLICT (version) DO NOTHING;
