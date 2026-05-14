-- Migration 008: Record fiat payout derived from the actual received crypto.

ALTER TABLE payment_sessions
  ADD COLUMN settled_fiat_amount DECIMAL(15, 2) NULL AFTER received_amount;
