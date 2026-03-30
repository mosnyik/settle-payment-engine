-- Merchant Wallet Migration
-- Adds per-API-key funding wallets (system-derived) and parent wallets (user-provided)
-- Run: mysql -u root -p 2settle < 003_add_merchant_wallets.sql

-- Single-row counter for merchant funding wallet index allocation
CREATE TABLE IF NOT EXISTS merchant_wallet_config (
  id INT PRIMARY KEY DEFAULT 1,
  next_index INT UNSIGNED NOT NULL DEFAULT 0,
  CONSTRAINT single_row CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO merchant_wallet_config (id, next_index) VALUES (1, 0);

-- Add funding wallet (system-derived) columns to api_keys
ALTER TABLE api_keys
  ADD COLUMN funding_wallet_index INT UNSIGNED NULL COMMENT 'HD derivation index for this merchant funding wallet',
  ADD COLUMN funding_wallet_bitcoin VARCHAR(100) NULL COMMENT 'Derived Bitcoin funding wallet address',
  ADD COLUMN funding_wallet_ethereum VARCHAR(100) NULL COMMENT 'Derived Ethereum/BSC funding wallet address',
  ADD COLUMN funding_wallet_tron VARCHAR(100) NULL COMMENT 'Derived Tron funding wallet address',
  ADD COLUMN parent_wallet_bitcoin VARCHAR(100) NULL COMMENT 'User-provided Bitcoin destination address',
  ADD COLUMN parent_wallet_ethereum VARCHAR(100) NULL COMMENT 'User-provided Ethereum/BSC destination address',
  ADD COLUMN parent_wallet_tron VARCHAR(100) NULL COMMENT 'User-provided Tron destination address';

-- Add funding wallet index and per-session parent wallet to payment_sessions
ALTER TABLE payment_sessions
  ADD COLUMN funding_wallet_index INT UNSIGNED NULL COMMENT 'Funding wallet index from API key at session creation',
  ADD COLUMN parent_wallet VARCHAR(100) NULL COMMENT 'Sweep destination address for this session (chain-specific parent wallet)';

CREATE INDEX idx_funding_wallet ON api_keys (funding_wallet_index);
