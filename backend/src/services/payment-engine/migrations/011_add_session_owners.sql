-- Migration 011: Add session owners for reusable payment-session HD wallets.
--
-- A session owner is the actor paying crypto into a payment session deposit
-- address. The owner is identified internally by owner_scope + owner_ref
-- where owner_ref is currently derived from payer.chatId.
--
-- This applies only to payment sessions. Wallet-as-a-Service remains separate.

CREATE TABLE IF NOT EXISTS session_owners (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  owner_scope VARCHAR(100) NOT NULL,
  owner_ref VARCHAR(100) NOT NULL,

  phone VARCHAR(30) NULL,
  wallet_address VARCHAR(150) NULL,
  email VARCHAR(150) NULL,

  bitcoin_wallet_address VARCHAR(100) NULL,
  bitcoin_derivation_index BIGINT UNSIGNED NULL,

  ethereum_wallet_address VARCHAR(100) NULL,
  ethereum_derivation_index BIGINT UNSIGNED NULL,

  tron_wallet_address VARCHAR(100) NULL,
  tron_derivation_index BIGINT UNSIGNED NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_session_owner_scope_ref (owner_scope, owner_ref),
  INDEX idx_session_owner_phone (phone),
  INDEX idx_session_owner_wallet_address (wallet_address),
  INDEX idx_session_owner_bitcoin_wallet (bitcoin_wallet_address),
  INDEX idx_session_owner_ethereum_wallet (ethereum_wallet_address),
  INDEX idx_session_owner_tron_wallet (tron_wallet_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE payment_sessions
  ADD COLUMN session_owner_id BIGINT UNSIGNED NULL AFTER receiver_id,
  ADD INDEX idx_payment_sessions_session_owner (session_owner_id),
  ADD CONSTRAINT fk_payment_sessions_session_owner
    FOREIGN KEY (session_owner_id) REFERENCES session_owners(id);
