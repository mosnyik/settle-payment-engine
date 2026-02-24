import { Request, Response, NextFunction } from 'express';
import { AuthenticationError } from '../types';
import config from '../../config';

/**
 * Admin Authentication Middleware
 * Protects admin endpoints with a simple Bearer token
 *
 * Usage:
 *   Set ADMIN_SECRET in environment
 *   Send header: Authorization: Bearer <ADMIN_SECRET>
 */

export function adminAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const adminSecret = config.admin.secret;

  // Check if admin secret is configured
  if (!adminSecret) {
    return next(new AuthenticationError(
      'Admin endpoints are not configured. Set ADMIN_SECRET environment variable.',
      'ADMIN_NOT_CONFIGURED'
    ));
  }

  // Get authorization header
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return next(new AuthenticationError(
      'Missing Authorization header',
      'MISSING_AUTH_HEADER'
    ));
  }

  // Parse Bearer token
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return next(new AuthenticationError(
      'Invalid Authorization header format. Use: Bearer <token>',
      'INVALID_AUTH_FORMAT'
    ));
  }

  const token = parts[1];

  // Validate token
  if (token !== adminSecret) {
    return next(new AuthenticationError(
      'Invalid admin token',
      'INVALID_ADMIN_TOKEN'
    ));
  }

  next();
}
