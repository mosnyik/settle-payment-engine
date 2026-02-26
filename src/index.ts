import express, { Request, Response } from 'express';
import cors from 'cors';
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
import dotenv from "dotenv";
dotenv.config();

const app = express();

// =============================================================================
// SECURITY MIDDLEWARE (Order matters!)
// =============================================================================

// 1. Security headers (always first - applies to all responses)
app.use(securityHeaders);

// 2. Request context (generates request ID, captures timing)
app.use(requestContext);

// 3. CORS (before body parsing)
app.use(cors());

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

// Health check (public, no auth required)
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/', routes);

// =============================================================================
// ERROR HANDLING
// =============================================================================

app.use(notFoundHandler);
app.use(errorHandler);

// =============================================================================
// START SERVER
// =============================================================================

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`Payment Engine running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Security: API Key + HMAC authentication enabled`);

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
  const { stopDepositWatcher } = await import('./services/payment-engine/watcher');
  await stopDepositWatcher();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  const { stopDepositWatcher } = await import('./services/payment-engine/watcher');
  await stopDepositWatcher();
  process.exit(0);
});

export default app;
