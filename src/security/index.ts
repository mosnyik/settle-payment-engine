/**
 * Security Module
 *
 * Provides comprehensive security features for the payment engine:
 * - API Key + HMAC signature authentication
 * - Rate limiting (per API key with tiered limits)
 * - IP whitelisting (per API key)
 * - Security headers
 * - Audit logging
 */

// Types
export * from './types';

// Middleware
export {
  authenticate,
  optionalAuthenticate,
  requirePermission,
  requestContext,
  rateLimit,
  getRateLimitStatus,
  ipWhitelist,
  securityHeaders,
  auditLog,
  attachErrorForAudit,
} from './middleware';

// Services
export {
  // HMAC
  generateSignature,
  verifySignature,
  validateTimestamp,
  parseAuthHeaders,
  // API Keys
  createApiKey,
  getApiKeyById,
  getApiKeyByKeyId,
  validateApiKey,
  getActiveApiKey,
  updateLastUsed,
  listApiKeysByMerchant,
  revokeApiKey,
  updateApiKey,
  hasPermission,
  // Audit Logs
  createAuditLog,
  queryAuditLogs,
  getAuditLogByRequestId,
  cleanupAuditLogs,
} from './services';

// Utils
export {
  generateSecureToken,
  generateUUID,
  generateApiKeyPair,
  sha256,
  hmacSha256,
  secureCompare,
  hashRequestBody,
} from './utils';
