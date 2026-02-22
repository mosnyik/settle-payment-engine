import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),

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

    // Paths that don't require authentication
    publicPaths: [
      '/health',
      '/rate/current',
      '/banks',
      '/banks/*',
      '/crypto/prices',
    ],
  },
};

export default config;
