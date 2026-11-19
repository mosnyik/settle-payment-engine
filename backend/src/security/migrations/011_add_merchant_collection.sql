-- =============================================================================
-- Migration 011: Per-asset merchant collection on api_keys
--
-- collection_modes: JSON map of asset -> 'hd' | 'merchant', e.g. {"BTC":"merchant"}.
--   Assets not listed use 'hd' (derived deposit address + sweep). 'merchant'
--   uses the key's parent_wallet_<chain> as the deposit address directly.
-- whatsapp_phone: number (with country code) that receives settlement
--   instructions for merchant-collected payments.
--
-- MySQL 8.0: plain ADD COLUMN (no IF NOT EXISTS).
-- =============================================================================

ALTER TABLE api_keys
  ADD COLUMN collection_modes JSON NULL COMMENT 'Per-asset collection mode, e.g. {"BTC":"merchant"}; unlisted assets use hd',
  ADD COLUMN whatsapp_phone VARCHAR(20) NULL COMMENT 'Merchant WhatsApp number for merchant-collection settlement instructions';
