/**
 * Deprecation Middleware
 *
 * Adds deprecation warnings to legacy routes during migration period.
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Create deprecation middleware for a route.
 *
 * @param message - Deprecation message
 * @param sunsetDate - Optional date when route will be removed
 * @returns Express middleware
 */
export function deprecationWarning(
  message: string,
  sunsetDate?: string
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    // Add deprecation headers
    res.setHeader('Deprecation', 'true');
    res.setHeader('X-Deprecation-Notice', message);

    if (sunsetDate) {
      res.setHeader('Sunset', sunsetDate);
    }

    // Log deprecation warning
    console.warn(
      `[Deprecation] ${req.method} ${req.originalUrl} - ${message}`
    );

    next();
  };
}

/**
 * Pre-configured deprecation middleware for legacy payment routes.
 */
export const deprecateTransferRoutes = deprecationWarning(
  'Use POST /payments with type=transfer instead'
);

export const deprecateGiftRoutes = deprecationWarning(
  'Use POST /payments with type=gift instead'
);

export const deprecateRequestRoutes = deprecationWarning(
  'Use POST /payments with type=request instead'
);

export const deprecateTransactionRoutes = deprecationWarning(
  'Use /payments endpoints instead'
);
