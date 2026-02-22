import { Request, Response, NextFunction } from 'express';
import { AuthenticationError } from '../types';
import { parseAuthHeaders, validateTimestamp, verifySignature } from '../services/hmac.service';
import { getActiveApiKey, updateLastUsed } from '../services/apiKey.service';
import { sha256 } from '../utils/crypto';
import config from '../../config';

/**
 * Authentication Middleware
 * Validates API key and HMAC signature for protected routes
 */

/**
 * Check if a path should skip authentication
 */
function isPublicPath(path: string): boolean {
  const publicPaths = config.security.publicPaths;
  return publicPaths.some((publicPath) => {
    // Exact match
    if (publicPath === path) return true;

    // Wildcard match (e.g., "/rate/*" matches "/rate/current")
    if (publicPath.endsWith('/*')) {
      const prefix = publicPath.slice(0, -2);
      return path.startsWith(prefix + '/') || path === prefix;
    }

    return false;
  });
}

/**
 * Main authentication middleware
 */
export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip authentication for public paths
  if (isPublicPath(req.path)) {
    return next();
  }

  authenticateAsync(req)
    .then(() => next())
    .catch(next);
}

/**
 * Async authentication logic
 */
async function authenticateAsync(req: Request): Promise<void> {
  // Parse required headers
  const { apiKey: keyId, timestamp, signature } = parseAuthHeaders(req.headers);

  // Validate timestamp is within acceptable window
  validateTimestamp(timestamp);

  // Get API key from database
  const apiKey = await getActiveApiKey(keyId);

  // Get the raw body for signature verification
  // Note: Express parses JSON automatically, so we need to reconstruct it
  const bodyString = JSON.stringify(req.body || {});
  const bodyHash = sha256(bodyString);

  // Verify HMAC signature
  // The client should sign: timestamp|METHOD|path|bodyHash
  // Using their secret key (which we have the hash of in DB)

  // For HMAC verification, we need the original secret key
  // Since we only store the hash, we verify by:
  // 1. Client sends signature = HMAC(secretKey, payload)
  // 2. We reconstruct expected signature using the stored keyHash as a shared secret
  //
  // IMPORTANT: In production, you'd typically have a different approach:
  // Either store the secret encrypted (not just hashed), or use asymmetric keys
  // For this implementation, we'll use the keyHash as a derived key for HMAC

  const isValid = verifySignature(
    apiKey.keyHash, // Using hash as the HMAC key (client must use same)
    signature,
    timestamp,
    req.method,
    req.path,
    req.body
  );

  if (!isValid) {
    throw new AuthenticationError('Invalid signature', 'INVALID_SIGNATURE');
  }

  // Attach API key to request for use in downstream middleware/handlers
  req.apiKey = apiKey;

  // Update last used timestamp (fire and forget)
  updateLastUsed(keyId).catch((err) => {
    console.error('[Auth] Failed to update last_used_at:', err);
  });
}

/**
 * Optional authentication middleware
 * Attaches API key if present, but doesn't require it
 */
export function optionalAuthenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // If no auth headers present, skip authentication
  if (!req.headers['x-api-key']) {
    return next();
  }

  // Otherwise, validate authentication
  authenticate(req, res, next);
}

/**
 * Permission check middleware factory
 * Use after authenticate middleware to check specific permissions
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.apiKey) {
      return next(new AuthenticationError('Authentication required', 'AUTH_REQUIRED'));
    }

    const { hasPermission } = require('../services/apiKey.service');

    if (!hasPermission(req.apiKey, permission)) {
      return next(new AuthenticationError(
        `Permission denied: ${permission}`,
        'PERMISSION_DENIED'
      ));
    }

    next();
  };
}
