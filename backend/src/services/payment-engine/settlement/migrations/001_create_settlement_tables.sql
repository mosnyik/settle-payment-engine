-- Settlement Tables Migration
-- Run: mysql -u root -p 2settle < src/services/payment-engine/settlement/migrations/001_create_settlement_tables.sql

-- Settlement attempts table tracks all payout attempts and their status
CREATE TABLE IF NOT EXISTS settlement_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'mongoro',
  reference VARCHAR(100) NULL,
  status ENUM('pending', 'success', 'failed', 'reversed') NOT NULL DEFAULT 'pending',
  amount DECIMAL(15,2) NOT NULL,
  account_number VARCHAR(20) NOT NULL,
  bank_code VARCHAR(10) NOT NULL,
  account_name VARCHAR(100) NOT NULL,
  request_payload JSON NULL,
  response_payload JSON NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_settlement_session (session_id),
  INDEX idx_settlement_reference (reference),
  INDEX idx_settlement_status (status),
  INDEX idx_settlement_created (created_at),
  FOREIGN KEY (session_id) REFERENCES payment_sessions(id) ON DELETE RESTRICT
);

-- Add settlement fields to payment_sessions
-- NOTE: Skip this block if columns already exist (already applied)
-- ALTER TABLE payment_sessions
--   ADD COLUMN settlement_reference VARCHAR(100) NULL AFTER settled_at,
--   ADD COLUMN settlement_provider VARCHAR(50) NULL DEFAULT 'mongoro' AFTER settlement_reference,
--   ADD COLUMN settlement_started_at TIMESTAMP NULL AFTER settlement_provider;

-- Add settlement_reversed status if not already present
-- Note: This ALTER may fail if the enum already includes this value - that's OK
-- ALTER TABLE payment_sessions MODIFY status ENUM(
--   'created', 'pending_payment', 'pending', 'confirming',
--   'confirmed', 'pending_claim', 'settling', 'settled',
--   'expired', 'failed', 'settlement_reversed'
-- ) DEFAULT 'created';
