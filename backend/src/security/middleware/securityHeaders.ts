import { Request, Response, NextFunction } from 'express';

/**
 * Security Headers Middleware
 * Adds security-related HTTP headers to all responses
 */

export function securityHeaders(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // XSS protection (legacy, but still useful for older browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Enforce HTTPS (in production)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  // Content Security Policy - very restrictive for API
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'"
  );

  // Referrer Policy - don't leak referrer information
  res.setHeader('Referrer-Policy', 'no-referrer');

  // Permissions Policy - disable all browser features
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
  );

  // Cache Control - prevent caching of sensitive data
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Remove X-Powered-By header (info disclosure)
  res.removeHeader('X-Powered-By');

  next();
}
