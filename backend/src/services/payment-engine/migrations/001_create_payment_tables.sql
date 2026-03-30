-- =============================================================================
-- Payment Engine Core Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Payers Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payers (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  chat_id         VARCHAR(50) NOT NULL,
  phone           VARCHAR(20) NULL,
  wallet_address  VARCHAR(100) NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_chat_id (chat_id),
  INDEX idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- Receivers Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receivers (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  bank_code       VARCHAR(10) NOT NULL,
  account_number  VARCHAR(20) NOT NULL,
  account_name    VARCHAR(255) NOT NULL,
  bank_name       VARCHAR(100) NULL,
  phone           VARCHAR(20) NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_bank_account (bank_code, account_number),
  INDEX idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- Wallets Table (Legacy Pool - used when HD wallet is disabled)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallets (
  id              INT NOT NULL PRIMARY KEY,
  bitcoin         VARCHAR(80) NULL,
  evm             VARCHAR(80) NULL,
  tron            VARCHAR(80) NULL,

  -- Availability flags (1 = available, 0 = in use)
  bitcoin_flag    TINYINT(1) DEFAULT 1,
  ethereum_flag   TINYINT(1) DEFAULT 1,
  binance_flag    TINYINT(1) DEFAULT 1,
  tron_flag       TINYINT(1) DEFAULT 1,
  erc20_flag      TINYINT(1) DEFAULT 1,
  bep20_flag      TINYINT(1) DEFAULT 1,
  trc20_flag      TINYINT(1) DEFAULT 1,

  -- Assignment tracking
  bitcoin_last_assigned   DATETIME NULL,
  ethereum_last_assigned  DATETIME NULL,
  binance_last_assigned   DATETIME NULL,
  tron_last_assigned      DATETIME NULL,
  erc20_last_assigned     DATETIME NULL,
  bep20_last_assigned     DATETIME NULL,
  trc20_last_assigned     DATETIME NULL,

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- Payment Sessions Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_sessions (
  id                VARCHAR(36) PRIMARY KEY,
  reference         VARCHAR(12) NOT NULL UNIQUE,   -- Human-readable (2S-XXXXXX)

  -- Type determines flow
  type              ENUM('transfer', 'gift', 'request', 'merchant') NOT NULL,
  status            VARCHAR(30) DEFAULT 'created',

  -- Amounts
  fiat_amount       DECIMAL(15, 2) NOT NULL,
  fiat_currency     VARCHAR(3) NOT NULL DEFAULT 'NGN',
  crypto            VARCHAR(10) NULL,
  crypto_amount     DECIMAL(18, 8) NULL,
  network           VARCHAR(20) NULL,

  -- Rate (locked at creation)
  rate              DECIMAL(15, 4) NULL,
  asset_price       DECIMAL(18, 8) NULL,
  charge_amount     DECIMAL(15, 2) DEFAULT 0,

  -- Wallet assignment (legacy pool)
  deposit_address   VARCHAR(100) NULL,
  wallet_id         INT NULL,

  -- HD Wallet fields
  derivation_index  INT NULL,
  hd_chain          VARCHAR(20) NULL,

  -- Participants
  payer_id          INT NULL,
  receiver_id       INT NULL,

  -- Merchant fields
  merchant_id       VARCHAR(36) NULL,
  merchant_reference VARCHAR(100) NULL,
  callback_url      VARCHAR(500) NULL,

  -- Deposit tracking
  tx_hash           VARCHAR(100) NULL,
  confirmations     INT DEFAULT 0,
  received_amount   DECIMAL(18, 8) NULL,

  -- Settlement
  settlement_reference VARCHAR(100) NULL,
  settlement_provider  VARCHAR(50) NULL,
  settlement_started_at TIMESTAMP NULL,

  -- Timestamps
  expires_at        TIMESTAMP NULL,
  confirmed_at      TIMESTAMP NULL,
  settled_at        TIMESTAMP NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Metadata
  metadata          JSON NULL,

  -- Indexes
  INDEX idx_status (status),
  INDEX idx_type (type),
  INDEX idx_payer (payer_id),
  INDEX idx_receiver (receiver_id),
  INDEX idx_merchant (merchant_id),
  INDEX idx_deposit_address (deposit_address),
  INDEX idx_created_at (created_at),
  INDEX idx_expires_at (expires_at),

  -- Foreign keys
  FOREIGN KEY (payer_id) REFERENCES payers(id),
  FOREIGN KEY (receiver_id) REFERENCES receivers(id),
  FOREIGN KEY (wallet_id) REFERENCES wallets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- Rates Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rates (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  crypto          VARCHAR(10) NOT NULL,
  fiat_currency   VARCHAR(3) NOT NULL DEFAULT 'NGN',
  buy_rate        DECIMAL(15, 4) NOT NULL,
  sell_rate       DECIMAL(15, 4) NOT NULL,
  asset_price     DECIMAL(18, 8) NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_crypto_fiat (crypto, fiat_currency),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- Legacy Tables (for sync during migration)
-- -----------------------------------------------------------------------------

-- Transfers (legacy)
CREATE TABLE IF NOT EXISTS transfers (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  transfer_id     VARCHAR(20) NOT NULL UNIQUE,
  crypto          VARCHAR(10) NOT NULL,
  network         VARCHAR(20) NOT NULL,
  estimate_asset  VARCHAR(10) NULL,
  amount_payable  DECIMAL(15, 2) NOT NULL,
  crypto_amount   DECIMAL(18, 8) NULL,
  estimate_amount DECIMAL(15, 2) NULL,
  charges         DECIMAL(15, 2) DEFAULT 0,
  date            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  receiver_id     INT NULL,
  payer_id        INT NULL,
  current_rate    DECIMAL(15, 4) NULL,
  merchant_rate   DECIMAL(15, 4) NULL,
  profit_rate     DECIMAL(15, 4) DEFAULT 0,
  wallet_address  VARCHAR(100) NULL,
  status          VARCHAR(30) DEFAULT 'pending',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_status (status),
  INDEX idx_payer (payer_id),
  INDEX idx_receiver (receiver_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Gifts (legacy)
CREATE TABLE IF NOT EXISTS gifts (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  gift_id         VARCHAR(20) NOT NULL UNIQUE,
  gift_status     VARCHAR(30) DEFAULT 'pending',
  crypto          VARCHAR(10) NOT NULL,
  network         VARCHAR(20) NOT NULL,
  estimate_asset  VARCHAR(10) NULL,
  amount_payable  DECIMAL(15, 2) NOT NULL,
  crypto_amount   DECIMAL(18, 8) NULL,
  estimate_amount DECIMAL(15, 2) NULL,
  charges         DECIMAL(15, 2) DEFAULT 0,
  date            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  payer_id        INT NULL,
  receiver_id     INT NULL,
  current_rate    DECIMAL(15, 4) NULL,
  merchant_rate   DECIMAL(15, 4) NULL,
  profit_rate     DECIMAL(15, 4) DEFAULT 0,
  wallet_address  VARCHAR(100) NULL,
  status          VARCHAR(30) DEFAULT 'pending',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_status (status),
  INDEX idx_gift_status (gift_status),
  INDEX idx_payer (payer_id),
  INDEX idx_receiver (receiver_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Requests (legacy)
CREATE TABLE IF NOT EXISTS requests (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  request_id      VARCHAR(20) NOT NULL UNIQUE,
  request_status  VARCHAR(30) DEFAULT 'pending',
  crypto          VARCHAR(10) NOT NULL,
  network         VARCHAR(20) NOT NULL,
  estimate_asset  VARCHAR(10) NULL,
  amount_payable  DECIMAL(15, 2) NOT NULL,
  crypto_amount   DECIMAL(18, 8) NULL,
  estimate_amount DECIMAL(15, 2) NULL,
  charges         DECIMAL(15, 2) DEFAULT 0,
  date            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  receiver_id     INT NULL,
  payer_id        INT NULL,
  current_rate    DECIMAL(15, 4) NULL,
  merchant_rate   DECIMAL(15, 4) NULL,
  profit_rate     DECIMAL(15, 4) DEFAULT 0,
  wallet_address  VARCHAR(100) NULL,
  status          VARCHAR(30) DEFAULT 'pending',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_status (status),
  INDEX idx_request_status (request_status),
  INDEX idx_payer (payer_id),
  INDEX idx_receiver (receiver_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Summaries (legacy)
CREATE TABLE IF NOT EXISTS summaries (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  transaction_type VARCHAR(20) NOT NULL,
  total_dollar    DECIMAL(18, 8) NULL,
  total_naira     DECIMAL(15, 2) NULL,
  effort          DECIMAL(15, 4) DEFAULT 0,
  merchant_id     INT NULL,
  transaction_id  INT NOT NULL,
  ref_code        VARCHAR(20) NULL,
  asset_price     DECIMAL(18, 8) NULL,
  status          VARCHAR(30) DEFAULT 'pending',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_transaction (transaction_id, transaction_type),
  INDEX idx_ref_code (ref_code),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
