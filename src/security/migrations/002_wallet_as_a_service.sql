-- =============================================================================
-- Wallet-as-a-Service (WaaS) Database Migration
-- Run this migration to add HD wallet API functionality
-- =============================================================================

-- =============================================================================
-- EXTEND API_KEYS TABLE
-- Add webhook and sweep configuration for wallet API users
-- =============================================================================

ALTER TABLE api_keys
  ADD COLUMN webhook_url VARCHAR(500) NULL COMMENT 'URL for deposit/confirmation webhooks',
  ADD COLUMN webhook_secret VARCHAR(64) NULL COMMENT 'Secret for signing webhook payloads (HMAC)',
  ADD COLUMN sweep_address VARCHAR(100) NULL COMMENT 'Developer wallet address for auto-sweep';

-- =============================================================================
-- WATCHED_WALLETS TABLE
-- Stores generated HD wallet addresses for external developers
-- =============================================================================

CREATE TABLE IF NOT EXISTS watched_wallets (
  id VARCHAR(32) PRIMARY KEY,                     -- Unique wallet ID (wal_xxx)
  api_key_id INT NOT NULL,                        -- Owner API key
  address VARCHAR(100) NOT NULL,                  -- Generated deposit address
  network VARCHAR(20) NOT NULL,                   -- bitcoin, ethereum, trc20, etc.
  crypto VARCHAR(10) NOT NULL,                    -- BTC, ETH, USDT, etc.
  derivation_index INT NOT NULL,                  -- HD derivation index used
  hd_chain VARCHAR(20) NOT NULL,                  -- bitcoin, ethereum, tron

  -- Status tracking
  status ENUM('watching', 'deposit_detected', 'confirmed', 'swept', 'expired') DEFAULT 'watching',

  -- Deposit info (populated when deposit detected)
  tx_hash VARCHAR(100) NULL,
  amount DECIMAL(24, 8) NULL,                     -- Amount received
  confirmations INT DEFAULT 0,
  detected_at DATETIME NULL,
  confirmed_at DATETIME NULL,

  -- Sweep info (populated after sweep)
  sweep_tx_hash VARCHAR(100) NULL,
  swept_at DATETIME NULL,

  -- Webhook delivery tracking
  webhook_deposit_sent BOOLEAN DEFAULT FALSE,
  webhook_confirmed_sent BOOLEAN DEFAULT FALSE,
  webhook_last_error VARCHAR(500) NULL,
  webhook_retry_count INT DEFAULT 0,

  -- Metadata (passed through to webhooks)
  metadata JSON NULL,

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,                       -- Optional expiration

  -- Indexes
  INDEX idx_api_key (api_key_id),
  INDEX idx_address (address),
  INDEX idx_network (network),
  INDEX idx_status (status),
  INDEX idx_created (created_at),
  UNIQUE INDEX idx_address_network (address, network),

  -- Foreign key
  CONSTRAINT fk_watched_wallets_api_key
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- API_USAGE TABLE
-- Tracks usage per API key per day for billing
-- =============================================================================

CREATE TABLE IF NOT EXISTS api_usage (
  api_key_id INT NOT NULL,
  date DATE NOT NULL,

  -- Wallet API usage
  wallets_created INT DEFAULT 0,
  deposits_detected INT DEFAULT 0,
  deposits_confirmed INT DEFAULT 0,
  sweeps_completed INT DEFAULT 0,

  -- Webhook usage
  webhooks_sent INT DEFAULT 0,
  webhooks_failed INT DEFAULT 0,

  -- Payment API usage (for completeness)
  payments_created INT DEFAULT 0,
  payments_completed INT DEFAULT 0,

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (api_key_id, date),

  CONSTRAINT fk_api_usage_api_key
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- WEBHOOK_DELIVERY_LOG TABLE
-- Stores webhook delivery attempts for debugging/retry
-- =============================================================================

CREATE TABLE IF NOT EXISTS webhook_delivery_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  wallet_id VARCHAR(32) NOT NULL,
  api_key_id INT NOT NULL,

  -- Event info
  event_type ENUM('deposit.detected', 'deposit.confirmed', 'sweep.completed') NOT NULL,
  payload JSON NOT NULL,

  -- Delivery info
  webhook_url VARCHAR(500) NOT NULL,
  http_status INT NULL,
  response_body TEXT NULL,
  error_message VARCHAR(500) NULL,

  -- Timing
  attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  response_time_ms INT NULL,

  -- Success flag
  success BOOLEAN DEFAULT FALSE,

  INDEX idx_wallet (wallet_id),
  INDEX idx_api_key (api_key_id),
  INDEX idx_event (event_type),
  INDEX idx_success (success),
  INDEX idx_attempted (attempted_at),

  CONSTRAINT fk_webhook_log_wallet
    FOREIGN KEY (wallet_id) REFERENCES watched_wallets(id) ON DELETE CASCADE,
  CONSTRAINT fk_webhook_log_api_key
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- HELPER: Increment usage counter
-- Call this when tracking API usage
-- =============================================================================

DELIMITER //

CREATE PROCEDURE IF NOT EXISTS increment_api_usage(
  IN p_api_key_id INT,
  IN p_counter VARCHAR(50)
)
BEGIN
  INSERT INTO api_usage (api_key_id, date)
  VALUES (p_api_key_id, CURDATE())
  ON DUPLICATE KEY UPDATE updated_at = NOW();

  SET @sql = CONCAT(
    'UPDATE api_usage SET ', p_counter, ' = ', p_counter, ' + 1 ',
    'WHERE api_key_id = ', p_api_key_id, ' AND date = CURDATE()'
  );
  PREPARE stmt FROM @sql;
  EXECUTE stmt;
  DEALLOCATE PREPARE stmt;
END //

DELIMITER ;

-- =============================================================================
-- EXAMPLE USAGE
-- =============================================================================
--
-- Create a wallet API key:
-- INSERT INTO api_keys (key_id, key_hash, merchant_id, name, permissions, webhook_url, sweep_address)
-- VALUES (
--   'pk_wallet_xxx',
--   'sha256_hash_here',
--   'developer_001',
--   'My Wallet API',
--   '["wallet:create", "wallet:read"]',
--   'https://myapp.com/webhooks/crypto',
--   'TXxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
-- );
--
-- Generate a wallet:
-- INSERT INTO watched_wallets (id, api_key_id, address, network, crypto, derivation_index, hd_chain)
-- VALUES ('wal_abc123', 1, 'T...', 'trc20', 'USDT', 42, 'tron');
--
-- Track usage:
-- CALL increment_api_usage(1, 'wallets_created');
