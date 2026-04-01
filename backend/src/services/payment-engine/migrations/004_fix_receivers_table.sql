-- Migration: 004_fix_receivers_table
-- Adds bank_code and paystack_recipient_code columns to the receivers table.
--
-- The receivers table was created with bank_name (display name) and bank_account
-- instead of the originally designed bank_code + account_number columns.
-- This migration adds the missing columns while preserving existing data.

ALTER TABLE receivers
  ADD COLUMN bank_code VARCHAR(10) NULL AFTER bank_name,
  ADD COLUMN paystack_recipient_code VARCHAR(50) NULL AFTER bank_code,
  ADD INDEX idx_bank_account (bank_account, bank_code);
