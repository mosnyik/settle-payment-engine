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
});

export default app;
