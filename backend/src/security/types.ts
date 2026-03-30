/**
 * Security Module Types
 * Defines all security-related data structures for the payment engine
 */

// =============================================================================
// API KEY TYPES
// =============================================================================

export type RateLimitTier = 'standard' | 'premium' | 'unlimited';

export interface ApiKey {
  id: number;
  keyId: string;
  keyHash: string;
  merchantId: string;
  name: string;
  permissions: string[];
  rateLimitTier: RateLimitTier;
  ipWhitelist: string[] | null;
  isActive: boolean;
  expiresAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  // Wallet-as-a-Service fields
  webhookUrl: string | null;
  webhookSecret: string | null;
  sweepAddress: string | null;
  settlementMode: 'mongoro' | 'paystack' | 'self';
  // Per-key merchant wallets
  fundingWalletIndex: number | null;
  fundingWalletBitcoin: string | null;
  fundingWalletEthereum: string | null;
  fundingWalletTron: string | null;
  parentWalletBitcoin: string | null;
  parentWalletEthereum: string | null;
  parentWalletTron: string | null;
}

export interface CreateApiKeyInput {
  merchantId: string;
  name: string;
  permissions?: string[];
  rateLimitTier?: RateLimitTier;
  ipWhitelist?: string[];
  expiresAt?: Date;
  // Wallet-as-a-Service fields
  webhookUrl?: string;
  sweepAddress?: string;
  settlementMode?: 'mongoro' | 'self';
}

export interface ApiKeyWithSecret {
  apiKey: Omit<ApiKey, 'keyHash' | 'webhookSecret'>;
  secretKey: string; // Only returned once on creation
}

// =============================================================================
// REQUEST AUGMENTATION
// Extends Express Request with security properties
// =============================================================================

declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKey;
      requestId?: string;
      requestTimestamp?: Date;
      startTime?: number;
    }
  }
}

// Legacy type alias for backwards compatibility
export type AuthenticatedRequest = Express.Request;

export interface HmacPayload {
  timestamp: number;
  method: string;
  path: string;
  bodyHash: string;
}

// =============================================================================
// AUDIT LOG TYPES
// =============================================================================

export interface AuditLogEntry {
  requestId: string;
  apiKeyId?: string;
  merchantId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  method: string;
  path: string;
  ipAddress: string;
  userAgent?: string;
  requestBodyHash?: string;
  statusCode?: number;
  responseTimeMs?: number;
  success?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

// =============================================================================
// RATE LIMITING TYPES
// =============================================================================

export interface RateLimitTierConfig {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  standard: RateLimitTierConfig;
  premium: RateLimitTierConfig;
  unlimited: RateLimitTierConfig;
}

// =============================================================================
// TIER LIMITS
// =============================================================================

export interface TierLimits {
  // Rate limiting
  requestsPerMinute: number;
  requestsPerMonth: number;

  // Wallet limits
  walletsPerMonth: number;
  maxConcurrentWatches: number;

  // Wallet expiration (in minutes)
  defaultWalletExpiryMinutes: number;
  maxWalletExpiryMinutes: number;
}

/**
 * Tier limit configurations
 * These define the limits for each API key tier
 */
export const TIER_LIMITS: Record<RateLimitTier, TierLimits> = {
  standard: {
    requestsPerMinute: 60,
    requestsPerMonth: 50_000,
    walletsPerMonth: 1_000,
    maxConcurrentWatches: 100,
    defaultWalletExpiryMinutes: 60, // 1 hour
    maxWalletExpiryMinutes: 24 * 60, // 24 hours
  },
  premium: {
    requestsPerMinute: 500,
    requestsPerMonth: 1_000_000,
    walletsPerMonth: 50_000,
    maxConcurrentWatches: 1_000,
    defaultWalletExpiryMinutes: 24 * 60, // 24 hours
    maxWalletExpiryMinutes: 7 * 24 * 60, // 7 days
  },
  unlimited: {
    requestsPerMinute: 1_000,
    requestsPerMonth: -1, // Uncapped
    walletsPerMonth: -1, // Uncapped
    maxConcurrentWatches: 10_000,
    defaultWalletExpiryMinutes: 7 * 24 * 60, // 7 days
    maxWalletExpiryMinutes: 30 * 24 * 60, // 30 days
  },
};

/**
 * Get tier limits for a given tier
 */
export function getTierLimits(tier: RateLimitTier): TierLimits {
  return TIER_LIMITS[tier];
}

export interface RateLimitState {
  keyIdentifier: string;
  windowStart: Date;
  requestCount: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfterMs?: number;
}

// =============================================================================
// SECURITY CONFIG TYPES
// =============================================================================

export interface HmacConfig {
  algorithm: string;
  timestampToleranceMs: number;
}

export interface IpWhitelistConfig {
  enabled: boolean;
}

export interface AuditConfig {
  enabled: boolean;
  logRequestBody: boolean;
}

export interface SecurityConfig {
  hmac: HmacConfig;
  rateLimit: RateLimitConfig;
  ipWhitelist: IpWhitelistConfig;
  audit: AuditConfig;
  publicPaths: string[];
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export class SecurityError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401,
    public code: string = 'SECURITY_ERROR'
  ) {
    super(message);
    this.name = 'SecurityError';
  }
}

export class QuotaExceededError extends SecurityError {
  constructor(
    message: string,
    public quotaType: 'requests' | 'wallets' | 'watches'
  ) {
    super(message, 429, 'QUOTA_EXCEEDED');
    this.name = 'QuotaExceededError';
  }
}

export class AuthenticationError extends SecurityError {
  constructor(message: string, code: string = 'AUTHENTICATION_FAILED') {
    super(message, 401, code);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends SecurityError {
  constructor(message: string, code: string = 'AUTHORIZATION_FAILED') {
    super(message, 403, code);
    this.name = 'AuthorizationError';
  }
}

export class RateLimitError extends SecurityError {
  constructor(
    message: string,
    public retryAfterMs: number
  ) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
    this.name = 'RateLimitError';
  }
}

export class IpNotAllowedError extends SecurityError {
  constructor(ip: string) {
    super(`IP address ${ip} is not allowed`, 403, 'IP_NOT_ALLOWED');
    this.name = 'IpNotAllowedError';
  }
}
