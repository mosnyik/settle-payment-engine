/**
 * Legacy Sync Service
 *
 * Keeps legacy tables (transfers, gifts, requests, summaries) in sync
 * with payment_sessions for backward compatibility during migration.
 *
 * This allows external systems (like Telegram bots) that still read
 * from the legacy tables to continue working.
 */

import { PaymentSession, PaymentStatus, PaymentType } from '../types';

// =============================================================================
// STATUS MAPPING
// =============================================================================

/** Map PaymentEngine status to legacy status */
const STATUS_MAP: Record<PaymentStatus, string> = {
  created: 'pending',
  pending: 'Processing',
  confirming: 'Processing',
  confirmed: 'Processing',
  settling: 'Processing',
  settled: 'Successful',
  expired: 'cancel',
  failed: 'UnSuccessful',
  settlement_reversed: 'UnSuccessful',
};

// =============================================================================
// SERVICE
// =============================================================================

export class LegacySyncService {
  /**
   * Sync a payment session to legacy tables.
   * Creates or updates the corresponding legacy record.
   *
   * @param session - Payment session to sync
   */
  async syncToLegacy(session: PaymentSession): Promise<void> {
    try {
      switch (session.type) {
        case 'transfer':
          await this.syncTransfer(session);
          break;
        case 'gift':
          await this.syncGift(session);
          break;
        case 'request':
          await this.syncRequest(session);
          break;
        default:
          // Merchant type doesn't sync to legacy
          break;
      }

      // Sync summary record
      await this.syncSummary(session);
    } catch (error) {
      console.error(`[LegacySync] Failed to sync session ${session.id}:`, error);
      // Don't throw - legacy sync should not block main flow
    }
  }

  /**
   * Sync transfer to legacy transfers table.
   */
  private async syncTransfer(session: PaymentSession): Promise<void> {
    const pool = (await import('../../../lib/mysql')).default;
    const legacyStatus = STATUS_MAP[session.status];

    // Check if transfer already exists (using payment_sessions.reference as transfer_id)
    const [existing] = await pool.query(
      `SELECT id FROM transfers WHERE transfer_id = ? LIMIT 1`,
      [session.reference]
    ) as [any[], any];

    if (existing && existing.length > 0) {
      // Update existing
      await pool.query(
        `UPDATE transfers
         SET status = ?,
             wallet_address = ?,
             crypto_amount = ?,
             current_rate = ?
         WHERE transfer_id = ?`,
        [
          legacyStatus,
          session.depositAddress,
          session.cryptoAmount,
          session.rate,
          session.reference,
        ]
      );
    } else {
      // Insert new
      await pool.query(
        `INSERT INTO transfers
         (transfer_id, crypto, network, estimate_asset, amount_payable,
          crypto_amount, estimate_amount, charges, date, receiver_id,
          payer_id, current_rate, merchant_rate, profit_rate,
          wallet_address, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.reference,
          session.crypto,
          session.network,
          session.crypto,
          session.fiatAmount,
          session.cryptoAmount,
          session.fiatAmount,
          session.chargeAmount,
          session.createdAt,
          session.receiverId || null,
          session.payerId || null,
          session.rate,
          session.rate, // merchant_rate same as current_rate
          0, // profit_rate
          session.depositAddress,
          legacyStatus,
        ]
      );
    }
  }

  /**
   * Sync gift to legacy gifts table.
   */
  private async syncGift(session: PaymentSession): Promise<void> {
    const pool = (await import('../../../lib/mysql')).default;
    const legacyStatus = STATUS_MAP[session.status];

    // Check if gift already exists
    const [existing] = await pool.query(
      `SELECT id FROM gifts WHERE gift_id = ? LIMIT 1`,
      [session.reference]
    ) as [any[], any];

    if (existing && existing.length > 0) {
      // Update existing
      await pool.query(
        `UPDATE gifts
         SET gift_status = ?,
             status = ?,
             wallet_address = ?,
             crypto_amount = ?,
             current_rate = ?,
             receiver_id = ?
         WHERE gift_id = ?`,
        [
          legacyStatus,
          legacyStatus,
          session.depositAddress,
          session.cryptoAmount,
          session.rate,
          session.receiverId || null,
          session.reference,
        ]
      );
    } else {
      // Insert new
      await pool.query(
        `INSERT INTO gifts
         (gift_id, gift_status, crypto, network, estimate_asset,
          amount_payable, crypto_amount, estimate_amount, charges, date,
          payer_id, receiver_id, current_rate, merchant_rate, profit_rate,
          wallet_address, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.reference,
          legacyStatus,
          session.crypto,
          session.network,
          session.crypto,
          session.fiatAmount,
          session.cryptoAmount,
          session.fiatAmount,
          session.chargeAmount,
          session.createdAt,
          session.payerId || null,
          session.receiverId || null,
          session.rate,
          session.rate,
          0,
          session.depositAddress,
          legacyStatus,
        ]
      );
    }
  }

