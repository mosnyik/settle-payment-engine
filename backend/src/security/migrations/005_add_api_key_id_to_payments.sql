-- Migration 005: Add api_key_id to payment_sessions
-- Links each payment session to the API key that created it,
-- enabling webhook delivery for payment status changes.

ALTER TABLE payment_sessions
  ADD COLUMN api_key_id INT NULL AFTER merchant_id,
  ADD INDEX idx_payment_sessions_api_key_id (api_key_id);

