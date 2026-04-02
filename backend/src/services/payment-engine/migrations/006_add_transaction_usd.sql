-- Migration 006: Add transaction_usd to payment_sessions
--
-- Stores the USD value of the transaction at rate-lock time for analytics.
-- Computed as netFiatAmount / rate and persisted so it never drifts
-- even if the rate cache is later updated.

ALTER TABLE payment_sessions
  ADD COLUMN transaction_usd DECIMAL(18, 6) NULL
  AFTER fiat_currency;
