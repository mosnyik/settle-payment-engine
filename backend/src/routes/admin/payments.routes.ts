import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../../lib/mysql';
import { RowDataPacket } from 'mysql2';

const router = Router();

// =============================================================================
// LIST PAYMENTS
// =============================================================================

/**
 * GET /admin/payments
 *
 * Query params:
 *   status    - filter by status (pending, confirming, confirmed, settling, settled, failed, expired)
 *   type      - filter by type (transfer, gift, request, merchant)
 *   from      - ISO date string (created_at >=)
 *   to        - ISO date string (created_at <=)
 *   search    - reference or merchant_id substring
 *   limit     - default 50, max 200
 *   offset    - default 0
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
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

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (status) {
      conditions.push('ps.status = ?');
      values.push(status);
    }
    if (type) {
      conditions.push('ps.type = ?');
      values.push(type);
    }
    if (from) {
      conditions.push('ps.created_at >= ?');
      values.push(new Date(from));
    }
    if (to) {
      conditions.push('ps.created_at <= ?');
      values.push(new Date(to));
    }
    if (search) {
      conditions.push('(ps.reference LIKE ? OR ps.merchant_id LIKE ?)');
      values.push(`%${search}%`, `%${search}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const listSql = `SELECT
         ps.id, ps.reference, ps.type, ps.status,
         ps.fiat_amount, ps.fiat_currency,
         ps.crypto, ps.crypto_amount, ps.network,
         ps.rate, ps.charge_amount,
         ps.deposit_address, ps.tx_hash, ps.confirmations,
         ps.received_amount,
         ps.settlement_reference, ps.settlement_provider,
         ps.merchant_id, ps.merchant_reference,
         ps.api_key_id,
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
    const listValues = [...values, limit, offset] as (string | number | Date)[];
    const [rows] = await pool.execute<RowDataPacket[]>(listSql, listValues);

    const countSql = `SELECT COUNT(*) AS total FROM payment_sessions ps ${where}`;
    const countValues = values as (string | number | Date)[];
    const [countRows] = await pool.execute<RowDataPacket[]>(countSql, countValues);

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

// =============================================================================
// PAYMENT DETAIL
// =============================================================================

/**
 * GET /admin/payments/:reference
 */
router.get('/:reference', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reference } = req.params;

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         ps.*,
         r.account_number, r.account_name, r.bank_code, r.bank_name, r.phone AS receiver_phone,
         p.chat_id AS payer_chat_id, p.phone AS payer_phone, p.wallet_address AS payer_wallet
       FROM payment_sessions ps
       LEFT JOIN receivers r ON r.id = ps.receiver_id
       LEFT JOIN payers p ON p.id = ps.payer_id
       WHERE ps.reference = ?`,
      [reference]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Payment not found', code: 'NOT_FOUND' });
    }

    // Fetch settlement attempts
    const [attempts] = await pool.execute<RowDataPacket[]>(
      `SELECT id, provider, reference, status, amount, account_number, bank_code, account_name,
              error_message, created_at, updated_at
       FROM settlement_attempts WHERE session_id = ? ORDER BY created_at DESC`,
      [rows[0].id]
    );

    return res.json({
      status: true,
      data: {
        payment: rows[0],
        settlementAttempts: attempts,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
