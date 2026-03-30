-- HD Wallet Tables Migration
-- Run: mysql -u root -p 2settle < 001_create_hd_wallet_tables.sql

-- HD wallet configuration per chain (derivation state tracking)
CREATE TABLE IF NOT EXISTS hd_wallet_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chain ENUM('bitcoin', 'ethereum', 'tron') NOT NULL UNIQUE,
  derivation_path_base VARCHAR(100) NOT NULL,
  next_index BIGINT UNSIGNED NOT NULL DEFAULT 0,
  hot_wallet_address VARCHAR(100) NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_chain (chain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Derived addresses audit trail
CREATE TABLE IF NOT EXISTS derived_addresses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chain ENUM('bitcoin', 'ethereum', 'tron') NOT NULL,
  derivation_index BIGINT UNSIGNED NOT NULL,
  address VARCHAR(100) NOT NULL,
  session_id VARCHAR(36) NULL,
  derived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  swept_at TIMESTAMP NULL,
  sweep_tx_hash VARCHAR(100) NULL,
  UNIQUE KEY idx_chain_index (chain, derivation_index),
  UNIQUE KEY idx_address (address),
  INDEX idx_session (session_id),
  INDEX idx_swept (swept_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sweep transaction audit trail
CREATE TABLE IF NOT EXISTS sweep_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  chain ENUM('bitcoin', 'ethereum', 'tron') NOT NULL,
  network VARCHAR(20) NOT NULL,
  from_address VARCHAR(100) NOT NULL,
  to_address VARCHAR(100) NOT NULL,
  asset_type ENUM('native', 'token') NOT NULL,
  token_contract VARCHAR(100) NULL,
  amount_raw VARCHAR(78) NOT NULL,
  amount_decimal DECIMAL(36, 18) NOT NULL,
  tx_hash VARCHAR(100) NULL,
  status ENUM('pending', 'submitted', 'confirmed', 'failed') DEFAULT 'pending',
  error_message TEXT NULL,
  retry_count INT DEFAULT 0,
  gas_used VARCHAR(78) NULL,
  gas_price VARCHAR(78) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  submitted_at TIMESTAMP NULL,
  confirmed_at TIMESTAMP NULL,
  INDEX idx_session (session_id),
  INDEX idx_status (status),
  INDEX idx_chain_status (chain, status),
  INDEX idx_from_address (from_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Initialize derivation paths for each chain
INSERT INTO hd_wallet_config (chain, derivation_path_base, next_index, hot_wallet_address) VALUES
  ('bitcoin', "m/84'/0'/0'/0", 0, ''),
  ('ethereum', "m/44'/60'/0'/0", 0, ''),
  ('tron', "m/44'/195'/0'/0", 0, '')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- Add HD wallet columns to payment_sessions table
-- NOTE: Skip this block if columns already exist (already applied)
-- ALTER TABLE payment_sessions
--   ADD COLUMN derivation_index BIGINT UNSIGNED NULL AFTER wallet_id,
--   ADD COLUMN hd_chain VARCHAR(20) NULL AFTER network,
--   MODIFY COLUMN wallet_id INT NULL;

-- Add index for HD wallet lookups
-- NOTE: Skip if index already exists
-- CREATE INDEX idx_hd_derivation ON payment_sessions (hd_chain, derivation_index);
