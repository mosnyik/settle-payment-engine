/**
 * Bank Service
 *
 * Shared service for bank lookups and NUBAN account resolution.
 * Used by route handlers and internally by participant service
 * to verify receiver details before any payment is processed.
 */

import axios from 'axios';
import pool from '../../lib/mysql';

// =============================================================================
// TYPES
// =============================================================================

export interface BankRecord {
  name: string;
  code: string;
}

export interface ResolvedAccount {
  accountNumber: string;
  accountName: string;
  bankCode: string;
  bankName: string;
}

// =============================================================================
// SERVICE
// =============================================================================

export class BankService {
  /**
   * Search banks table by name.
   * Returns matching banks with their codes.
   */
  async searchBanks(name: string): Promise<BankRecord[]> {
    const [rows] = await pool.query<any[]>(
      `SELECT name, code FROM banks WHERE name LIKE ? LIMIT 10`,
      [`${name}%`]
    );
    return rows.map((r) => ({ name: r.name, code: r.code }));
  }

  /**
   * Look up a bank record by its CBN code.
   */
  async getBankByCode(code: string): Promise<BankRecord | null> {
    const [rows] = await pool.query<any[]>(
      `SELECT name, code FROM banks WHERE code = ? LIMIT 1`,
      [code]
    );
    return rows.length > 0 ? { name: rows[0].name, code: rows[0].code } : null;
  }

  /**
   * Resolve a bank account via NUBAN.
   * If bankNameFallback is not provided, looks up the bank name from our banks
   * table using the bank code so the name is always populated.
   *
   * @param bankCode       - CBN bank code
   * @param accountNumber  - NUBAN account number
   * @param bankNameFallback - Optional override; auto-looked up from DB if omitted
   */
  async resolveAccount(
    bankCode: string,
    accountNumber: string,
    bankNameFallback?: string
  ): Promise<ResolvedAccount> {
    const nubanApiKey = process.env.NUBAN_API_KEY;
    if (!nubanApiKey) {
      throw new Error('NUBAN_API_KEY is not configured');
    }

    // Auto-lookup bank name from DB if not provided — NUBAN doesn't return it
    const resolvedBankName = bankNameFallback || (await this.getBankByCode(bankCode))?.name || bankCode;

    let response;
    try {
      response = await axios.get<any[]>(
        `https://app.nuban.com.ng/api/${nubanApiKey}?bank_code=${bankCode}&acc_no=${accountNumber}`
      );
    } catch (err: any) {
      console.error('[BankService] NUBAN API request failed:', err.message, err.response?.status, err.response?.data);
      throw new Error('NUBAN_SERVICE_UNAVAILABLE');
    }

    // NUBAN returns an error object { error: true, message: '...' } on failure instead of an array
    if (!Array.isArray(response.data) || response.data.length === 0) {
      console.error('[BankService] NUBAN error response:', response.data);
      const nubanMsg: string = (response.data as any)?.message ?? '';
      if (nubanMsg.toLowerCase().includes('api key') || nubanMsg.toLowerCase().includes('api_key')) {
        throw new Error('NUBAN_SERVICE_UNAVAILABLE');
      }
      throw new Error('Could not verify account details. Please confirm the account number and bank code are correct.');
    }

    console.log('NUBAN resolution result:', response.data);
    const nuban = response.data[0];

    return {
      accountNumber: nuban.account_number ?? accountNumber,
      accountName: nuban.account_name,
      bankCode: nuban.bank_code ?? bankCode,
      bankName: nuban.bank_name || resolvedBankName,
    };
  }

  // /**
  //  * @deprecated — resolveReceiver() accepted a bank name and searched the DB
  //  * to get the bank code before calling NUBAN. All callers now receive bankCode
  //  * directly (from GET /banks/list or POST /payments/verify-receiver) and call
  //  * resolveAccount() instead. Bank name is auto-looked up inside resolveAccount()
  //  * so callers no longer need to pass it.
  //  *
  //  * Resolve a receiver from a bank name (user-provided text) and account number.
  //  *  1. Search banks table for the bank name → get bank code
  //  *  2. Call NUBAN with bank code + account number → get verified account details
  //  *  3. Fall back to our bank name if NUBAN doesn't return one
  //  */
  // async resolveReceiver(bankName: string, accountNumber: string): Promise<ResolvedAccount> {
  //   const banks = await this.searchBanks(bankName);
  //   if (banks.length === 0) {
  //     throw new Error(`Bank not found: "${bankName}". Please check the bank name.`);
  //   }
  //   const bank = banks[0];
  //   return this.resolveAccount(bank.code, accountNumber, bank.name);
  // }
}

// =============================================================================
// SINGLETON
// =============================================================================

let instance: BankService | null = null;

export function getBankService(): BankService {
  if (!instance) {
    instance = new BankService();
  }
  return instance;
}

export const bankService = getBankService();
