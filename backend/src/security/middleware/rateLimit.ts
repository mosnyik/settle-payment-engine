import { Request, Response, NextFunction } from 'express';
import { RateLimitError, RateLimitTier } from '../types';
import config from '../../config';

/**
 * Rate Limiting Middleware
 * Implements sliding window rate limiting per API key
 */

// In-memory store for rate limiting
// In production, consider using Redis for distributed rate limiting
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitStore: Map<string, RateLimitEntry> = new Map();

/**
 * Get rate limit configuration for a tier
 */
function getTierConfig(tier: RateLimitTier): { windowMs: number; maxRequests: number } {
  const rateLimitConfig = config.security.rateLimit;
  return rateLimitConfig[tier] || rateLimitConfig.standard;
}

/**
 * Get the identifier for rate limiting
 * Uses API key if authenticated, otherwise falls back to IP
 */
function getRateLimitKey(req: Request): string {
  if (req.apiKey) {
    return `apikey:${req.apiKey.keyId}`;
  }
  return `ip:${getClientIp(req)}`;
}

/**
 * Get client IP address
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Clean up expired rate limit entries periodically
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  const maxWindowMs = Math.max(
    config.security.rateLimit.standard.windowMs,
    config.security.rateLimit.premium.windowMs,
    config.security.rateLimit.unlimited.windowMs
  );

  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart > maxWindowMs * 2) {
      rateLimitStore.delete(key);
    }
  }
}

// Clean up every minute
setInterval(cleanupExpiredEntries, 60000);

/**
 * Rate limiting middleware
 */
export function rateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip if rate limiting is disabled
  if (!config.security.rateLimit.enabled) {
    return next();
  }

  const key = getRateLimitKey(req);
  const tier: RateLimitTier = req.apiKey?.rateLimitTier || 'standard';
  const { windowMs, maxRequests } = getTierConfig(tier);

  const now = Date.now();
  let entry = rateLimitStore.get(key);

  // Create new window if doesn't exist or window expired
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { count: 0, windowStart: now };
  }

  // Increment request count
  entry.count++;
  rateLimitStore.set(key, entry);

  // Calculate remaining requests and reset time
  const remaining = Math.max(0, maxRequests - entry.count);
  const resetAt = new Date(entry.windowStart + windowMs);

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', maxRequests.toString());
  res.setHeader('X-RateLimit-Remaining', remaining.toString());
  res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt.getTime() / 1000).toString());

  // Check if rate limit exceeded
  if (entry.count > maxRequests) {
    const retryAfterMs = entry.windowStart + windowMs - now;
    res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000).toString());

    return next(new RateLimitError(
      `Rate limit exceeded. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`,
      retryAfterMs
    ));
  }

  next();
}

/**
 * Get current rate limit status for a request
 */
export function getRateLimitStatus(req: Request): {
  limit: number;
  remaining: number;
  resetAt: Date;
} | null {
  const key = getRateLimitKey(req);
  const entry = rateLimitStore.get(key);

  if (!entry) {
    return null;
  }

  const tier: RateLimitTier = req.apiKey?.rateLimitTier || 'standard';
  const { windowMs, maxRequests } = getTierConfig(tier);

  return {
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - entry.count),
    resetAt: new Date(entry.windowStart + windowMs),
  };
}
