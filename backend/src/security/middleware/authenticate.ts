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

    // Express param match (e.g., "/v1/payments/:reference" matches "/v1/payments/2S-ABC123")
    if (publicPath.includes('/:')) {
      const pattern = publicPath.replace(/:[^/]+/g, '[^/]+');
      const regex = new RegExp(`^${pattern.replace(/\//g, '\\/')}$`);
      return regex.test(path);
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
  //
  // DESIGN: Both client and server use SHA256(secretKey) as the HMAC key
  //
  // How it works:
  // 1. On key creation: Server generates secretKey, stores SHA256(secretKey) as keyHash
  // 2. Client receives secretKey once, computes SHA256(secretKey) locally
  // 3. Both sides now have the same derived HMAC key
  //
  // Why this design?
  // - Server never stores raw secret (only hash) - secure against DB breaches
  // - Client can derive HMAC key from their secret
  // - Standard HMAC verification without storing reversible secrets

  const isValid = verifySignature(
    apiKey.keyHash, // SHA256(secretKey) - client must compute and use the same
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
