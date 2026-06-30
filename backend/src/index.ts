import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import timeout from 'connect-timeout';
import config from './config';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import {
  securityHeaders,
  requestContext,
  auditLog,
  authenticate,
  ipWhitelist,
  rateLimit,
} from './security';
import { createDepositWatcher, WatcherConfig } from './services/payment-engine/watcher';
import { createHDWalletService, destroyHDWalletService } from './services/payment-engine/hd-wallet';
import { createSweeperService, destroySweeperService, SweeperConfig } from './services/payment-engine/sweeper';
import { startRateFetchJob, stopRateFetchJob } from './services/payment-engine/rate';
import dotenv from "dotenv";
import path from "path";
// In Docker the env vars come from docker-compose. For local dev, load from
// root .env (one level above backend/) so a single file covers both contexts.
dotenv.config({ path: path.join(__dirname, '../../.env') });

const app = express();

// =============================================================================
// SECURITY MIDDLEWARE (Order matters!)
// =============================================================================

// 1. Global timeout — 15s default; settlement endpoints get 30s (overridden per route)
app.use(timeout('15s'));
app.use((req: Request, res: Response, next: NextFunction) => {
  if ((req as any).timedout) return;
  next();
});

// 2. Security headers (always first - applies to all responses)
app.use(securityHeaders);

// 2. Request context (generates request ID, captures timing)
app.use(requestContext);

// 3. CORS (before body parsing)
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : ['http://localhost:3000'];

app.use(cors({
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Timestamp', 'X-Signature'],
  credentials: true,
}));

// 4. Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 5. Audit logging (captures request details, hooks into response)
app.use(auditLog);

// 6. Authentication (validates API key + HMAC signature, skips public paths)
app.use(authenticate);

// 7. IP whitelist check (validates client IP against API key whitelist)
app.use(ipWhitelist);

// 8. Rate limiting (enforces request limits per API key tier)
app.use(rateLimit);

// =============================================================================
// ROUTES
// =============================================================================

// Root path
app.get("/", (req: Request, res: Response) => {
  res.json({
    name: "2Settle Payment Engine",
    version: "1.0.0",
    base: "/v1",
    health: "/v1/health",
  });
});

// Health check (public, no auth required)
app.get("/v1/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API routes
app.use("/v1", routes);

// =============================================================================
// ERROR HANDLING
// =============================================================================

app.use(notFoundHandler);
app.use(errorHandler);

// =============================================================================
// START SERVER
// =============================================================================

const PORT = config.port;

app.listen(PORT, async () => {
  console.log(`Payment Engine running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/v1/health`);
  console.log(`Security: API Key + HMAC authentication enabled`);

  // Initialize HD Wallet if enabled
  if (config.hdWallet.enabled) {
    try {
      await createHDWalletService(
        config.hdWallet.seedEncrypted,
        config.hdWallet.seedEncryptionKey,
        config.hdWallet.hotWallets
      );
      console.log('HD Wallet: Initialized');
    } catch (err) {
      console.error('HD Wallet: Failed to initialize:', err);
    }
  } else {
    console.log('HD Wallet: Disabled (set HD_WALLET_ENABLED=true to enable)');
  }

  // Initialize Sweeper if enabled
  if (config.sweeper.enabled && config.hdWallet.enabled) {
    try {
      const sweeperConfig: SweeperConfig = {
        enabled: config.sweeper.enabled,
        maxRetries: config.sweeper.maxRetries,
        hotWallets: config.hdWallet.hotWallets,
        rpc: config.sweeper.rpc,
        thresholds: config.sweeper.thresholds,
      };
      await createSweeperService(sweeperConfig);
      console.log('Sweeper: Initialized');
    } catch (err) {
      console.error('Sweeper: Failed to initialize:', err);
    }
  } else {
    console.log('Sweeper: Disabled (requires HD_WALLET_ENABLED=true and SWEEPER_ENABLED=true)');
  }

  // Start rate fetch job (polls external providers; writes to provider_rates table)
  startRateFetchJob(config.rateEngine.fetchIntervalMs);

  // Start deposit watcher if enabled
  if (config.watcher.enabled) {
    const watcherConfig = config.watcher as WatcherConfig;
    const watcher = createDepositWatcher(watcherConfig);

    watcher.on('watcher_event', (event) => {
      const { type, chain, sessionId, txHash, details } = event;
      const parts = [`[Watcher] ${type}`];
      if (chain) parts.push(`chain=${chain}`);
      if (sessionId) parts.push(`session=${sessionId.slice(0, 8)}...`);
      if (txHash) parts.push(`tx=${txHash.slice(0, 12)}...`);
      if (details && Object.keys(details).length > 0) {
        parts.push(JSON.stringify(details));
      }
      console.log(parts.join(' '));
    });

    watcher
      .start()
      .then(() => {
        console.log(`Deposit Watcher: Ready for ${watcher.getEnabledChains().join(', ')}`);
        console.log('Deposit Watcher: Will start polling when sessions are created');
      })
      .catch((err) => {
        console.error('Failed to start Deposit Watcher:', err);
      });
  } else {
    console.log('Deposit Watcher: Disabled (set WATCHER_ENABLED=true to enable)');
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  stopRateFetchJob();
  const { stopDepositWatcher } = await import('./services/payment-engine/watcher');
  await stopDepositWatcher();
  destroySweeperService();
  destroyHDWalletService();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  stopRateFetchJob();
  const { stopDepositWatcher } = await import('./services/payment-engine/watcher');
  await stopDepositWatcher();
  destroySweeperService();
  destroyHDWalletService();
  process.exit(0);
});

export default app;
