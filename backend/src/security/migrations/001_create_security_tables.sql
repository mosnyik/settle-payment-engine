
-- Security Model Database Migration
-- Run this migration to create the required security tables

-- =============================================================================
-- API KEYS TABLE
-- Stores merchant API keys for authentication
-- =============================================================================
CREATE TABLE IF NOT EXISTS api_keys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  key_id VARCHAR(48) NOT NULL UNIQUE,           -- Public identifier (prefix: pk_)
  key_hash VARCHAR(64) NOT NULL,                -- SHA-256 hash of secret key
  merchant_id VARCHAR(50) NOT NULL,             -- Associated merchant
  name VARCHAR(100) NOT NULL,                   -- Friendly name
  permissions JSON,                             -- Array of allowed endpoints/actions
  rate_limit_tier ENUM('standard', 'premium', 'unlimited') DEFAULT 'standard',
  ip_whitelist JSON,                            -- Array of allowed IPs (null = any)
  is_active BOOLEAN DEFAULT TRUE,
  expires_at DATETIME,                          -- Optional expiration
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME,

  INDEX idx_key_id (key_id),
  INDEX idx_merchant (merchant_id),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- AUDIT LOGS TABLE
-- Stores security audit trail for all API requests
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  timestamp DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  request_id VARCHAR(36) NOT NULL,              -- UUID for request correlation
  api_key_id VARCHAR(48),                       -- NULL for public endpoints
  merchant_id VARCHAR(50),
  action VARCHAR(100) NOT NULL,                 -- e.g., 'transfer.create', 'gift.claim'
  resource_type VARCHAR(50),                    -- e.g., 'payment_session', 'gift'
  resource_id VARCHAR(100),
  method VARCHAR(10) NOT NULL,
  path VARCHAR(255) NOT NULL,
  ip_address VARCHAR(45) NOT NULL,              -- IPv6 compatible
  user_agent VARCHAR(500),
  request_body_hash VARCHAR(64),                -- SHA-256 of request body
  status_code INT,
  response_time_ms INT,
  success BOOLEAN,
  error_code VARCHAR(50),
  error_message VARCHAR(500),

  INDEX idx_timestamp (timestamp),
  INDEX idx_api_key (api_key_id),
  INDEX idx_merchant (merchant_id),
  INDEX idx_action (action),
  INDEX idx_resource (resource_type, resource_id),
  INDEX idx_request_id (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- RATE LIMIT STATE TABLE
-- Stores rate limiting counters (for distributed/persistent rate limiting)
-- =============================================================================
CREATE TABLE IF NOT EXISTS rate_limit_state (
  key_identifier VARCHAR(100) PRIMARY KEY,     -- api_key_id or IP address
  window_start DATETIME NOT NULL,
  request_count INT DEFAULT 0,

  INDEX idx_window (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- CLEANUP PROCEDURE
-- Call periodically to clean up old audit logs and expired rate limit entries
-- =============================================================================
DELIMITER //

CREATE PROCEDURE IF NOT EXISTS cleanup_security_tables(
  IN audit_retention_days INT,
  IN rate_limit_retention_hours INT
)
BEGIN
  -- Delete old audit logs (default: keep 90 days)
  DELETE FROM audit_logs
  WHERE timestamp < DATE_SUB(NOW(), INTERVAL COALESCE(audit_retention_days, 90) DAY);

  -- Delete expired rate limit entries (default: keep 24 hours)
  DELETE FROM rate_limit_state
  WHERE window_start < DATE_SUB(NOW(), INTERVAL COALESCE(rate_limit_retention_hours, 24) HOUR);
END //

DELIMITER ;

-- =============================================================================
-- EXAMPLE: Create a test API key (remove in production)
-- =============================================================================
-- INSERT INTO api_keys (key_id, key_hash, merchant_id, name, permissions, rate_limit_tier)
-- VALUES (
--   'pk_test_1234567890abcdef',
--   'hash_of_sk_test_key_here',
--   'merchant_001',
--   'Test API Key',
--   '["transfer.*", "gift.*", "request.*"]',
--   'standard'
-- );
