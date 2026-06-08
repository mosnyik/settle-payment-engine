-- Migration 010: Remove Paystack as a settlement option
--
-- Previously: ENUM('mongoro', 'paystack', 'self') DEFAULT 'paystack'
-- Now:        ENUM('mongoro', 'self') DEFAULT 'mongoro'

-- Migrate any existing keys using paystack to mongoro
UPDATE api_keys SET settlement_mode = 'mongoro' WHERE settlement_mode = 'paystack';

-- Remove paystack from the ENUM and reset default to mongoro
ALTER TABLE api_keys
  MODIFY COLUMN settlement_mode ENUM('mongoro', 'self') NOT NULL DEFAULT 'mongoro';

-- Drop paystack-specific columns (no longer used)
ALTER TABLE receivers DROP COLUMN paystack_recipient_code;
ALTER TABLE banks DROP COLUMN paystack_code;
