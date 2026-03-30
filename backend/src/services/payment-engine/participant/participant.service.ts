/**
 * Participant Service
 *
 * Handles payer and receiver creation/lookup for payment sessions.
 * Maps PaymentEngine input format to database tables.
 */

import { PayerInput, ReceiverInput } from '../types';

// =============================================================================
// TYPES
// =============================================================================

export interface PayerRecord {
  id: number;
  chatId: string;
  phone?: string;
}

export interface ReceiverRecord {
  id: number;
  bankCode: string;
  bankAccount: string;
  accountName: string;
  phone?: string;
}

// =============================================================================
// SERVICE
// =============================================================================

export class ParticipantService {
  /**
   * Get or create a payer record.
   * Finds existing payer by chat ID or phone, creates new if not found.
   *
   * @param payer - Payer input from PaymentEngine
   * @returns Payer database ID
   */
  async getOrCreatePayer(payer: PayerInput): Promise<number> {
    const pool = (await import('../../../lib/mysql')).default;

    // Try to find existing payer by chat_id or phone
    const [rows] = await pool.query(
      `SELECT id FROM payers WHERE chat_id = ? OR phone = ? LIMIT 1`,
      [payer.chatId, payer.phone || null]
    ) as [any[], any];

    if (rows && rows.length > 0) {
      return rows[0].id;
    }

    // Create new payer
    const [result] = await pool.query(
      `INSERT INTO payers (chat_id, phone) VALUES (?, ?)`,
      [payer.chatId, payer.phone || null]
    ) as [any, any];

    return result.insertId;
  }

  /**
   * Get or create a receiver record.
   * Finds existing receiver by bank account and bank name, creates new if not found.
   *
   * @param receiver - Receiver input from PaymentEngine
   * @returns Receiver database ID
   */
  async getOrCreateReceiver(receiver: ReceiverInput): Promise<number> {
    const pool = (await import('../../../lib/mysql')).default;

    try {
      // Try to find existing receiver by bank_account and bank_name (legacy column names)
      const [rows] = await pool.query(
        `SELECT id FROM receivers
         WHERE bank_account = ? AND bank_name = ?
         LIMIT 1`,
        [receiver.accountNumber, receiver.bankCode]
      ) as [any[], any];

      if (rows && rows.length > 0) {
        return rows[0].id;
      }

      // Create new receiver (using legacy column names)
      const [result] = await pool.query(
        `INSERT INTO receivers (bank_account, bank_name, account_name, phone)
         VALUES (?, ?, ?, ?)`,
        [
          receiver.accountNumber,
          receiver.bankCode,
          receiver.accountName,
          receiver.phone || null,
        ]
      ) as [any, any];

      return result.insertId;
    } catch (error: any) {
      console.error('[ParticipantService] Receiver error:', error.message, error.code);
      throw error;
    }
  }

  /**
   * Get payer by ID.
   *
   * @param payerId - Payer database ID
   * @returns Payer record or null
   */
  async getPayer(payerId: number): Promise<PayerRecord | null> {
    const pool = (await import('../../../lib/mysql')).default;

    const [rows] = await pool.query(
      `SELECT id, chat_id, phone FROM payers WHERE id = ?`,
      [payerId]
    ) as [any[], any];

    if (!rows || rows.length === 0) {
      return null;
    }

    return {
      id: rows[0].id,
      chatId: rows[0].chat_id,
      phone: rows[0].phone || undefined,
    };
  }

  /**
   * Get receiver by ID.
   *
   * @param receiverId - Receiver database ID
   * @returns Receiver record or null
   */
  async getReceiver(receiverId: number): Promise<ReceiverRecord | null> {
    const pool = (await import('../../../lib/mysql')).default;

    const [rows] = await pool.query(
      `SELECT id, bank_name, bank_account, account_name, phone
       FROM receivers WHERE id = ?`,
      [receiverId]
    ) as [any[], any];

    if (!rows || rows.length === 0) {
      return null;
    }

    return {
      id: rows[0].id,
      bankCode: rows[0].bank_name,
      bankAccount: rows[0].bank_account,
      accountName: rows[0].account_name,
      phone: rows[0].phone || undefined,
    };
  }

  /**
   * Update payer record.
   *
   * @param payerId - Payer database ID
   * @param updates - Fields to update
   */
  async updatePayer(
    payerId: number,
    updates: Partial<Pick<PayerInput, 'phone'>>
  ): Promise<void> {
    if (Object.keys(updates).length === 0) return;

    const pool = (await import('../../../lib/mysql')).default;
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.phone !== undefined) {
      fields.push('phone = ?');
      values.push(updates.phone);
    }

    if (fields.length === 0) return;

    values.push(payerId);
    await pool.query(
      `UPDATE payers SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  }

  /**
   * Update receiver record.
   *
   * @param receiverId - Receiver database ID
   * @param updates - Fields to update
   */
  async updateReceiver(
    receiverId: number,
    updates: Partial<ReceiverInput>
  ): Promise<void> {
    if (Object.keys(updates).length === 0) return;

    const pool = (await import('../../../lib/mysql')).default;
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.bankCode !== undefined) {
      fields.push('bank_name = ?');
      values.push(updates.bankCode);
    }
    if (updates.accountNumber !== undefined) {
      fields.push('bank_account = ?');
      values.push(updates.accountNumber);
    }
    if (updates.accountName !== undefined) {
      fields.push('account_name = ?');
      values.push(updates.accountName);
    }
    if (updates.phone !== undefined) {
      fields.push('phone = ?');
      values.push(updates.phone);
    }

    if (fields.length === 0) return;

    values.push(receiverId);
    await pool.query(
      `UPDATE receivers SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let participantServiceInstance: ParticipantService | null = null;

/**
 * Get the participant service instance.
 */
export function getParticipantService(): ParticipantService {
  if (!participantServiceInstance) {
    participantServiceInstance = new ParticipantService();
  }
  return participantServiceInstance;
}

export const participantService = getParticipantService();
