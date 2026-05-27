-- Migration 010: Add reusable chain-specific HD wallet fields to receivers.
--
-- These wallet fields are used only by payment sessions. Wallet-as-a-Service
-- continues to store generated wallets in watched_wallets.

ALTER TABLE receivers
  ADD COLUMN wallet_address VARCHAR(100) NULL AFTER phone,
  ADD COLUMN bitcoin_wallet_address VARCHAR(100) NULL AFTER wallet_address,
  ADD COLUMN bitcoin_derivation_index BIGINT UNSIGNED NULL AFTER bitcoin_wallet_address,
  ADD COLUMN ethereum_wallet_address VARCHAR(100) NULL AFTER bitcoin_derivation_index,
  ADD COLUMN ethereum_derivation_index BIGINT UNSIGNED NULL AFTER ethereum_wallet_address,
  ADD COLUMN tron_wallet_address VARCHAR(100) NULL AFTER ethereum_derivation_index,
  ADD COLUMN tron_derivation_index BIGINT UNSIGNED NULL AFTER tron_wallet_address,
  ADD INDEX idx_receiver_wallet_address (wallet_address),
  ADD INDEX idx_receiver_bitcoin_wallet (bitcoin_wallet_address),
  ADD INDEX idx_receiver_ethereum_wallet (ethereum_wallet_address),
  ADD INDEX idx_receiver_tron_wallet (tron_wallet_address);
