import crypto from 'crypto';

/**
 * Cryptographic utilities for security operations
 */

/**
 * Generate a cryptographically secure random string
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Generate an API key pair (public key ID and secret key)
 */
export function generateApiKeyPair(): { keyId: string; secretKey: string } {
  const keyId = `pk_${generateSecureToken(16)}`;
  const secretKey = `sk_${generateSecureToken(32)}`;
  return { keyId, secretKey };
}

/**
 * Hash a value using SHA-256
 */
export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Generate HMAC-SHA256 signature
 */
export function hmacSha256(key: string, data: string): string {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Hash a request body for audit logging (doesn't store sensitive data)
 */
export function hashRequestBody(body: unknown): string {
  const bodyString = typeof body === 'string' ? body : JSON.stringify(body || {});
  return sha256(bodyString);
}
