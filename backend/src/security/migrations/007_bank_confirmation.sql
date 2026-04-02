-- Migration 007: Bank confirmation session type + per-key confirmation thresholds
--
-- Adds:
--   payment_sessions.type             ENUM extended with 'bank_confirmation'
--   api_keys.confirmation_thresholds  JSON — per-chain override (e.g. {"bitcoin":6,"tron":30})
--   payment_sessions.bank_ref         VARCHAR(100) — bank's own transaction reference

ALTER TABLE payment_sessions
  MODIFY COLUMN type ENUM('transfer', 'gift', 'request', 'merchant', 'bank_confirmation') NOT NULL;

ALTER TABLE api_keys
  ADD COLUMN confirmation_thresholds JSON NULL
  AFTER settlement_mode;

ALTER TABLE payment_sessions
  ADD COLUMN bank_ref VARCHAR(100) NULL
  AFTER metadata;
