import { hmacSha256, sha256, secureCompare } from '../utils/crypto';
import { HmacPayload, AuthenticationError } from '../types';
import config from '../../config';

/**
 * HMAC Service
 * Handles HMAC signature generation and verification for API request authentication
 */

/**
 * Build the string to sign for HMAC signature
 * Format: timestamp|method|path|bodyHash
 */
export function buildSignaturePayload(payload: HmacPayload): string {
  return `${payload.timestamp}|${payload.method.toUpperCase()}|${payload.path}|${payload.bodyHash}`;
}

/**
 * Generate HMAC-SHA256 signature for a request
 */
export function generateSignature(
  secretKey: string,
  timestamp: number,
  method: string,
  path: string,
  body: unknown
): string {
  const bodyString = typeof body === 'string' ? body : JSON.stringify(body || {});
  const bodyHash = sha256(bodyString);

  const payload = buildSignaturePayload({
    timestamp,
    method,
    path,
    bodyHash,
  });

  return hmacSha256(secretKey, payload);
}

/**
 * Verify HMAC signature from request headers
 */
export function verifySignature(
  secretKey: string,
  providedSignature: string,
  timestamp: number,
  method: string,
  path: string,
  body: unknown
): boolean {
  const expectedSignature = generateSignature(secretKey, timestamp, method, path, body);
  return secureCompare(providedSignature, expectedSignature);
}

/**
 * Validate timestamp is within acceptable window
 */
export function validateTimestamp(timestamp: number): void {
  const now = Date.now();
  const toleranceMs = config.security.hmac.timestampToleranceMs;
  const diff = Math.abs(now - timestamp);

  if (diff > toleranceMs) {
    throw new AuthenticationError(
      `Request timestamp is outside acceptable window (${Math.round(toleranceMs / 1000)}s)`,
      'TIMESTAMP_EXPIRED'
    );
  }
}

/**
 * Parse and validate required authentication headers
 */
export function parseAuthHeaders(headers: Record<string, string | string[] | undefined>): {
  apiKey: string;
  timestamp: number;
  signature: string;
} {
  const apiKey = headers['x-api-key'];
  const timestampStr = headers['x-timestamp'];
  const signature = headers['x-signature'];

  if (!apiKey || typeof apiKey !== 'string') {
    throw new AuthenticationError('Missing X-API-Key header', 'MISSING_API_KEY');
  }

  if (!timestampStr || typeof timestampStr !== 'string') {
    throw new AuthenticationError('Missing X-Timestamp header', 'MISSING_TIMESTAMP');
  }

  if (!signature || typeof signature !== 'string') {
    throw new AuthenticationError('Missing X-Signature header', 'MISSING_SIGNATURE');
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    throw new AuthenticationError('Invalid X-Timestamp header', 'INVALID_TIMESTAMP');
  }

  return { apiKey, timestamp, signature };
}
