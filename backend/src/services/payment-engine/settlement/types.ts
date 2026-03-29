/**
 * Settlement Types
 *
 * Types for fiat payout (settlement) after crypto deposit confirmation.
 */

export interface SettlementRequest {
  sessionId: string;
  amount: number; // Fiat amount
  currency: string; // NGN
  accountNumber: string;
  bankCode: string;
  accountName: string;
  narration?: string;
}

export interface MongoroTransferRequest {
  accountNumber: string;
  accountBank: string; // Bank code
  bankName: string;
  amount: number;
  saveBeneficiary: boolean;
  accountName: string;
  narration: string;
  currency: string;
  callbackUrl: string;
  debitCurrency: string;
  pin: string;
}

export interface MongoroTransferResponse {
  success: boolean;
  message: string;
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
  };
}

export interface MongoroWebhookPayload {
  reference: string;
  status: 'success' | 'failed' | 'reversed' | 'pending';
  message?: string;
  amount?: number;
  fee?: number;
  sessionId?: string;
  destinationAccountNumber?: string;
  destinationBankName?: string;
}

export type SettlementAttemptStatus = 'pending' | 'success' | 'failed' | 'reversed';

export interface SettlementAttempt {
  id: number;
  sessionId: string;
  provider: string;
  reference: string | null;
  status: SettlementAttemptStatus;
  amount: number;
  accountNumber: string;
  bankCode: string;
  accountName: string;
  requestPayload: Record<string, unknown> | null;
  responsePayload: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSettlementAttemptData {
  sessionId: string;
  provider?: string;
  reference?: string;
  status: SettlementAttemptStatus;
  amount: number;
  accountNumber: string;
  bankCode: string;
  accountName: string;
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  errorMessage?: string;
}

export interface TelegramAlertConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface MongoroConfig {
  baseUrl: string;
  token: string;
  transferPin: string;
  callbackUrl: string;
}

export interface PaystackConfig {
  secretKey: string;
  webhookSecret: string;
}

export interface PaystackTransferResponse {
  success: boolean;
  message: string;
  data?: {
    reference: string;
    transferCode?: string;
    status: string;
    amount: number;
    recipientCode: string;
  };
}

export interface PaystackWebhookPayload {
  event: 'transfer.success' | 'transfer.failed' | 'transfer.reversed';
  data: {
    reference: string;
    status: string;
    amount: number;
    reason?: string;
    gateway_response?: string;
    transfer_code?: string;
    recipient?: {
      account_number?: string;
      name?: string;
    };
  };
}

export interface SettlementConfig {
  enabled: boolean;
  provider: 'mongoro';
  mongoro: MongoroConfig;
  paystack: PaystackConfig;
  telegram: TelegramAlertConfig;
}
