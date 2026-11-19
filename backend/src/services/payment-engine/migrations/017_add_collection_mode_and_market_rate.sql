-- =============================================================================
-- Migration 017: Merchant collection on payment_sessions
--
-- collection_mode: how this session's deposit was collected, frozen at
--   creation so later changes to the merchant's settings don't affect it.
--   'merchant' sessions settle by WhatsApp instruction to the merchant, not a payout.
-- market_rate: fiat/USD rate before USER_RATE_SPREAD at rate lock, used to
--   compute 2Settle's spread profit for merchant-collected sessions.
--
-- MySQL 8.0: plain ADD COLUMN (no IF NOT EXISTS).
-- =============================================================================

ALTER TABLE payment_sessions
  ADD COLUMN collection_mode ENUM('hd', 'merchant') NOT NULL DEFAULT 'hd',
  ADD COLUMN market_rate DECIMAL(18, 8) NULL;
