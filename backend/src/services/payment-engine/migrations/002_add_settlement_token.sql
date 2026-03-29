-- Migration: 002_add_settlement_token
-- Adds a one-time settlement token to payment_sessions.
-- Used to harden self-settlement: the token is generated when the engine
-- fires payment.settling and must be echoed back on POST /payments/:ref/settle.
-- This ensures only the integrator who received the webhook can confirm settlement.

ALTER TABLE payment_sessions
  ADD COLUMN settlement_token VARCHAR(64) NULL AFTER settlement_provider,
  ADD COLUMN settlement_token_expires_at TIMESTAMP NULL AFTER settlement_token;
