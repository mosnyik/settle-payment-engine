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
   * Resolve a bank account via NUBAN.
   * Falls back to bankName from our banks table if NUBAN doesn't return one.
   *
   * @param bankCode  - CBN bank code (from searchBanks)
   * @param accountNumber - NUBAN account number
   * @param bankNameFallback - Bank name from our DB to use if NUBAN omits it
   */
  async resolveAccount(
    bankCode: string,
    accountNumber: string,
    bankNameFallback: string
  ): Promise<ResolvedAccount> {
    const nubanApiKey = process.env.NUBAN_API_KEY;
    if (!nubanApiKey) {
      throw new Error('NUBAN_API_KEY is not configured');
    }

    const response = await axios.get<any[]>(
      `https://app.nuban.com.ng/api/${nubanApiKey}?bank_code=${bankCode}&acc_no=${accountNumber}`
    );

    if (!response.data || response.data.length === 0) {
      throw new Error('Account not found');
    }

    console.log('NUBAN resolution result:', response.data);
    const nuban = response.data[0];

    return {
      accountNumber: nuban.account_number ?? accountNumber,
      accountName: nuban.account_name,
      bankCode: nuban.bank_code ?? bankCode,
      bankName: nuban.bank_name ?? bankNameFallback,
    };
  }

  /**
   * Resolve a receiver from a bank name (user-provided text) and account number.
   *
   * Steps:
   *  1. Search banks table for the bank name → get bank code
   *  2. Call NUBAN with bank code + account number → get verified account details
   *  3. Fall back to our bank name if NUBAN doesn't return one
   *
   * @throws if bank name not found in our DB
   * @throws if NUBAN cannot resolve the account
   */
  async resolveReceiver(
    bankName: string,
    accountNumber: string
  ): Promise<ResolvedAccount> {
    // 1. Find bank code from our banks table
    const banks = await this.searchBanks(bankName);
    if (banks.length === 0) {
      throw new Error(`Bank not found: "${bankName}". Please check the bank name.`);
    }
    const bank = banks[0];

    // 2. Resolve via NUBAN, fallback to our bank name
    return this.resolveAccount(bank.code, accountNumber, bank.name);
  }
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
