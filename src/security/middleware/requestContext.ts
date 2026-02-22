import { Request, Response, NextFunction } from 'express';
import { generateUUID } from '../utils/crypto';

/**
 * Request Context Middleware
 * Sets up request ID and timing for correlation and audit logging
 */

export function requestContext(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Generate or use provided request ID
  const providedRequestId = req.headers['x-request-id'];
  req.requestId = typeof providedRequestId === 'string' ? providedRequestId : generateUUID();
  req.requestTimestamp = new Date();
  req.startTime = Date.now();

  // Set request ID in response headers for correlation
  res.setHeader('X-Request-ID', req.requestId);

  next();
}
