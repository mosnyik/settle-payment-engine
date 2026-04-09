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
             r.bank_account AS account_number, r.account_name, r.bank_code, r.bank_name,
             p.chat_id AS payer_chat_id
      FROM payment_sessions ps
      LEFT JOIN receivers r ON r.id = ps.receiver_id
      LEFT JOIN payers p ON p.id = ps.payer_id
      ${where}
      ORDER BY ps.created_at DESC
      LIMIT ? OFFSET ?`;

    const [rows] = await pool.query<RowDataPacket[]>(
      listSql,
      [...values, limit, offset]
    );
    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM payment_sessions ps ${where}`,
      values
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
              r.bank_account AS account_number, r.account_name, r.bank_code, r.bank_name, r.phone AS receiver_phone,
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

// =============================================================================
// RECONCILIATION REPORT
// =============================================================================

function defaultDateRange(): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 1);
  from.setHours(0, 0, 0, 0);
  const to = new Date(now);
  to.setDate(to.getDate() - 1);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const REPORT_HEADERS = [
  'reference', 'type', 'status',
  'fiat_amount', 'fiat_currency', 'charge_amount', 'net_fiat_amount', 'transaction_usd',
  'crypto', 'network', 'crypto_amount', 'received_amount', 'rate',
  'tx_hash', 'settlement_reference', 'settlement_provider',
  'receiver_account_number', 'receiver_account_name', 'receiver_bank_name', 'receiver_bank_code',
  'payer_chat_id', 'merchant_id', 'merchant_reference', 'bank_ref',
  'created_at', 'confirmed_at', 'settled_at',
];

/**
 * GET /v1/me/reports/reconciliation
 *
 * Query params:
 *   from    - ISO date string, default: start of yesterday
 *   to      - ISO date string, default: end of yesterday
 *   status  - payment status filter, default: settled. Pass "all" to skip.
 *   type    - payment type filter
 *   format  - "csv" (default) | "json"
 */
router.get('/reports/reconciliation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKeyId = req.apiKey!.id;
    const { status, type, format } = req.query as Record<string, string>;
    const { from: fromStr, to: toStr } = req.query as Record<string, string>;

    const defaults = defaultDateRange();
    const from = fromStr ? new Date(fromStr) : defaults.from;
    const to = toStr ? new Date(toStr) : defaults.to;

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ error: 'Invalid date range', code: 'INVALID_DATES' });
    }

    const conditions: string[] = ['ps.api_key_id = ?', 'ps.created_at >= ?', 'ps.created_at <= ?'];
    const values: unknown[] = [apiKeyId, from, to];

    if (status && status !== 'all') {
      conditions.push('ps.status = ?');
      values.push(status);
    } else if (!status) {
      conditions.push('ps.status = ?');
      values.push('settled');
    }

    if (type) {
      conditions.push('ps.type = ?');
      values.push(type);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const sql = `
      SELECT
        ps.reference, ps.type, ps.status,
        ps.fiat_amount, ps.fiat_currency, ps.charge_amount,
        (ps.fiat_amount - COALESCE(ps.charge_amount, 0)) AS net_fiat_amount,
        ps.transaction_usd,
        ps.crypto, ps.network, ps.crypto_amount, ps.received_amount, ps.rate,
        ps.tx_hash, ps.settlement_reference, ps.settlement_provider,
        r.bank_account AS receiver_account_number,
        r.account_name   AS receiver_account_name,
        r.bank_name      AS receiver_bank_name,
        r.bank_code      AS receiver_bank_code,
        p.chat_id        AS payer_chat_id,
        ps.merchant_id, ps.merchant_reference, ps.bank_ref,
        ps.created_at, ps.confirmed_at, ps.settled_at
      FROM payment_sessions ps
      LEFT JOIN receivers r ON r.id = ps.receiver_id
      LEFT JOIN payers p    ON p.id = ps.payer_id
      ${where}
      ORDER BY ps.created_at ASC
    `;

    const [rows] = await pool.execute<RowDataPacket[]>(sql, values as (string | number | Date)[]);

    const dateLabel = `${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`;

    if (format === 'json') {
      return res.json({
        status: true,
        data: {
          from: from.toISOString(),
          to: to.toISOString(),
          count: rows.length,
          payments: rows,
          summary: {
            totalFiatAmount: rows.reduce((s, r) => s + (Number(r.fiat_amount) || 0), 0),
            totalCharges: rows.reduce((s, r) => s + (Number(r.charge_amount) || 0), 0),
            totalNetFiat: rows.reduce(
              (s, r) => s + (Number(r.fiat_amount) || 0) - (Number(r.charge_amount) || 0),
              0,
            ),
            totalUsd: rows.reduce((s, r) => s + (Number(r.transaction_usd) || 0), 0),
          },
        },
      });
    }

    // CSV response
    const lines: string[] = [
      REPORT_HEADERS.join(','),
      ...rows.map(r =>
        REPORT_HEADERS.map(col => {
          const val = r[col];
          return escapeCell(val instanceof Date ? val.toISOString() : val);
        }).join(','),
      ),
    ];

    // Summary row
    const totalFiat = rows.reduce((s, r) => s + (Number(r.fiat_amount) || 0), 0);
    const totalCharges = rows.reduce((s, r) => s + (Number(r.charge_amount) || 0), 0);
    lines.push(
      [
        escapeCell(`TOTAL (${rows.length} records)`),
        '', '',
        escapeCell(totalFiat.toFixed(2)),
        escapeCell(rows[0]?.fiat_currency ?? 'NGN'),
        escapeCell(totalCharges.toFixed(2)),
        escapeCell((totalFiat - totalCharges).toFixed(2)),
        escapeCell(rows.reduce((s, r) => s + (Number(r.transaction_usd) || 0), 0).toFixed(6)),
        ...Array(19).fill(''),
      ].join(','),
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="reconciliation_${dateLabel}.csv"`,
    );
    return res.send(lines.join('\n'));
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// AUDIT LOGS
// =============================================================================

/**
 *
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

    if (from) { conditions.push('al.timestamp >= ?'); values.push(new Date(from)); }
    if (to) { conditions.push('al.timestamp <= ?'); values.push(new Date(to)); }
    if (action) { conditions.push('al.action = ?'); values.push(action); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM audit_logs al ${where} ORDER BY al.timestamp DESC LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    );
    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM audit_logs al ${where}`,
      values
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
