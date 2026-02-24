
-- Deposit Watcher Tables
-- Run this migration to set up the watcher state tables

-- =============================================================================
-- PROCESSED TRANSACTIONS
-- =============================================================================
-- Tracks which transactions have been processed to prevent duplicate handling.
-- Critical for crash recovery - ensures we don't mark_deposit or confirm_deposit twice.

CREATE TABLE IF NOT EXISTS watcher_processed_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tx_hash VARCHAR(100) NOT NULL,
  session_id VARCHAR(36) NOT NULL,
  chain VARCHAR(20) NOT NULL,
  action ENUM('mark_deposit', 'confirm_deposit') NOT NULL,
  confirmations INT NULL,
  processed_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Prevent processing same TX for same action twice
  UNIQUE KEY idx_tx_action (tx_hash, action),
  -- Quick lookup by session
  INDEX idx_session (session_id),
  -- Cleanup old records
  INDEX idx_processed_at (processed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================================================
-- WATCHER STATE (OPTIONAL)
-- =============================================================================
-- Stores watcher metadata like last poll time per chain.
-- Useful for monitoring and debugging.

CREATE TABLE IF NOT EXISTS watcher_state (
  chain VARCHAR(20) PRIMARY KEY,
  last_poll_at TIMESTAMP NULL,
  last_success_at TIMESTAMP NULL,
  last_error VARCHAR(500) NULL,
  last_error_at TIMESTAMP NULL,
  sessions_checked INT DEFAULT 0,
  deposits_detected INT DEFAULT 0,
  deposits_confirmed INT DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Initialize state for each chain
INSERT IGNORE INTO watcher_state (chain) VALUES
  ('bitcoin'),
  ('ethereum'),
  ('bsc'),
  ('tron');

-- =============================================================================
-- FRAUD EVENTS (OPTIONAL)
-- =============================================================================
-- Log suspicious activity for manual review.

CREATE TABLE IF NOT EXISTS watcher_fraud_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  chain VARCHAR(20) NOT NULL,
  session_id VARCHAR(36) NULL,
  tx_hash VARCHAR(100) NULL,
  details JSON NULL,
  reviewed BOOLEAN DEFAULT FALSE,
  reviewed_by VARCHAR(100) NULL,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_event_type (event_type),
  INDEX idx_chain (chain),
  INDEX idx_session (session_id),
  INDEX idx_reviewed (reviewed),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================================================
-- CLEANUP PROCEDURE
-- =============================================================================
-- Remove old processed transaction records (run periodically).

DELIMITER //

CREATE PROCEDURE IF NOT EXISTS cleanup_watcher_data(IN retention_days INT)
BEGIN
  DECLARE cutoff_date TIMESTAMP;
  SET cutoff_date = DATE_SUB(NOW(), INTERVAL retention_days DAY);

  -- Clean processed transactions
  DELETE FROM watcher_processed_transactions
  WHERE processed_at < cutoff_date;

  -- Clean reviewed fraud events
  DELETE FROM watcher_fraud_events
  WHERE reviewed = TRUE
  AND created_at < cutoff_date;

  SELECT ROW_COUNT() AS deleted_rows;
END //

DELIMITER ;

-- Example: CALL cleanup_watcher_data(30);
