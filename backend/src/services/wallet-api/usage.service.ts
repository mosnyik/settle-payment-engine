/**
 * Usage Tracking Service
 * Tracks API usage for billing
 */

import pool from '../../lib/mysql';
import { RowDataPacket } from 'mysql2';

type UsageCounter =
  | 'wallets_created'
  | 'deposits_detected'
  | 'deposits_confirmed'
  | 'sweeps_completed'
  | 'webhooks_sent'
  | 'webhooks_failed'
  | 'payments_created'
  | 'payments_completed';

interface UsageRow extends RowDataPacket {
  api_key_id: number;
  date: Date;
  wallets_created: number;
  deposits_detected: number;
  deposits_confirmed: number;
  sweeps_completed: number;
  webhooks_sent: number;
  webhooks_failed: number;
  payments_created: number;
  payments_completed: number;
}

/**
 * Increment a usage counter for an API key
 */
export async function incrementUsage(
  apiKeyId: number,
  counter: UsageCounter,
  amount: number = 1
): Promise<void> {
  try {
    // Upsert: insert or update on duplicate key
    await pool.query(
      `INSERT INTO api_usage (api_key_id, date, ${counter})
       VALUES (?, CURDATE(), ?)
       ON DUPLICATE KEY UPDATE ${counter} = ${counter} + ?`,
      [apiKeyId, amount, amount]
    );
  } catch (err) {
    // Don't fail the main operation if usage tracking fails
    console.error('[Usage] Failed to increment counter:', err);
  }
}

/**
 * Get usage for an API key for a specific date
 */
export async function getUsage(
  apiKeyId: number,
  date: Date = new Date()
): Promise<Record<UsageCounter, number> | null> {
  const dateStr = date.toISOString().split('T')[0];

  const [rows] = await pool.query<UsageRow[]>(
    'SELECT * FROM api_usage WHERE api_key_id = ? AND date = ?',
    [apiKeyId, dateStr]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    wallets_created: row.wallets_created,
    deposits_detected: row.deposits_detected,
    deposits_confirmed: row.deposits_confirmed,
    sweeps_completed: row.sweeps_completed,
    webhooks_sent: row.webhooks_sent,
    webhooks_failed: row.webhooks_failed,
    payments_created: row.payments_created,
    payments_completed: row.payments_completed,
  };
}

/**
 * Get usage for an API key for a date range
 */
export async function getUsageRange(
  apiKeyId: number,
  startDate: Date,
  endDate: Date
): Promise<Array<{ date: string } & Record<UsageCounter, number>>> {
  const [rows] = await pool.query<UsageRow[]>(
    `SELECT * FROM api_usage
     WHERE api_key_id = ? AND date >= ? AND date <= ?
     ORDER BY date ASC`,
    [apiKeyId, startDate, endDate]
  );

  return rows.map((row) => ({
    date: row.date.toISOString().split('T')[0],
    wallets_created: row.wallets_created,
    deposits_detected: row.deposits_detected,
    deposits_confirmed: row.deposits_confirmed,
    sweeps_completed: row.sweeps_completed,
    webhooks_sent: row.webhooks_sent,
    webhooks_failed: row.webhooks_failed,
    payments_created: row.payments_created,
    payments_completed: row.payments_completed,
  }));
}

/**
 * Monthly usage summary for quota enforcement
 */
export interface MonthlyUsage {
  walletsCreated: number;
  depositsDetected: number;
  depositsConfirmed: number;
  sweepsCompleted: number;
  webhooksSent: number;
  webhooksFailed: number;
  paymentsCreated: number;
  paymentsCompleted: number;
}

/**
 * Get usage for the current calendar month (for quota enforcement)
 */
export async function getMonthlyUsage(apiKeyId: number): Promise<MonthlyUsage> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(wallets_created), 0) as wallets_created,
       COALESCE(SUM(deposits_detected), 0) as deposits_detected,
       COALESCE(SUM(deposits_confirmed), 0) as deposits_confirmed,
       COALESCE(SUM(sweeps_completed), 0) as sweeps_completed,
       COALESCE(SUM(webhooks_sent), 0) as webhooks_sent,
       COALESCE(SUM(webhooks_failed), 0) as webhooks_failed,
       COALESCE(SUM(payments_created), 0) as payments_created,
       COALESCE(SUM(payments_completed), 0) as payments_completed
     FROM api_usage
     WHERE api_key_id = ?
       AND YEAR(date) = YEAR(CURDATE())
       AND MONTH(date) = MONTH(CURDATE())`,
    [apiKeyId]
  );

  const row = rows[0];
  return {
    walletsCreated: Number(row.wallets_created) || 0,
    depositsDetected: Number(row.deposits_detected) || 0,
    depositsConfirmed: Number(row.deposits_confirmed) || 0,
    sweepsCompleted: Number(row.sweeps_completed) || 0,
    webhooksSent: Number(row.webhooks_sent) || 0,
    webhooksFailed: Number(row.webhooks_failed) || 0,
    paymentsCreated: Number(row.payments_created) || 0,
    paymentsCompleted: Number(row.payments_completed) || 0,
  };
}

/**
 * Get total usage for an API key (all time)
 */
export async function getTotalUsage(
  apiKeyId: number
): Promise<Record<UsageCounter, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       SUM(wallets_created) as wallets_created,
       SUM(deposits_detected) as deposits_detected,
       SUM(deposits_confirmed) as deposits_confirmed,
       SUM(sweeps_completed) as sweeps_completed,
       SUM(webhooks_sent) as webhooks_sent,
       SUM(webhooks_failed) as webhooks_failed,
       SUM(payments_created) as payments_created,
       SUM(payments_completed) as payments_completed
     FROM api_usage
     WHERE api_key_id = ?`,
    [apiKeyId]
  );

  const row = rows[0];
  return {
    wallets_created: Number(row.wallets_created) || 0,
    deposits_detected: Number(row.deposits_detected) || 0,
    deposits_confirmed: Number(row.deposits_confirmed) || 0,
    sweeps_completed: Number(row.sweeps_completed) || 0,
    webhooks_sent: Number(row.webhooks_sent) || 0,
    webhooks_failed: Number(row.webhooks_failed) || 0,
    payments_created: Number(row.payments_created) || 0,
    payments_completed: Number(row.payments_completed) || 0,
  };
}
