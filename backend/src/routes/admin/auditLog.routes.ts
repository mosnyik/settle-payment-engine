import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../../lib/mysql';
import { RowDataPacket } from 'mysql2';

const router = Router();

/**
 * GET /admin/audit-logs
 *
 * Query params:
 *   apiKeyId   - filter by api_key_id
 *   merchantId - filter by merchant_id
 *   action     - filter by action substring
 *   success    - 'true' | 'false'
 *   from       - ISO date string
 *   to         - ISO date string
 *   limit      - default 50, max 200
 *   offset     - default 0
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      apiKeyId,
      merchantId,
      action,
      success,
      from,
      to,
      limit: limitStr = '50',
      offset: offsetStr = '0',
    } = req.query as Record<string, string>;

    const limit = Math.min(parseInt(limitStr) || 50, 200);
    const offset = parseInt(offsetStr) || 0;

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (apiKeyId) {
      conditions.push('api_key_id = ?');
      values.push(apiKeyId);
    }
    if (merchantId) {
      conditions.push('merchant_id = ?');
      values.push(merchantId);
    }
    if (action) {
      conditions.push('action LIKE ?');
      values.push(`%${action}%`);
    }
    if (success !== undefined) {
      conditions.push('success = ?');
      values.push(success === 'true' ? 1 : 0);
    }
    if (from) {
      conditions.push('timestamp >= ?');
      values.push(new Date(from));
    }
    if (to) {
      conditions.push('timestamp <= ?');
      values.push(new Date(to));
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const listSql = `SELECT id, timestamp, request_id, api_key_id, merchant_id, action,
              resource_type, resource_id, method, path, ip_address, user_agent,
              status_code, response_time_ms, success, error_code, error_message
       FROM audit_logs
       ${where}
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`;
    const listValues = [...values, limit, offset] as (string | number | Date)[];
    const [rows] = await pool.execute<RowDataPacket[]>(listSql, listValues);

    const countSql = `SELECT COUNT(*) AS total FROM audit_logs ${where}`;
    const countValues = values as (string | number | Date)[];
    const [countRows] = await pool.execute<RowDataPacket[]>(countSql, countValues);

    return res.json({
      status: true,
      data: {
        logs: rows,
        total: (countRows[0] as { total: number }).total,
        limit,
        offset,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
