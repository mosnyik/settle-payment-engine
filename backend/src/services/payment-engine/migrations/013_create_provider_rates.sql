-- =============================================================================
-- Provider Rates Table
-- Stores the last fetched exchange rate from each external rate provider.
-- Written by the rate-fetch-job on a schedule; read by the rate aggregator
-- during transaction processing so no external API calls happen in-band.
-- =============================================================================

CREATE TABLE IF NOT EXISTS provider_rates (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  provider      VARCHAR(50)    NOT NULL,
  fiat_currency VARCHAR(10)    NOT NULL DEFAULT 'NGN',
  rate          DECIMAL(20, 6) NOT NULL,
  fetched_at    TIMESTAMP      NOT NULL,
  updated_at    TIMESTAMP      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_provider_fiat (provider, fiat_currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
