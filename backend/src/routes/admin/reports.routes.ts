import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../../lib/mysql';
import { RowDataPacket } from 'mysql2';

const router = Router();

// =============================================================================
// HELPERS
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

function rowToCsv(fields: string[]): string {
  return fields.map(escapeCell).join(',');
}

const CSV_HEADERS = [
  'reference',
  'type',
  'status',
  'fiat_amount',
  'fiat_currency',
  'charge_amount',
  'net_fiat_amount',
  'transaction_usd',
  'crypto',
  'network',
  'crypto_amount',
  'received_amount',
  'rate',
  'tx_hash',
  'settlement_reference',
  'settlement_provider',
  'receiver_account_number',
  'receiver_account_name',
  'receiver_bank_name',
  'receiver_bank_code',
  'payer_chat_id',
  'merchant_id',
  'merchant_reference',
  'bank_ref',
  'api_key_id',
  'created_at',
  'confirmed_at',
  'settled_at',
];

function buildReportQuery(conditions: string[], values: unknown[], includeApiKeyId = true) {
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      ps.reference,
      ps.type,
      ps.status,
      ps.fiat_amount,
      ps.fiat_currency,
      ps.charge_amount,
      (ps.fiat_amount - COALESCE(ps.charge_amount, 0))   AS net_fiat_amount,
      ps.transaction_usd,
      ps.crypto,
      ps.network,
      ps.crypto_amount,
      ps.received_amount,
      ps.rate,
      ps.tx_hash,
      ps.settlement_reference,
      ps.settlement_provider,
      r.account_number    AS receiver_account_number,
      r.account_name      AS receiver_account_name,
      r.bank_name         AS receiver_bank_name,
      r.bank_code         AS receiver_bank_code,
      p.chat_id           AS payer_chat_id,
      ps.merchant_id,
      ps.merchant_reference,
      ps.bank_ref,
      ${includeApiKeyId ? 'ps.api_key_id,' : ''}
      ps.created_at,
      ps.confirmed_at,
      ps.settled_at
    FROM payment_sessions ps
    LEFT JOIN receivers r ON r.id = ps.receiver_id
    LEFT JOIN payers p    ON p.id = ps.payer_id
    ${where}
    ORDER BY ps.created_at ASC
  `;

  return { sql, values };
}

function buildSummaryRow(rows: RowDataPacket[]): string {
  const count = rows.length;
  let totalFiat = 0;
  let totalCharges = 0;
  let totalUsd = 0;
  let totalCrypto = 0;

  for (const r of rows) {
    totalFiat += Number(r.fiat_amount) || 0;
    totalCharges += Number(r.charge_amount) || 0;
    totalUsd += Number(r.transaction_usd) || 0;
    totalCrypto += Number(r.received_amount || r.crypto_amount) || 0;
  }

  return rowToCsv([
    `TOTAL (${count} records)`,
    '', '', // type, status
    totalFiat.toFixed(2),
    rows[0]?.fiat_currency ?? 'NGN',
    totalCharges.toFixed(2),
    (totalFiat - totalCharges).toFixed(2),
    totalUsd.toFixed(6),
    '', '', // crypto, network
    totalCrypto.toFixed(8),
    '', '', '', '', '', '', '', '', '', '', '', '', '',
    '', '', '',
  ]);
}

function toCsvResponse(
  res: Response,
  rows: RowDataPacket[],
  filename: string,
  includeApiKeyId: boolean,
): void {
  const headers = includeApiKeyId ? CSV_HEADERS : CSV_HEADERS.filter(h => h !== 'api_key_id');

  const lines: string[] = [
    headers.join(','),
    ...rows.map(r =>
      rowToCsv(
        headers.map(col => {
          const val = r[col];
          if (val instanceof Date) return val.toISOString();
          return val;
        }),
      ),
    ),
    buildSummaryRow(rows),
  ];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(lines.join('\n'));
}

// =============================================================================
// ADMIN — FULL PLATFORM RECONCILIATION REPORT
// =============================================================================

/**
 * GET /v1/admin/reports/reconciliation
 *
 * Query params:
 *   from    - ISO date string, default: start of yesterday
 *   to      - ISO date string, default: end of yesterday
 *   status  - payment status filter, default: settled. Pass "all" to skip.
 *   type    - payment type filter (transfer, gift, request, merchant, bank_confirmation)
 *   format  - "csv" (default) | "json"
 */
router.get('/reconciliation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, type, format } = req.query as Record<string, string>;
    let { from: fromStr, to: toStr } = req.query as Record<string, string>;

    const defaults = defaultDateRange();
    const from = fromStr ? new Date(fromStr) : defaults.from;
    const to = toStr ? new Date(toStr) : defaults.to;

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ error: 'Invalid date range', code: 'INVALID_DATES' });
    }

    const conditions: string[] = ['ps.created_at >= ?', 'ps.created_at <= ?'];
    const values: unknown[] = [from, to];

    if (status && status !== 'all') {
      conditions.push('ps.status = ?');
      values.push(status);
    } else if (!status) {
      // default to settled
      conditions.push('ps.status = ?');
      values.push('settled');
    }

    if (type) {
      conditions.push('ps.type = ?');
      values.push(type);
    }

    const { sql } = buildReportQuery(conditions, values, true);
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
              (s, r) =>
                s + (Number(r.fiat_amount) || 0) - (Number(r.charge_amount) || 0),
              0,
            ),
            totalUsd: rows.reduce((s, r) => s + (Number(r.transaction_usd) || 0), 0),
          },
        },
      });
    }

    toCsvResponse(res, rows, `reconciliation_${dateLabel}.csv`, true);
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// MERCHANT — OWN SETTLEMENTS REPORT
// Already handled in me.routes.ts, kept in admin for reference only
// =============================================================================

export default router;
