import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../lib/mysql';
import { RowDataPacket } from 'mysql2';

const router = Router();

/**
 * GET /v1/me
 * Returns the authenticated API key's own details.
 */
router.get('/', (req: Request, res: Response) => {
  const { keyHash, webhookSecret, ...safe } = req.apiKey!;
  return res.json({ success: true, data: { apiKey: safe } });
});

/**
 * GET /v1/me/payments
 * Payments belonging to the authenticated API key.
 *
 * Query params: status, type, from, to, search, limit, offset
 */
router.get('/payments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKeyId = req.apiKey!.id;
    const {
      status,
      type,
      from,
      to,
      search,
      limit: limitStr = '50',
      offset: offsetStr = '0',
    } = req.query as Record<string, string>;

    const limit = Math.min(parseInt(limitStr) || 50, 200);
    const offset = parseInt(offsetStr) || 0;

    const conditions: string[] = ['ps.api_key_id = ?'];
    const values: unknown[] = [apiKeyId];

    if (status) { conditions.push('ps.status = ?'); values.push(status); }
    if (type) { conditions.push('ps.type = ?'); values.push(type); }
    if (from) { conditions.push('ps.created_at >= ?'); values.push(new Date(from)); }
    if (to) { conditions.push('ps.created_at <= ?'); values.push(new Date(to)); }
    if (search) { conditions.push('ps.reference LIKE ?'); values.push(`%${search}%`); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const listSql = `
      SELECT ps.id, ps.reference, ps.type, ps.status,
             ps.fiat_amount, ps.fiat_currency,
             ps.crypto, ps.crypto_amount, ps.network,
             ps.rate, ps.charge_amount,
             ps.deposit_address, ps.tx_hash, ps.confirmations,
             ps.received_amount,
             ps.settlement_reference, ps.settlement_provider,
             ps.merchant_id, ps.merchant_reference, ps.api_key_id,
             ps.expires_at, ps.confirmed_at, ps.settled_at,
             ps.created_at, ps.updated_at,
             r.account_number, r.account_name, r.bank_code, r.bank_name,
             p.chat_id AS payer_chat_id
      FROM payment_sessions ps
      LEFT JOIN receivers r ON r.id = ps.receiver_id
      LEFT JOIN payers p ON p.id = ps.payer_id
      ${where}
      ORDER BY ps.created_at DESC
      LIMIT ? OFFSET ?`;

    const [rows] = await pool.execute<RowDataPacket[]>(
      listSql,
      [...values, limit, offset] as (string | number | Date)[]
    );
    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM payment_sessions ps ${where}`,
      values as (string | number | Date)[]
    );

    return res.json({
      status: true,
      data: {
        payments: rows,
        total: (countRows[0] as { total: number }).total,
        limit,
        offset,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/me/payments/stats
 * Count of payments per status for the authenticated API key.
 */
router.get('/payments/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKeyId = req.apiKey!.id;
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT status, COUNT(*) AS count
       FROM payment_sessions
       WHERE api_key_id = ?
       GROUP BY status`,
      [apiKeyId]
    );

    const stats: Record<string, number> = {};
    for (const row of rows as Array<{ status: string; count: number }>) {
      stats[row.status] = Number(row.count);
    }

    return res.json({ status: true, data: { stats } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/me/payments/:reference
 * Single payment — only if it belongs to the authenticated API key.
 */
router.get('/payments/:reference', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reference } = req.params;
    const apiKeyId = req.apiKey!.id;

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT ps.*,
              r.account_number, r.account_name, r.bank_code, r.bank_name, r.phone AS receiver_phone,
              p.chat_id AS payer_chat_id, p.phone AS payer_phone
       FROM payment_sessions ps
       LEFT JOIN receivers r ON r.id = ps.receiver_id
       LEFT JOIN payers p ON p.id = ps.payer_id
       WHERE ps.reference = ? AND ps.api_key_id = ?`,
      [reference, apiKeyId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Payment not found', code: 'NOT_FOUND' });
    }

    const [attempts] = await pool.execute<RowDataPacket[]>(
      `SELECT id, provider, reference, status, amount, account_number, bank_code, account_name,
              error_message, created_at, updated_at
       FROM settlement_attempts WHERE session_id = ? ORDER BY created_at DESC`,
      [rows[0].id]
    );

    return res.json({
      status: true,
      data: { payment: rows[0], settlementAttempts: attempts },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/me/audit-logs
 * Audit log entries for the authenticated API key.
 */
router.get('/audit-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const keyId = req.apiKey!.keyId;
    const {
      from,
      to,
      action,
      limit: limitStr = '50',
      offset: offsetStr = '0',
    } = req.query as Record<string, string>;

    const limit = Math.min(parseInt(limitStr) || 50, 200);
    const offset = parseInt(offsetStr) || 0;

    const conditions: string[] = ['al.api_key_id = ?'];
    const values: unknown[] = [keyId];

    if (from) { conditions.push('al.created_at >= ?'); values.push(new Date(from)); }
    if (to) { conditions.push('al.created_at <= ?'); values.push(new Date(to)); }
    if (action) { conditions.push('al.action = ?'); values.push(action); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM audit_logs al ${where} ORDER BY al.created_at DESC LIMIT ? OFFSET ?`,
      [...values, limit, offset] as (string | number | Date)[]
    );
    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM audit_logs al ${where}`,
      values as (string | number | Date)[]
    );

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
