import { Request, Response, NextFunction } from 'express';
import { AuditLogEntry } from '../types';
import { createAuditLog } from '../services/auditLog.service';
import { hashRequestBody } from '../utils/crypto';
import config from '../../config';

/**
 * Audit Log Middleware
 * Captures request/response details for security audit trail
 */

/**
 * Derive action name from request method and path
 */
function deriveAction(method: string, path: string): string {
  // Remove leading slash and API version prefix (e.g., /v1/)
  let cleanPath = path.replace(/^\//, '');
  if (cleanPath.startsWith('v1/')) {
    cleanPath = cleanPath.substring(3);
  }
  const parts = cleanPath.split('/');

  // Handle common patterns
  if (parts.length === 0 || parts[0] === '') {
    return 'root.access';
  }

  const resource = parts[0];
  let action: string;

  // Map HTTP methods to action verbs
  switch (method.toUpperCase()) {
    case 'GET':
      action = parts.length > 1 ? 'get' : 'list';
      break;
    case 'POST':
      action = 'create';
      break;
    case 'PUT':
    case 'PATCH':
      action = 'update';
      break;
    case 'DELETE':
      action = 'delete';
      break;
    default:
      action = method.toLowerCase();
  }

  return `${resource}.${action}`;
}

/**
 * Extract resource type and ID from path
 */
function extractResource(path: string): { type?: string; id?: string } {
  // Remove leading slash only, keep the full path including version prefix
  const cleanPath = path.replace(/^\//, '');

  if (!cleanPath) {
    return {};
  }

  const parts = cleanPath.split('/');

  // For paths like "v1/payments/2S-ABC123", extract:
  // - type: "v1/payments" (version + resource)
  // - id: "2S-ABC123" (the identifier)
  if (parts.length >= 3 && parts[0] === 'v1') {
    const type = `${parts[0]}/${parts[1]}`; // e.g., "v1/payments"
    const id = parts[2]; // e.g., "2S-ABC123"
    return { type, id };
  }

  // For paths like "v1/health" or "v1/payments"
  if (parts.length >= 2 && parts[0] === 'v1') {
    return { type: cleanPath, id: undefined };
  }

  // Fallback for non-versioned paths
  return { type: cleanPath, id: undefined };
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
 * Audit log middleware - captures request start and hooks into response end
 */
export function auditLog(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip if audit logging is disabled
  if (!config.security.audit.enabled) {
    return next();
  }

  // Skip health check endpoint (too noisy)
  if (req.path === '/v1/health') {
    return next();
  }

  const startTime = req.startTime || Date.now();
  const requestId = req.requestId || 'unknown';

  // Prepare initial audit entry
  const resource = extractResource(req.path);
  const entry: AuditLogEntry = {
    requestId,
    action: deriveAction(req.method, req.path),
    resourceType: resource.type,
    resourceId: resource.id,
    method: req.method,
    path: req.path,
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent']?.substring(0, 500),
  };

  // Hash request body if present (don't log actual body for security)
  if (req.body && Object.keys(req.body).length > 0) {
    entry.requestBodyHash = hashRequestBody(req.body);
  }

  // Hook into response finish to capture response details
  const originalEnd = res.end;
  let responseEnded = false;

  res.end = function (this: Response, ...args: unknown[]): Response {
    if (!responseEnded) {
      responseEnded = true;

      // Capture response details
      entry.statusCode = res.statusCode;
      entry.responseTimeMs = Date.now() - startTime;
      entry.success = res.statusCode >= 200 && res.statusCode < 400;

      // Add API key info if authenticated
      if (req.apiKey) {
        entry.apiKeyId = req.apiKey.keyId;
        entry.merchantId = req.apiKey.merchantId;
      }

      // Capture error info from response locals if present
      if (res.locals.error) {
        entry.errorCode = res.locals.error.code;
        entry.errorMessage = res.locals.error.message?.substring(0, 500);
      }

      // Write audit log asynchronously (don't block response)
      createAuditLog(entry).catch((err) => {
        console.error('[AuditLog] Failed to write audit log:', err);
      });
    }

    // Call original end
    return originalEnd.apply(this, args as Parameters<typeof originalEnd>);
  };

  next();
}

/**
 * Attach error details to response locals for audit logging
 * Call this from error handler middleware
 */
export function attachErrorForAudit(
  res: Response,
  error: { code?: string; message?: string }
): void {
  res.locals.error = {
    code: error.code,
    message: error.message,
  };
}
