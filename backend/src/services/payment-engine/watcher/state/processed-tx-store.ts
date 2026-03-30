/**
 * Processed Transaction Store
 *
 * Tracks which transactions have been processed to prevent duplicate handling.
 * Uses MySQL for persistence across restarts.
 */

import pool from '../../../../lib/mysql';
import { ProcessedTransaction, WatchableChain, WatcherEvent } from '../types';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

/**
 * Store for tracking processed transactions.
 * Prevents duplicate processing of deposits after restarts or crashes.
 */
export class ProcessedTxStore {
  /**
   * Check if a transaction has been processed for a specific action.
   */
  async isProcessed(
    txHash: string,
    action: 'mark_deposit' | 'confirm_deposit'
  ): Promise<boolean> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 1 FROM watcher_processed_transactions
       WHERE tx_hash = ? AND action = ?
       LIMIT 1`,
      [txHash, action]
    );
    return rows.length > 0;
  }

  /**
   * Mark a transaction as processed.
   * Uses INSERT ... ON DUPLICATE KEY UPDATE for idempotency.
   */
  async markProcessed(tx: ProcessedTransaction): Promise<void> {
    await pool.query(
      `INSERT INTO watcher_processed_transactions
       (tx_hash, session_id, chain, action, confirmations, processed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         processed_at = VALUES(processed_at),
         confirmations = VALUES(confirmations)`,
      [
        tx.txHash,
        tx.sessionId,
        tx.chain,
        tx.action,
        tx.confirmations ?? null,
        tx.processedAt,
      ]
    );
  }

  /**
   * Get processed transaction record.
   */
  async getProcessed(
    txHash: string,
    action: 'mark_deposit' | 'confirm_deposit'
  ): Promise<ProcessedTransaction | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT tx_hash, session_id, chain, action, confirmations, processed_at
       FROM watcher_processed_transactions
       WHERE tx_hash = ? AND action = ?
       LIMIT 1`,
      [txHash, action]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      txHash: row.tx_hash,
      sessionId: row.session_id,
      chain: row.chain as WatchableChain,
      action: row.action,
      confirmations: row.confirmations,
      processedAt: new Date(row.processed_at),
    };
  }

  /**
   * Clean up old processed transaction records.
   * Should be called periodically (e.g., daily).
   */
  async cleanup(retentionDays: number = 30): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const [result] = await pool.query<ResultSetHeader>(
      `DELETE FROM watcher_processed_transactions
       WHERE processed_at < ?`,
      [cutoff]
    );

    return result.affectedRows;
  }

  /**
   * Update watcher state for monitoring.
   */
  async updateWatcherState(
    chain: WatchableChain,
    stats: {
      sessionsChecked?: number;
      depositsDetected?: number;
      depositsConfirmed?: number;
      error?: string | null;
    }
  ): Promise<void> {
    const updates: string[] = ['last_poll_at = NOW()'];
    const values: (string | number | null)[] = [];

    if (stats.sessionsChecked !== undefined) {
      updates.push('sessions_checked = sessions_checked + ?');
      values.push(stats.sessionsChecked);
    }

    if (stats.depositsDetected !== undefined) {
      updates.push('deposits_detected = deposits_detected + ?');
      values.push(stats.depositsDetected);
    }

    if (stats.depositsConfirmed !== undefined) {
      updates.push('deposits_confirmed = deposits_confirmed + ?');
      values.push(stats.depositsConfirmed);
    }

    if (stats.error === null) {
      updates.push('last_success_at = NOW()');
    } else if (stats.error !== undefined) {
      updates.push('last_error = ?');
      updates.push('last_error_at = NOW()');
      values.push(stats.error);
    }

    values.push(chain);

    await pool.query(
      `UPDATE watcher_state
       SET ${updates.join(', ')}
       WHERE chain = ?`,
      values
    );
  }

  /**
   * Log a fraud/security event for manual review.
   */
  async logFraudEvent(event: WatcherEvent): Promise<void> {
    // Only log security-related events
    const securityEvents = [
      'reorg_detected',
      'rbf_replacement',
      'fake_token_attempt',
      'dust_deposit_ignored',
      'underpaid_deposit',
      'tx_disappeared',
      'high_value_manual_review',
    ];

    if (!securityEvents.includes(event.type)) return;

    await pool.query(
      `INSERT INTO watcher_fraud_events
       (event_type, chain, session_id, tx_hash, details)
       VALUES (?, ?, ?, ?, ?)`,
      [
        event.type,
        event.chain ?? null,
        event.sessionId ?? null,
        event.txHash ?? null,
        event.details ? JSON.stringify(event.details) : null,
      ]
    );
  }
}

// Singleton instance
let storeInstance: ProcessedTxStore | null = null;

export function getProcessedTxStore(): ProcessedTxStore {
  if (!storeInstance) {
    storeInstance = new ProcessedTxStore();
  }
  return storeInstance;
}

export default ProcessedTxStore;
