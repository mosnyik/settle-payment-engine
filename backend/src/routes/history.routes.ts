import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../lib/mysql';
import { RowDataPacket } from 'mysql2';

const router = Router();

/**
 * GET /v1/history
 *
 * Returns a unified transaction history across legacy tables (transfers, gifts,
 * requests via summaries) and the payment engine (payment_sessions).
 *
 * Query params:
 *   phone      - filter by payer phone number
 *   chat_id    - filter by payer chat_id
 *   status     - filter by display status: Successful | Processing | Cancelled | UnSuccessful
 *                (omit to return all)
 *   type       - filter by type: transfer | gift | request | merchant
 *   from       - ISO date string, inclusive lower bound on date
 *   to         - ISO date string, inclusive upper bound on date
 *   limit      - max records to return (default 20, max 200)
 *   offset     - records to skip (default 0)
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      phone,
      chat_id,
      status,
      type,
      from,
      to,
      limit: limitStr = '20',
      offset: offsetStr = '0',
    } = req.query as Record<string, string>;

    const limit = Math.min(parseInt(limitStr) || 20, 200);
    const offset = parseInt(offsetStr) || 0;

    // Payer filter — applies as a JOIN on each branch
    const payerField = phone ? 'py.phone' : chat_id ? 'py.chat_id' : null;
    const payerValue = phone ?? chat_id ?? null;

    const buildPayerJoin = (tableAlias: string) =>
      payerField
        ? `INNER JOIN payers py ON py.id = ${tableAlias}.payer_id AND ${payerField} = ?`
        : '';

    const enginePayerJoin = payerField
      ? `INNER JOIN payers py ON py.id = ps.payer_id AND ${payerField} = ?`
      : '';

    // Outer WHERE — applied after the UNION
    const outerConditions: string[] = [];
    const outerValues: unknown[] = [];

    if (status) { outerConditions.push('display_status = ?'); outerValues.push(status); }
    if (type)   { outerConditions.push('transaction_type = ?'); outerValues.push(type); }
    if (from)   { outerConditions.push('date >= ?'); outerValues.push(new Date(from)); }
    if (to)     { outerConditions.push('date <= ?'); outerValues.push(new Date(to)); }

    const outerWhere = outerConditions.length ? `WHERE ${outerConditions.join(' AND ')}` : '';

    // Build values array: 3 legacy payer params + 1 engine payer param + outer filters
    const unionPayerValues: unknown[] = payerValue !== null
      ? [payerValue, payerValue, payerValue, payerValue]
      : [];

    const sql = `
      SELECT date, transaction_type, transac_id, amount_payable,
             crypto_amount, crypto, current_rate, charges, display_status
      FROM (

        SELECT
          t.date                AS date,
          'transfer'            AS transaction_type,
          t.transfer_id         AS transac_id,
          t.amount_payable,
          t.crypto_amount,
          t.crypto,
          t.current_rate,
          t.charges,
          s.status              AS display_status
        FROM summaries s
        LEFT JOIN transfers t ON s.transaction_id = t.id
        ${buildPayerJoin('t')}
        WHERE s.transaction_type = 'transfer'
          AND NOT EXISTS (SELECT 1 FROM payment_sessions WHERE reference = t.transfer_id)

        UNION ALL

        SELECT
          g.date                AS date,
          'gift'                AS transaction_type,
          g.gift_id             AS transac_id,
          g.amount_payable,
          g.crypto_amount,
          g.crypto,
          g.current_rate,
          g.charges,
          s.status              AS display_status
        FROM summaries s
        LEFT JOIN gifts g ON s.transaction_id = g.id
        ${buildPayerJoin('g')}
        WHERE s.transaction_type = 'gift'
          AND NOT EXISTS (SELECT 1 FROM payment_sessions WHERE reference = g.gift_id)

        UNION ALL

        SELECT
          r.date                AS date,
          'request'             AS transaction_type,
          r.request_id          AS transac_id,
          r.amount_payable,
          r.crypto_amount,
          r.crypto,
          r.current_rate,
          r.charges,
          s.status              AS display_status
        FROM summaries s
        LEFT JOIN requests r ON s.transaction_id = r.id
        ${buildPayerJoin('r')}
        WHERE s.transaction_type = 'request'
          AND NOT EXISTS (SELECT 1 FROM payment_sessions WHERE reference = r.request_id)

        UNION ALL

        SELECT
          ps.created_at         AS date,
          ps.type               AS transaction_type,
          ps.reference          AS transac_id,
          ps.fiat_amount        AS amount_payable,
          ps.crypto_amount,
          ps.crypto,
          ps.rate               AS current_rate,
          ps.charge_amount      AS charges,
          CASE ps.status
            WHEN 'settled'             THEN 'Successful'
            WHEN 'expired'             THEN 'Cancelled'
            WHEN 'failed'              THEN 'UnSuccessful'
            WHEN 'settlement_reversed' THEN 'UnSuccessful'
            ELSE 'Processing'
          END                   AS display_status
        FROM payment_sessions ps
        ${enginePayerJoin}

      ) AS all_trx
      ${outerWhere}
      ORDER BY date DESC
      LIMIT ? OFFSET ?
    `;

    const countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT s.transaction_type AS transaction_type, s.status AS display_status
        FROM summaries s
        LEFT JOIN transfers t ON s.transaction_id = t.id
        ${buildPayerJoin('t')}
        WHERE s.transaction_type = 'transfer'
          AND NOT EXISTS (SELECT 1 FROM payment_sessions WHERE reference = t.transfer_id)
        UNION ALL
        SELECT s.transaction_type, s.status
        FROM summaries s
        LEFT JOIN gifts g ON s.transaction_id = g.id
        ${buildPayerJoin('g')}
        WHERE s.transaction_type = 'gift'
          AND NOT EXISTS (SELECT 1 FROM payment_sessions WHERE reference = g.gift_id)
        UNION ALL
        SELECT s.transaction_type, s.status
        FROM summaries s
        LEFT JOIN requests r ON s.transaction_id = r.id
        ${buildPayerJoin('r')}
        WHERE s.transaction_type = 'request'
          AND NOT EXISTS (SELECT 1 FROM payment_sessions WHERE reference = r.request_id)
        UNION ALL
        SELECT ps.type,
          CASE ps.status
            WHEN 'settled'             THEN 'Successful'
            WHEN 'expired'             THEN 'Cancelled'
            WHEN 'failed'              THEN 'UnSuccessful'
            WHEN 'settlement_reversed' THEN 'UnSuccessful'
            ELSE 'Processing'
          END
        FROM payment_sessions ps
        ${enginePayerJoin}
      ) AS all_trx
      ${outerWhere}
    `;

    const listValues  = [...unionPayerValues, ...outerValues, limit, offset];
    const countValues = [...unionPayerValues, ...outerValues];

    const [rows] = await pool.query<RowDataPacket[]>(
      sql,
      listValues as (string | number | Date | null)[]
    );
    const [countRows] = await pool.query<RowDataPacket[]>(
      countSql,
      countValues as (string | number | Date | null)[]
    );

    const total = (countRows[0] as { total: number }).total;

    return res.json({
      status: true,
      data: { transactions: rows, total, limit, offset },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