  /**
   * Sync request to legacy requests table.
   */
  private async syncRequest(session: PaymentSession): Promise<void> {
    const pool = (await import('../../../lib/mysql')).default;
    const legacyStatus = STATUS_MAP[session.status];

    // Check if request already exists
    const [existing] = await pool.query(
      `SELECT id FROM requests WHERE request_id = ? LIMIT 1`,
      [session.reference]
    ) as [any[], any];

    if (existing && existing.length > 0) {
      // Update existing
      await pool.query(
        `UPDATE requests
         SET request_status = ?,
             status = ?,
             wallet_address = ?,
             crypto_amount = ?,
             current_rate = ?,
             payer_id = ?
         WHERE request_id = ?`,
        [
          legacyStatus,
          legacyStatus,
          session.depositAddress,
          session.cryptoAmount,
          session.rate,
          session.payerId || null,
          session.reference,
        ]
      );
    } else {
      // Insert new
      await pool.query(
        `INSERT INTO requests
         (request_id, request_status, crypto, network, estimate_asset,
          amount_payable, crypto_amount, estimate_amount, charges, date,
          receiver_id, payer_id, current_rate, merchant_rate, profit_rate,
          wallet_address, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.reference,
          legacyStatus,
          session.crypto,
          session.network,
          session.crypto,
          session.fiatAmount,
          session.cryptoAmount,
          session.fiatAmount,
          session.chargeAmount,
          session.createdAt,
          session.receiverId || null,
          session.payerId || null,
          session.rate,
          session.rate,
          0,
          session.depositAddress,
          legacyStatus,
        ]
      );
    }
  }

  /**
   * Sync to legacy summaries table.
   */
  private async syncSummary(session: PaymentSession): Promise<void> {
    const pool = (await import('../../../lib/mysql')).default;
    const legacyStatus = STATUS_MAP[session.status];

    // Get the legacy transaction ID
    const table = this.getTableName(session.type);
    const idColumn = this.getIdColumn(session.type);

    const [txRows] = await pool.query(
      `SELECT id FROM ${table} WHERE ${idColumn} = ? LIMIT 1`,
      [session.reference]
    ) as [any[], any];

    if (!txRows || txRows.length === 0) {
      return; // No legacy record to link to
    }

    const transactionId = txRows[0].id;

    // Check if summary already exists
    const [existing] = await pool.query(
      `SELECT id FROM summaries
       WHERE transaction_id = ? AND transaction_type = ?
       LIMIT 1`,
      [transactionId, session.type]
    ) as [any[], any];

    const dollarAmount = session.cryptoAmount * session.assetPrice;

    if (existing && existing.length > 0) {
      // Update existing
      await pool.query(
        `UPDATE summaries
         SET status = ?,
             total_dollar = ?,
             total_naira = ?
         WHERE transaction_id = ? AND transaction_type = ?`,
        [
          legacyStatus,
          dollarAmount,
          session.fiatAmount,
          transactionId,
          session.type,
        ]
      );
    } else {
      // Insert new
      await pool.query(
        `INSERT INTO summaries
         (transaction_type, total_dollar, total_naira, effort,
          merchant_id, transaction_id, ref_code, asset_price, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.type,
          dollarAmount,
          session.fiatAmount,
          0, // effort
          session.merchantId ? parseInt(session.merchantId, 10) : null,
          transactionId,
          session.reference,
          session.assetPrice,
          legacyStatus,
        ]
      );
    }
  }

  /**
   * Get legacy table name for payment type.
   */
  private getTableName(type: PaymentType): string {
    switch (type) {
      case 'transfer':
        return 'transfers';
      case 'gift':
        return 'gifts';
      case 'request':
        return 'requests';
      default:
        return 'transfers';
    }
  }

  /**
   * Get ID column name for payment type.
   */
  private getIdColumn(type: PaymentType): string {
    switch (type) {
      case 'transfer':
        return 'transfer_id';
      case 'gift':
        return 'gift_id';
      case 'request':
        return 'request_id';
      default:
        return 'transfer_id';
    }
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let legacySyncServiceInstance: LegacySyncService | null = null;

/**
 * Get the legacy sync service instance.
 */
export function getLegacySyncService(): LegacySyncService {
  if (!legacySyncServiceInstance) {
    legacySyncServiceInstance = new LegacySyncService();
  }
  return legacySyncServiceInstance;
}

export const legacySyncService = getLegacySyncService();
