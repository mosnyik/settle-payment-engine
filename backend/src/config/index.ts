import dotenv from "dotenv";
import path from "path";

// .env lives at the project root (one level above backend/)
// Works from both src/ (ts-node) and dist/ (compiled)
dotenv.config({ path: path.join(__dirname, "../../../.env") });

export const config = {
  port: parseInt(process.env.PORT || "3500", 10),

  // Deposit Watcher configuration
  watcher: {
    enabled: process.env.WATCHER_ENABLED === "true",
    amountTolerance: parseFloat(process.env.WATCHER_AMOUNT_TOLERANCE || "0.02"),
    maxSessionsPerPoll: parseInt(
      process.env.WATCHER_MAX_SESSIONS_PER_POLL || "100",
      10,
    ),

    chains: {
      bitcoin: {
        enabled: process.env.WATCHER_BITCOIN_ENABLED !== "false",
        pollingIntervalMs: parseInt(
          process.env.WATCHER_BITCOIN_POLL_MS || "60000",
          10,
        ),
        apiUrl:
          process.env.BLOCKSTREAM_API_URL || "https://blockstream.info/api",
        rateLimitMs: parseInt(
          process.env.WATCHER_BITCOIN_RATE_LIMIT_MS || "500",
          10,
        ),
      },
      ethereum: {
        enabled: process.env.WATCHER_ETHEREUM_ENABLED !== "false",
        pollingIntervalMs: parseInt(
          process.env.WATCHER_ETHEREUM_POLL_MS || "15000",
          10,
        ),
        apiKey: process.env.ETHERSCAN_API_KEY || "",
        apiUrl:
          process.env.ETHERSCAN_API_URL || "https://api.etherscan.io/v2/api",
        rateLimitMs: parseInt(
          process.env.WATCHER_ETHEREUM_RATE_LIMIT_MS || "400",
          10,
        ),
      },
      bsc: {
        enabled: process.env.WATCHER_BSC_ENABLED !== "false",
        pollingIntervalMs: parseInt(
          process.env.WATCHER_BSC_POLL_MS || "5000",
          10,
        ),
        // Etherscan V2 API uses a single endpoint for all chains - same API key works
        apiKey:
          process.env.BSCSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "",
        apiUrl:
          process.env.BSCSCAN_API_URL || "https://api.etherscan.io/v2/api",
        rateLimitMs: parseInt(
          process.env.WATCHER_BSC_RATE_LIMIT_MS || "400",
          10,
        ),
      },
      tron: {
        enabled: process.env.WATCHER_TRON_ENABLED !== "false",
        pollingIntervalMs: parseInt(
          process.env.WATCHER_TRON_POLL_MS || "5000",
          10,
        ),
        apiKey: process.env.TRONGRID_API_KEY || "",
        apiUrl: process.env.TRONGRID_API_URL || "https://api.trongrid.io",
        rateLimitMs: parseInt(
          process.env.WATCHER_TRON_RATE_LIMIT_MS || "200",
          10,
        ),
      },
    },
  },

  db: {
    host: process.env.DB_HOST || process.env.host || "localhost",
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: process.env.DB_USER || process.env.user || "root",
    password: process.env.DB_PASSWORD || process.env.password || "",
    database: process.env.DB_NAME || process.env.database || "2settle",
  },

  coinmarketcap: {
    apiKey: process.env.COINMARKETCAP_API_KEY || "",
  },

  mongoro: {
    token: process.env.MONGORO_TOKEN || "",
    transferPin: process.env.MONGORO_TRANSFERPIN || "",
  },

  nubanApiKey: process.env.NUBAN_API_KEY || "",

  // Settlement (Fiat Payout) configuration
  settlement: {
    enabled: process.env.SETTLEMENT_ENABLED === "true",
    provider: "mongoro" as const,
    mongoro: {
      baseUrl:
        process.env.MONGORO_API_URL ||
        "https://api-biz-dev.mongoro.com/api/v1/openapi",
      token: process.env.MONGORO_TOKEN || "",
      transferPin: process.env.MONGORO_TRANSFERPIN || "",
      callbackUrl: process.env.MONGORO_CALLBACK_URL || "",
      webhookIps: process.env.MONGORO_WEBHOOK_IPS
        ? process.env.MONGORO_WEBHOOK_IPS.split(",").map((ip) => ip.trim())
        : [],
    },
    telegram: {
      enabled: process.env.TELEGRAM_ALERTS_ENABLED === "true",
      botToken: process.env.TELEGRAM_BOT_TOKEN || "",
      chatId: process.env.TELEGRAM_CHAT_ID || "",
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    },
  },

  // Admin configuration
  admin: {
    secret: process.env.ADMIN_SECRET || "", // Required for admin endpoints
  },

  // Fee configuration
  fees: {
    // Extra percentage charged on a payer's first transaction (e.g. 0.03 = 3%)
    firstTransactionFeeRate: parseFloat(process.env.FIRST_TRANSACTION_FEE_RATE || "0.03"),
  },

  // Rate Engine configuration
  rateEngine: {
    // How often the background job fetches fresh quotes from external providers (ms)
    fetchIntervalMs: parseInt(process.env.RATE_FETCH_INTERVAL_MS || '30000', 10),
    providers: {
      busha: {
        enabled: process.env.BUSHA_RATE_ENABLED === 'true',
        apiKey: process.env.BUSHA_API_KEY || '',
        apiUrl: process.env.BUSHA_API_URL || 'https://api.busha.co',
      },
      liquidramp: {
        enabled: process.env.LIQUIDRAMP_RATE_ENABLED === 'true',
        apiKey: process.env.LIQUIDRAMP_API_KEY || '',
        apiUrl: process.env.LIQUIDRAMP_API_URL || '',
      },
      anchor: {
        enabled: process.env.ANCHOR_RATE_ENABLED === 'true',
        apiKey: process.env.ANCHOR_API_KEY || '',
        apiUrl: process.env.ANCHOR_API_URL || 'https://api.anchorfis.com',
      },
    },
  },

  // Reportly (Complaint Reporting) configuration
  reportly: {
    adminWebhookUrl: process.env.REPORTLY_ADMIN_WEBHOOK_URL || "",
  },

  // HD Wallet configuration
  hdWallet: {
    enabled: process.env.HD_WALLET_ENABLED === "true",
    seedEncrypted: process.env.HD_SEED_PHRASE_ENCRYPTED || "",
    seedEncryptionKey: process.env.HD_SEED_ENCRYPTION_KEY || "",
    hotWallets: {
      bitcoin: process.env.HOT_WALLET_BITCOIN || "",
      ethereum: process.env.HOT_WALLET_ETHEREUM || "",
      tron: process.env.HOT_WALLET_TRON || "",
    },
  },

  // Sweeper configuration
  sweeper: {
    enabled: process.env.SWEEPER_ENABLED === "true",
    maxRetries: parseInt(process.env.SWEEPER_MAX_RETRIES || "3", 10),
    rpc: {
      ethereum: process.env.ETHEREUM_RPC_URL || "https://eth.llamarpc.com",
      bsc: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
      polygon: process.env.POLYGON_RPC_URL || "",
      base: process.env.BASE_RPC_URL || "",
    },
    thresholds: {
      BTC: parseFloat(process.env.SWEEP_MIN_BTC || "0.0001"),
      ETH: parseFloat(process.env.SWEEP_MIN_ETH || "0.001"),
      BNB: parseFloat(process.env.SWEEP_MIN_BNB || "0.01"),
      TRX: parseFloat(process.env.SWEEP_MIN_TRX || "10"),
      USDT: parseFloat(process.env.SWEEP_MIN_USDT || "1"),
      USDC: parseFloat(process.env.SWEEP_MIN_USDC || "1"),
    },
    // Tron energy rental — rent energy instead of pre-funding TRX
    energyRental: {
      enabled: process.env.TRON_ENERGY_RENTAL_ENABLED === "true",
      energyAmount: parseInt(process.env.TRON_ENERGY_AMOUNT || "65000", 10),
      durationSec: parseInt(process.env.TRON_ENERGY_DURATION_SEC || "600", 10),
      tronsave: {
        apiKey: process.env.TRONSAVE_API_KEY || "",
        apiUrl:
          process.env.TRONSAVE_API_URL || "https://api.tronsave.io/v2",
      },
      tronzap: {
        apiKey: process.env.TRONZAP_API_KEY || "",
        apiSecret: process.env.TRONZAP_API_SECRET || "",
        apiUrl: process.env.TRONZAP_API_URL || "https://api.tronzap.com/v1",
      },
      tronenergyrent: {
        apiKey: process.env.TRONENERGYRENT_API_KEY || "",
        apiUrl:
          process.env.TRONENERGYRENT_API_URL ||
          "https://api.tronenergyrent.com",
      },
    },
  },

  // End-user authentication (phone/email/wallet/Google login for the app)
  auth: {
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET || "",
      accessExpiresInSec: parseInt(
        process.env.JWT_ACCESS_EXPIRES_IN_SEC || "900",
        10,
      ), // 15 minutes
      refreshExpiresInDays: parseInt(
        process.env.JWT_REFRESH_EXPIRES_IN_DAYS || "30",
        10,
      ),
    },

    otp: {
      codeLength: parseInt(process.env.OTP_CODE_LENGTH || "6", 10),
      expiresInSec: parseInt(process.env.OTP_EXPIRES_IN_SEC || "300", 10), // 5 minutes
      resendCooldownSec: parseInt(
        process.env.OTP_RESEND_COOLDOWN_SEC || "60",
        10,
      ),
      maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || "5", 10),
    },

    email: {
      enabled: process.env.EMAIL_OTP_ENABLED === "true",
      smtpHost: process.env.SMTP_HOST || "",
      smtpPort: parseInt(process.env.SMTP_PORT || "587", 10),
      smtpUser: process.env.SMTP_USER || "",
      smtpPassword: process.env.SMTP_PASSWORD || "",
      fromAddress: process.env.EMAIL_OTP_FROM || "no-reply@2settle.com",
    },

    sms: {
      enabled: process.env.SMS_OTP_ENABLED === "true",
      // "generic" (bring-your-own HTTP gateway), "africastalking", "sendchamp", or "twilio"
      provider: process.env.SMS_PROVIDER || "generic",
      senderId: process.env.SMS_SENDER_ID || "2Settle",

      // Generic HTTP gateway - point this at whichever SMS provider you use.
      // gatewayUrl receives a POST with { to, message, senderId } as JSON,
      // Authorization: Bearer <apiKey>.
      gatewayUrl: process.env.SMS_GATEWAY_URL || "",
      apiKey: process.env.SMS_GATEWAY_API_KEY || "",

      africastalking: {
        apiKey: process.env.AFRICASTALKING_API_KEY || "",
        username: process.env.AFRICASTALKING_USERNAME || "",
        baseUrl:
          process.env.AFRICASTALKING_BASE_URL ||
          "https://api.africastalking.com/version1/messaging",
      },

      sendchamp: {
        apiKey: process.env.SENDCHAMP_API_KEY || "",
        senderName: process.env.SENDCHAMP_SENDER_NAME || "2Settle",
        // "dnd" (default, delivers to Do-Not-Disturb lines in Nigeria),
        // "non_dnd", or "international"
        route: process.env.SENDCHAMP_ROUTE || "dnd",
        baseUrl:
          process.env.SENDCHAMP_BASE_URL || "https://api.sendchamp.com/api/v1",
      },

      twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || "",
        authToken: process.env.TWILIO_AUTH_TOKEN || "",
        // Optional - an API Key (SK...) + secret is used instead of the
        // Auth Token when set.
        apiKeySid: process.env.TWILIO_API_KEY_SID || "",
        apiKeySecret: process.env.TWILIO_API_KEY_SECRET || "",
        // Sender: a Messaging Service SID (MG..., preferred) or a single
        // Twilio number / alphanumeric sender ID in TWILIO_FROM.
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || "",
        from: process.env.TWILIO_FROM || "",
        baseUrl:
          process.env.TWILIO_BASE_URL || "https://api.twilio.com/2010-04-01",
      },
    },

    google: {
      // Comma-separated for multi-platform support (web/iOS/Android each get
      // their own OAuth client ID from Google, but all issue tokens your
      // backend must accept).
      clientIds: (process.env.GOOGLE_CLIENT_ID || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    },

    wallet: {
      nonceExpiresInSec: parseInt(
        process.env.WALLET_NONCE_EXPIRES_IN_SEC || "300",
        10,
      ), // 5 minutes
      messageStatement:
        process.env.WALLET_SIGN_MESSAGE || "Sign in to 2Settle",
    },
  },

  // Security configuration
  security: {
    // HMAC signature settings
    hmac: {
      algorithm: "sha256",
      timestampToleranceMs: parseInt(
        process.env.HMAC_TIMESTAMP_TOLERANCE_MS || "300000",
        10,
      ), // 5 minutes
    },

    // Rate limiting settings
    rateLimit: {
      enabled: process.env.RATE_LIMIT_ENABLED !== "false",
      standard: {
        windowMs: parseInt(
          process.env.RATE_LIMIT_STANDARD_WINDOW_MS || "60000",
          10,
        ), // 1 minute
        maxRequests: parseInt(process.env.RATE_LIMIT_STANDARD_MAX || "100", 10),
      },
      premium: {
        windowMs: parseInt(
          process.env.RATE_LIMIT_PREMIUM_WINDOW_MS || "60000",
          10,
        ),
        maxRequests: parseInt(process.env.RATE_LIMIT_PREMIUM_MAX || "1000", 10),
      },
      unlimited: {
        windowMs: parseInt(
          process.env.RATE_LIMIT_UNLIMITED_WINDOW_MS || "60000",
          10,
        ),
        maxRequests: parseInt(
          process.env.RATE_LIMIT_UNLIMITED_MAX || "10000",
          10,
        ),
      },
    },

    // IP whitelisting settings
    ipWhitelist: {
      enabled: process.env.IP_WHITELIST_ENABLED !== "false",
    },

    // Audit logging settings
    audit: {
      enabled: process.env.AUDIT_LOG_ENABLED !== "false",
      logRequestBody: process.env.AUDIT_LOG_REQUEST_BODY === "true", // Default false for security
      retentionDays: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || "90", 10),
    },

    // Paths that don't require HMAC authentication
    // (admin routes use separate Bearer token auth, webhooks use provider signatures)
    publicPaths: [
      "/",
      "/v1/health",
      "/v1/rate/*",
      "/v1/banks/list",
      "/v1/admin/*",
      "/v1/webhooks/*",
      "/v1/auth/*",
      "/v1/users/*",
      "/v1/payments/:reference",
      "/v1/reports/lookup",
      "/v1/reports/:reportId",
    ],
  },
};

export default config;
