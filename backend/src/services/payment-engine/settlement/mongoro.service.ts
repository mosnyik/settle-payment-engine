/**
 * Mongoro Payment Service
 *
 * Handles bank transfers via Mongoro API.
 */

import config from '../../../config';
import {
  MongoroConfig,
  MongoroTransferRequest,
  MongoroTransferResponse,
} from './types';

/** Mongoro API response shape */
interface MongoroApiResponse {
  success?: boolean;
  message?: string;
  reference?: string;
  status?: string;
  data?: {
    reference?: string;
    status?: string;
    amount?: number;
    fee?: number;
    narration?: string;
    destinationAccountName?: string;
    destinationBankName?: string;
    destinationAccountNumber?: string;
    sessionId?: string;
    accountName?: string;
  };
  accountName?: string;
}

export class MongoroService {
  private readonly config: MongoroConfig;

  constructor(mongoroConfig: MongoroConfig = config.settlement.mongoro) {
    this.config = mongoroConfig;
  }

  /**
   * Check if Mongoro is properly configured
   */
  isConfigured(): boolean {
    return Boolean(this.config.token) && Boolean(this.config.transferPin);
  }

  /**
   * Initiate a bank transfer
   */
  async transfer(
    accountNumber: string,
    bankCode: string,
    bankName: string,
    accountName: string,
    amount: number,
    narration: string,
    currency: string = 'NGN'
  ): Promise<MongoroTransferResponse> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: 'Mongoro not configured: missing token or transfer PIN',
      };
    }

    const request: MongoroTransferRequest = {
      accountNumber,
      accountBank: bankCode,
      bankName,
      amount,
      saveBeneficiary: false,
      accountName,
      narration,
      currency,
      callbackUrl: this.config.callbackUrl,
      debitCurrency: currency,
      pin: this.config.transferPin,
    };

    try {
      const url = `${this.config.baseUrl}/transfer`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.token}`,
        },
        body: JSON.stringify(request),
      });

      const data = await response.json() as MongoroApiResponse;

      if (!response.ok) {
        return {
          success: false,
          message: data.message || `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      // Mongoro may return success: true/false in the body
      if (data.success === false) {
        return {
          success: false,
          message: data.message || 'Transfer failed',
        };
      }

      return {
        success: true,
        message: data.message || 'Transfer initiated',
        data: {
          reference: data.data?.reference || data.reference,
          status: data.data?.status || data.status || 'pending',
          amount: data.data?.amount || amount,
          fee: data.data?.fee || 0,
          narration: data.data?.narration || narration,
          destinationAccountName: data.data?.destinationAccountName || accountName,
          destinationBankName: data.data?.destinationBankName || bankName,
          destinationAccountNumber: data.data?.destinationAccountNumber || accountNumber,
          sessionId: data.data?.sessionId,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Mongoro] Transfer error:', error);

      return {
        success: false,
        message: `Network error: ${message}`,
      };
    }
  }

  /**
   * Get transaction status by reference
   */
  async getTransactionStatus(reference: string): Promise<{
    success: boolean;
    status?: string;
    message?: string;
  }> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: 'Mongoro not configured',
      };
    }

    try {
      const url = `${this.config.baseUrl}/transfer/status/${reference}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.token}`,
        },
      });

      const data = await response.json() as MongoroApiResponse;

      if (!response.ok) {
        return {
          success: false,
          message: data.message || `HTTP ${response.status}`,
        };
      }

      return {
        success: true,
        status: data.data?.status || data.status,
        message: data.message,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Network error: ${message}`,
      };
    }
  }

  /**
   * Verify bank account before transfer
   */
  async verifyAccount(
    accountNumber: string,
    bankCode: string
  ): Promise<{
    success: boolean;
    accountName?: string;
    message?: string;
  }> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: 'Mongoro not configured',
      };
    }

    try {
      const url = `${this.config.baseUrl}/resolve-account`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.token}`,
        },
        body: JSON.stringify({
          accountNumber,
          accountBank: bankCode,
        }),
      });

      const data = await response.json() as MongoroApiResponse;

      if (!response.ok || data.success === false) {
        return {
          success: false,
          message: data.message || 'Account verification failed',
        };
      }

      return {
        success: true,
        accountName: data.data?.accountName || data.accountName,
        message: data.message,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Network error: ${message}`,
      };
    }
  }
}

export const mongoroService = new MongoroService();
