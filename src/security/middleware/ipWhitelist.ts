import { Request, Response, NextFunction } from 'express';
import { IpNotAllowedError } from '../types';
import config from '../../config';

/**
 * IP Whitelist Middleware
 * Validates client IP against API key's allowed IP list
 */

/**
 * Get client IP address
 */
function getClientIp(req: Request): string {
  // Check X-Forwarded-For header (for proxied requests)
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }

  // Check X-Real-IP header (for nginx proxies)
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string') {
    return realIp;
  }

  // Fall back to socket remote address
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Normalize IPv6-mapped IPv4 addresses
 * e.g., "::ffff:192.168.1.1" -> "192.168.1.1"
 */
function normalizeIp(ip: string): string {
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip;
}

/**
 * Parse CIDR notation to get network and mask bits
 */
function parseCidr(cidr: string): { ip: string; bits: number } | null {
  const parts = cidr.split('/');
  if (parts.length !== 2) {
    return null;
  }

  const bits = parseInt(parts[1], 10);
  if (isNaN(bits) || bits < 0 || bits > 128) {
    return null;
  }

  return { ip: parts[0], bits };
}

/**
 * Convert IPv4 address to 32-bit number
 */
function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }

  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) {
      return null;
    }
    result = (result << 8) | num;
  }

  return result >>> 0; // Convert to unsigned
}

/**
 * Check if an IP matches a CIDR range (IPv4 only for now)
 */
function ipMatchesCidr(clientIp: string, cidr: string): boolean {
  const parsed = parseCidr(cidr);
  if (!parsed) {
    return false;
  }

  const clientNum = ipv4ToNumber(clientIp);
  const cidrNum = ipv4ToNumber(parsed.ip);

  if (clientNum === null || cidrNum === null) {
    return false;
  }

  // Create mask from bits
  const mask = parsed.bits === 0 ? 0 : (~0 << (32 - parsed.bits)) >>> 0;

  return (clientNum & mask) === (cidrNum & mask);
}

/**
 * Check if client IP is in the whitelist
 */
function isIpAllowed(clientIp: string, whitelist: string[]): boolean {
  const normalizedClientIp = normalizeIp(clientIp);

  for (const entry of whitelist) {
    // Check for CIDR notation
    if (entry.includes('/')) {
      if (ipMatchesCidr(normalizedClientIp, entry)) {
        return true;
      }
      continue;
    }

    // Exact match
    if (normalizeIp(entry) === normalizedClientIp) {
      return true;
    }
  }

  return false;
}

/**
 * IP whitelist middleware
 */
export function ipWhitelist(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip if IP whitelisting is disabled
  if (!config.security.ipWhitelist.enabled) {
    return next();
  }

  // Skip if no API key (public endpoint)
  if (!req.apiKey) {
    return next();
  }

  // Skip if no whitelist configured for this key (allow all)
  const whitelist = req.apiKey.ipWhitelist;
  if (!whitelist || whitelist.length === 0) {
    return next();
  }

  // Get client IP
  const clientIp = getClientIp(req);

  // Check if IP is allowed
  if (!isIpAllowed(clientIp, whitelist)) {
    return next(new IpNotAllowedError(clientIp));
  }

  next();
}

/**
 * Export helper for testing
 */
export { getClientIp, isIpAllowed, normalizeIp };
