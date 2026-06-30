CREATE TABLE IF NOT EXISTS platform_config (
  `key`       VARCHAR(100)   NOT NULL,
  value       VARCHAR(255)   NOT NULL,
  description VARCHAR(500)   NULL,
  updated_at  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
);

-- Seed the first-transaction fee rate (3% default)
INSERT INTO platform_config (`key`, value, description)
VALUES ('first_transaction_fee_rate', '0.03', 'Extra percentage fee charged on a payer''s first transaction (e.g. 0.03 = 3%)')
ON DUPLICATE KEY UPDATE description = VALUES(description);
