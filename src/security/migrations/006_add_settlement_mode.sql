-- Migration 006: Add settlement_mode to api_keys
-- Controls whether the payment engine settles via Mongoro automatically
-- or defers to the API key holder to confirm settlement.
--
-- 'mongoro' - engine auto-settles via Mongoro after deposit confirmation
-- 'self'    - bank/integrator handles fiat transfer and calls POST /v1/payments/:ref/settle

ALTER TABLE api_keys
  ADD COLUMN settlement_mode ENUM('mongoro', 'self') NOT NULL DEFAULT 'self'
  AFTER webhook_secret;
