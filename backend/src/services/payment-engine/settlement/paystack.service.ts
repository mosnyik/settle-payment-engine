/**
 * Paystack Settlement Service
 *
 * Handles bank transfers (disbursement) via Paystack Transfers API.
 * Flow: Create Recipient → Initiate Transfer → Receive Webhook
 */

import config from '../../../config';
import { PaystackConfig, PaystackTransferResponse } from './types';

interface PaystackApiResponse {
  status: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

interface PaystackRecipientData {
  recipient_code: string;
  name: string;
  account_number: string;
  bank_code: string;
}

interface PaystackTransferData {
  reference: string;
  status: string;
  amount: number;
  recipient: string;
  reason?: string;
  transfer_code?: string;
}

export class PaystackService {
  private readonly config: PaystackConfig;
  private readonly baseUrl = 'https://api.paystack.co';

  constructor(paystackConfig: PaystackConfig = config.settlement.paystack) {
    this.config = paystackConfig;
  }

  isConfigured(): boolean {
    return Boolean(this.config.secretKey);
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.secretKey}`,
    };
  }

  /**
   * Create a transfer recipient (required before initiating a transfer)
   */
  async createRecipient(
    accountNumber: string,
    bankCode: string,
    accountName: string,
    currency: string = 'NGN'
  ): Promise<{ success: boolean; recipientCode?: string; message?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/transferrecipient`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          type: 'nuban',
          name: accountName,
          account_number: accountNumber,
          bank_code: bankCode,
          currency,
        }),
      });

      const data = await res.json() as PaystackApiResponse;

      if (!res.ok || !data.status) {
        return { success: false, message: data.message || `HTTP ${res.status}` };
      }

      const recipient = data.data as unknown as PaystackRecipientData;
      return { success: true, recipientCode: recipient.recipient_code };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Paystack] Create recipient error:', error);
      return { success: false, message: `Network error: ${message}` };
    }
  }

  /**
   * Initiate a bank transfer.
   * Pass `existingRecipientCode` to skip recipient creation if already registered.
   * Amount must be in NGN (converted to kobo internally).
   * Returns `recipientCode` in data so the caller can persist it for future transfers.
   */
  async transfer(
    accountNumber: string,
    bankCode: string,
    accountName: string,
    amount: number,
    narration: string,
    currency: string = 'NGN',
    existingRecipientCode?: string
  ): Promise<PaystackTransferResponse> {
    if (!this.isConfigured()) {
      return { success: false, message: 'Paystack not configured: missing secret key' };
    }

    // Step 1: Use existing recipient code or create a new one
    let recipientCode = existingRecipientCode;
    if (!recipientCode) {
      const recipient = await this.createRecipient(accountNumber, bankCode, accountName, currency);
      if (!recipient.success || !recipient.recipientCode) {
        return { success: false, message: recipient.message || 'Failed to create recipient' };
      }
      recipientCode = recipient.recipientCode;
    }

    // Step 2: Initiate transfer (amount in kobo)
    try {
      const res = await fetch(`${this.baseUrl}/transfer`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          source: 'balance',
          amount: Math.round(amount * 100), // kobo
          recipient: recipientCode,
          reason: narration,
        }),
      });

      const data = await res.json() as PaystackApiResponse;

      if (!res.ok || !data.status) {
        return { success: false, message: data.message || `HTTP ${res.status}` };
      }

      const transfer = data.data as unknown as PaystackTransferData;
      return {
        success: true,
        message: data.message || 'Transfer initiated',
        data: {
          reference: transfer.reference,
          transferCode: transfer.transfer_code,
          status: transfer.status,
          amount: transfer.amount / 100, // back to NGN
          recipientCode,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Paystack] Transfer error:', error);
      return { success: false, message: `Network error: ${message}` };
    }
  }

  /**
   * Verify a transfer by reference
   */
  async getTransactionStatus(reference: string): Promise<{
    success: boolean;
    status?: string;
    message?: string;
  }> {
    if (!this.isConfigured()) {
      return { success: false, message: 'Paystack not configured' };
    }

    try {
      const res = await fetch(`${this.baseUrl}/transfer/${reference}`, {
        headers: this.headers,
      });

      const data = await res.json() as PaystackApiResponse;

      if (!res.ok || !data.status) {
        return { success: false, message: data.message || `HTTP ${res.status}` };
      }

      const transfer = data.data as unknown as PaystackTransferData;
      return { success: true, status: transfer.status };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Network error: ${message}` };
    }
  }

  /**
   * Get current Paystack balance (in NGN, converted from kobo)
   */
  async getBalance(): Promise<{ success: boolean; balance?: number; message?: string }> {
    if (!this.isConfigured()) {
      return { success: false, message: 'Paystack not configured' };
    }

    try {
      const res = await fetch(`${this.baseUrl}/balance`, {
        headers: this.headers,
      });

      const data = await res.json() as PaystackApiResponse;

      if (!res.ok || !data.status) {
        return { success: false, message: data.message || `HTTP ${res.status}` };
      }

      const balances = data.data as unknown as Array<{ currency: string; balance: number }>;
      const ngn = balances.find(b => b.currency === 'NGN');
      return { success: true, balance: ngn ? ngn.balance / 100 : 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Network error: ${message}` };
    }
  }

  /**
   * Check if a failure reason indicates insufficient balance
   */
  isInsufficientBalanceError(reason?: string, gatewayResponse?: string): boolean {
    const text = `${reason ?? ''} ${gatewayResponse ?? ''}`.toLowerCase();
    return text.includes('insufficient') || text.includes('not enough') || text.includes('low balance');
  }

  /**
   * Verify a Paystack webhook signature
   */
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    if (!this.config.webhookSecret) return false;
    const crypto = require('crypto') as typeof import('crypto');
    const hash = crypto
      .createHmac('sha512', this.config.webhookSecret)
      .update(rawBody)
      .digest('hex');
    return hash === signature;
  }
}

export const paystackService = new PaystackService();
