/**
 * Participant Service
 *
 * Handles payer and receiver creation/lookup for payment sessions.
 * All receiver creation goes through NUBAN verification via BankService
 * before being written to the database.
 */

import { PayerInput, ReceiverInput } from '../types';
import { bankService, ResolvedAccount } from '../../bank/bank.service';

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
   */
  async getOrCreatePayer(payer: PayerInput): Promise<number> {
    const pool = (await import('../../../lib/mysql')).default;

    const [rows] = await pool.query(
      `SELECT id FROM payers WHERE chat_id = ? OR phone = ? LIMIT 1`,
      [payer.chatId, payer.phone || null]
    ) as [any[], any];

    if (rows && rows.length > 0) {
      return rows[0].id;
    }

    const [result] = await pool.query(
      `INSERT INTO payers (chat_id, phone) VALUES (?, ?)`,
      [payer.chatId, payer.phone || null]
    ) as [any, any];

    return result.insertId;
  }

  /**
   * Resolve and verify receiver bank details via NUBAN before any DB write.
   *
   * Takes the user-provided bank name and account number, looks up the bank
   * code from our banks table, then calls NUBAN to get the verified account name.
   * Falls back to our bank name if NUBAN doesn't return one.
   *
   * @throws if bank name not found in our DB
   * @throws if NUBAN cannot resolve the account
   */
  async resolveReceiver(
    bankName: string,
    accountNumber: string
  ): Promise<ResolvedAccount> {
    return bankService.resolveReceiver(bankName, accountNumber);
  }

  /**
   * Get or create a receiver record.
   * Finds existing receiver by bank account and bank code.
   * Creates new if not found.
   *
   * Expects already-resolved receiver data (bankCode, accountNumber, accountName, bankName).
   * Call resolveReceiver() first to get verified details from NUBAN.
   */
  async getOrCreateReceiver(receiver: ReceiverInput): Promise<number> {
    const pool = (await import('../../../lib/mysql')).default;

    try {
      // Look up by account number + bank code (unique combination)
      const [rows] = await pool.query(
        `SELECT id FROM receivers
         WHERE bank_account = ? AND bank_code = ?
         LIMIT 1`,
        [receiver.accountNumber, receiver.bankCode]
      ) as [any[], any];

      if (rows && rows.length > 0) {
        return rows[0].id;
      }

      const [result] = await pool.query(
        `INSERT INTO receivers (bank_account, bank_code, bank_name, account_name, phone)
         VALUES (?, ?, ?, ?, ?)`,
        [
          receiver.accountNumber,
          receiver.bankCode,
          receiver.bankName ?? null,
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
   */
  async getPayer(payerId: number): Promise<PayerRecord | null> {
    const pool = (await import('../../../lib/mysql')).default;

    const [rows] = await pool.query(
      `SELECT id, chat_id, phone FROM payers WHERE id = ?`,
      [payerId]
    ) as [any[], any];

    if (!rows || rows.length === 0) return null;

    return {
      id: rows[0].id,
      chatId: rows[0].chat_id,
      phone: rows[0].phone || undefined,
    };
  }

  /**
   * Get receiver by ID.
   */
  async getReceiver(receiverId: number): Promise<ReceiverRecord | null> {
    const pool = (await import('../../../lib/mysql')).default;

    const [rows] = await pool.query(
      `SELECT id, bank_name, bank_account, account_name, phone
       FROM receivers WHERE id = ?`,
      [receiverId]
    ) as [any[], any];

    if (!rows || rows.length === 0) return null;

    return {
      id: rows[0].id,
      bankCode: rows[0].bank_name,
      bankAccount: rows[0].bank_account,
      accountName: rows[0].account_name,
      phone: rows[0].phone || undefined,
    };
  }

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
    await pool.query(`UPDATE payers SET ${fields.join(', ')} WHERE id = ?`, values);
  }

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
    await pool.query(`UPDATE receivers SET ${fields.join(', ')} WHERE id = ?`, values);
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let participantServiceInstance: ParticipantService | null = null;

export function getParticipantService(): ParticipantService {
  if (!participantServiceInstance) {
    participantServiceInstance = new ParticipantService();
  }
  return participantServiceInstance;
}

export const participantService = getParticipantService();
