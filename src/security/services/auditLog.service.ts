import pool from '../../lib/mysql';
import { AuditLogEntry } from '../types';
import { ResultSetHeader, RowDataPacket } from 'mysql2';

/**
 * Audit Log Service
 * Handles persistence of security audit trail
 */

/**
 * Create an audit log entry
 * This is done asynchronously to not block the response
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (
        request_id, api_key_id, merchant_id, action, resource_type, resource_id,
        method, path, ip_address, user_agent, request_body_hash,
        status_code, response_time_ms, success, error_code, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.requestId,
        entry.apiKeyId || null,
        entry.merchantId || null,
        entry.action,
        entry.resourceType || null,
        entry.resourceId || null,
        entry.method,
        entry.path,
        entry.ipAddress,
        entry.userAgent || null,
        entry.requestBodyHash || null,
        entry.statusCode || null,
        entry.responseTimeMs || null,
        entry.success ?? null,
        entry.errorCode || null,
        entry.errorMessage || null,
      ]
    );
  } catch (error) {
    // Log to console but don't throw - audit logging should not break the request
    console.error('[AuditLog] Failed to create audit log entry:', error);
  }
}

/**
 * Query audit logs with filters
 */
export interface AuditLogQuery {
  apiKeyId?: string;
  merchantId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  success?: boolean;
  limit?: number;
  offset?: number;
}

interface AuditLogRow extends RowDataPacket {
  id: number;
  timestamp: Date;
  request_id: string;
  api_key_id: string | null;
  merchant_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  method: string;
  path: string;
  ip_address: string;
  user_agent: string | null;
  request_body_hash: string | null;
  status_code: number | null;
  response_time_ms: number | null;
  success: boolean | null;
  error_code: string | null;
  error_message: string | null;
}

export async function queryAuditLogs(query: AuditLogQuery): Promise<{
  logs: AuditLogEntry[];
  total: number;
}> {
  const whereClauses: string[] = [];
  const values: unknown[] = [];

  if (query.apiKeyId) {
    whereClauses.push('api_key_id = ?');
    values.push(query.apiKeyId);
  }

  if (query.merchantId) {
    whereClauses.push('merchant_id = ?');
    values.push(query.merchantId);
  }

  if (query.action) {
    whereClauses.push('action = ?');
    values.push(query.action);
  }

  if (query.resourceType) {
    whereClauses.push('resource_type = ?');
    values.push(query.resourceType);
  }

  if (query.resourceId) {
    whereClauses.push('resource_id = ?');
    values.push(query.resourceId);
  }

  if (query.startDate) {
    whereClauses.push('timestamp >= ?');
    values.push(query.startDate);
  }

  if (query.endDate) {
    whereClauses.push('timestamp <= ?');
    values.push(query.endDate);
  }

  if (query.success !== undefined) {
    whereClauses.push('success = ?');
    values.push(query.success);
  }

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Get total count
  const [countResult] = await pool.query<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`,
    values
  );
  const total = countResult[0]?.total || 0;

  // Get paginated results
  const limit = query.limit || 100;
  const offset = query.offset || 0;

  const [rows] = await pool.query<AuditLogRow[]>(
    `SELECT * FROM audit_logs ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset]
  );

  const logs = rows.map((row) => ({
    requestId: row.request_id,
    apiKeyId: row.api_key_id || undefined,
    merchantId: row.merchant_id || undefined,
    action: row.action,
    resourceType: row.resource_type || undefined,
    resourceId: row.resource_id || undefined,
    method: row.method,
    path: row.path,
    ipAddress: row.ip_address,
    userAgent: row.user_agent || undefined,
    requestBodyHash: row.request_body_hash || undefined,
    statusCode: row.status_code || undefined,
    responseTimeMs: row.response_time_ms || undefined,
    success: row.success ?? undefined,
    errorCode: row.error_code || undefined,
    errorMessage: row.error_message || undefined,
  }));

  return { logs, total };
}

/**
 * Get audit log by request ID
 */
export async function getAuditLogByRequestId(requestId: string): Promise<AuditLogEntry | null> {
  const [rows] = await pool.query<AuditLogRow[]>(
    'SELECT * FROM audit_logs WHERE request_id = ?',
    [requestId]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    requestId: row.request_id,
    apiKeyId: row.api_key_id || undefined,
    merchantId: row.merchant_id || undefined,
    action: row.action,
    resourceType: row.resource_type || undefined,
    resourceId: row.resource_id || undefined,
    method: row.method,
    path: row.path,
    ipAddress: row.ip_address,
    userAgent: row.user_agent || undefined,
    requestBodyHash: row.request_body_hash || undefined,
    statusCode: row.status_code || undefined,
    responseTimeMs: row.response_time_ms || undefined,
    success: row.success ?? undefined,
    errorCode: row.error_code || undefined,
    errorMessage: row.error_message || undefined,
  };
}

/**
 * Clean up old audit logs
 */
export async function cleanupAuditLogs(retentionDays: number = 90): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    'DELETE FROM audit_logs WHERE timestamp < DATE_SUB(NOW(), INTERVAL ? DAY)',
    [retentionDays]
  );

  return result.affectedRows;
}
