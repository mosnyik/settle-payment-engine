-- Migration: 003_add_paystack_recipient_code
-- Caches the Paystack recipient code on the receivers table.
-- On first Paystack transfer to an account we create the recipient and store the code.
-- Subsequent transfers reuse it, saving one API call per settlement.

ALTER TABLE receivers
  ADD COLUMN paystack_recipient_code VARCHAR(50) NULL AFTER bank_name;
