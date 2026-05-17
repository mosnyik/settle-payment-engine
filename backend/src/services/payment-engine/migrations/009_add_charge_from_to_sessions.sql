-- Migration 009: Persist which side bears the platform charge.

ALTER TABLE payment_sessions
  ADD COLUMN charge_from ENUM('fiat', 'crypto') NOT NULL DEFAULT 'crypto' AFTER charge_amount;
