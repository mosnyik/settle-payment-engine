import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),

  // Deposit Watcher configuration
  watcher: {
    enabled: process.env.WATCHER_ENABLED === 'true',
    amountTolerance: parseFloat(process.env.WATCHER_AMOUNT_TOLERANCE || '0.02'),
    maxSessionsPerPoll: parseInt(process.env.WATCHER_MAX_SESSIONS_PER_POLL || '100', 10),

    chains: {
      bitcoin: {
        enabled: process.env.WATCHER_BITCOIN_ENABLED !== 'false',
        pollingIntervalMs: parseInt(process.env.WATCHER_BITCOIN_POLL_MS || '60000', 10),
        apiUrl: process.env.BLOCKSTREAM_API_URL || 'https://blockstream.info/api',
        rateLimitMs: parseInt(process.env.WATCHER_BITCOIN_RATE_LIMIT_MS || '500', 10),
      },
      ethereum: {
        enabled: process.env.WATCHER_ETHEREUM_ENABLED !== 'false',
        pollingIntervalMs: parseInt(process.env.WATCHER_ETHEREUM_POLL_MS || '15000', 10),
        apiKey: process.env.ETHERSCAN_API_KEY || '',
        apiUrl: process.env.ETHERSCAN_API_URL || 'https://api.etherscan.io/api',
        rateLimitMs: parseInt(process.env.WATCHER_ETHEREUM_RATE_LIMIT_MS || '200', 10),
      },
      bsc: {
        enabled: process.env.WATCHER_BSC_ENABLED !== 'false',
        pollingIntervalMs: parseInt(process.env.WATCHER_BSC_POLL_MS || '5000', 10),
        apiKey: process.env.BSCSCAN_API_KEY || '',
        apiUrl: process.env.BSCSCAN_API_URL || 'https://api.bscscan.com/api',
        rateLimitMs: parseInt(process.env.WATCHER_BSC_RATE_LIMIT_MS || '200', 10),
      },
      tron: {
        enabled: process.env.WATCHER_TRON_ENABLED !== 'false',
        pollingIntervalMs: parseInt(process.env.WATCHER_TRON_POLL_MS || '5000', 10),
        apiKey: process.env.TRONGRID_API_KEY || '',
        apiUrl: process.env.TRONGRID_API_URL || 'https://api.trongrid.io',
        rateLimitMs: parseInt(process.env.WATCHER_TRON_RATE_LIMIT_MS || '200', 10),
      },
    },
  },

  db: {
    host: process.env.DB_HOST || process.env.host || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || process.env.user || 'root',
    password: process.env.DB_PASSWORD || process.env.password || '',
    database: process.env.DB_NAME || process.env.database || '2settle',
  },

  coinmarketcap: {
    apiKey: process.env.COINMARKETCAP_API_KEY || '',
  },

  mongoro: {
    token: process.env.MONGORO_TOKEN || '',
    transferPin: process.env.MONGORO_TRANSFERPIN || '',
  },

  // Settlement (Fiat Payout) configuration
  settlement: {
    enabled: process.env.SETTLEMENT_ENABLED === 'true',
    provider: 'mongoro' as const,
    mongoro: {
      baseUrl: process.env.MONGORO_API_URL || 'https://api-biz-dev.mongoro.com/api/v1/openapi',
      token: process.env.MONGORO_TOKEN || '',
      transferPin: process.env.MONGORO_TRANSFERPIN || '',
      callbackUrl: process.env.MONGORO_CALLBACK_URL || '',
    },
    telegram: {
      enabled: process.env.TELEGRAM_ALERTS_ENABLED === 'true',
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
    },
  },

  // Admin configuration
  admin: {
    secret: process.env.ADMIN_SECRET || '', // Required for admin endpoints
  },

  // Security configuration
  security: {
    // HMAC signature settings
    hmac: {
      algorithm: 'sha256',
      timestampToleranceMs: parseInt(process.env.HMAC_TIMESTAMP_TOLERANCE_MS || '300000', 10), // 5 minutes
    },

    // Rate limiting settings
    rateLimit: {
      enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
      standard: {
        windowMs: parseInt(process.env.RATE_LIMIT_STANDARD_WINDOW_MS || '60000', 10), // 1 minute
        maxRequests: parseInt(process.env.RATE_LIMIT_STANDARD_MAX || '100', 10),
      },
      premium: {
        windowMs: parseInt(process.env.RATE_LIMIT_PREMIUM_WINDOW_MS || '60000', 10),
        maxRequests: parseInt(process.env.RATE_LIMIT_PREMIUM_MAX || '1000', 10),
      },
      unlimited: {
        windowMs: parseInt(process.env.RATE_LIMIT_UNLIMITED_WINDOW_MS || '60000', 10),
        maxRequests: parseInt(process.env.RATE_LIMIT_UNLIMITED_MAX || '10000', 10),
      },
    },

    // IP whitelisting settings
    ipWhitelist: {
      enabled: process.env.IP_WHITELIST_ENABLED !== 'false',
    },

    // Audit logging settings
    audit: {
      enabled: process.env.AUDIT_LOG_ENABLED !== 'false',
      logRequestBody: process.env.AUDIT_LOG_REQUEST_BODY === 'true', // Default false for security
      retentionDays: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '90', 10),
    },

    // Paths that don't require HMAC authentication
    // (admin routes use separate Bearer token auth, webhooks use provider signatures)
    publicPaths: [
      '/health',
      '/rate/current',
      '/banks',
      '/banks/*',
      '/crypto/prices',
      '/admin/*',
      '/webhooks/*',
    ],
  },
};

export default config;
