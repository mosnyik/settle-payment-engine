import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { PaymentEngineError } from '../services/payment-engine/errors';
import {
  SecurityError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  attachErrorForAudit,
} from '../security';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  retryAfterMs?: number;
}

export function errorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Log error (but not for expected client errors)
  if (!err.statusCode || err.statusCode >= 500) {
    console.error(`[Error] ${req.method} ${req.path}:`, err);
  }

  // Attach error info for audit logging
  attachErrorForAudit(res, {
    code: err.code || err.name,
    message: err.message,
  });

  // Handle timeout errors
  if (err.code === 'ETIMEDOUT' || (err as any).timeout) {
    res.status(503).json({
      error: 'Request timed out. Please try again.',
      code: 'REQUEST_TIMEOUT',
    });
    return;
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.flatten(),
    });
    return;
  }

  // Handle Rate Limit errors (need special header)
  if (err instanceof RateLimitError) {
    res.setHeader('Retry-After', Math.ceil(err.retryAfterMs / 1000).toString());
    res.status(429).json({
      error: err.message,
      code: err.code,
      retryAfter: Math.ceil(err.retryAfterMs / 1000),
    });
    return;
  }

  // Handle Security errors (auth, authz, IP)
  if (err instanceof SecurityError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  // Handle Payment Engine errors
  if (err instanceof PaymentEngineError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  // Handle known error codes
  const statusCode = err.statusCode || 500;
  const message = statusCode === 500 ? 'Internal server error' : err.message;

  res.status(statusCode).json({
    error: message,
    ...(err.code && { code: err.code }),
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  // Attach error info for audit logging
  attachErrorForAudit(res, {
    code: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found`,
  });

  res.status(404).json({
    error: `Route ${req.method} ${req.path} not found`,
    code: 'NOT_FOUND',
  });
}
