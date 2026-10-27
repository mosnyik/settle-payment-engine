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
  bankName?: string;
  narration?: string;
}

/**
 * Provider-agnostic settlement outcome, translated from each provider's webhook.
 * - success:  beneficiary credited
 * - failed:   declined downstream, money not yet returned (may still resolve)
 * - reversed: money returned to the provider wallet — final
 */
export interface SettlementProviderUpdate {
  reference: string;
  status: 'success' | 'failed' | 'reversed';
  message?: string;
  fee?: number; // Fiat (naira), not minor units
  refunded?: number; // Principal returned to the provider wallet, in fiat — credited back to our ledger
  payload: Record<string, unknown>;
}

/** Legacy: kept only for Mongoro callbacks on transfers in flight at cutover. */
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
  webhookSecret: string;
}

export interface HyparrowConfig {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  webhookSecret: string;
  senderPhone: string;
  senderEmail: string;
  senderLastname: string;
  senderOthernames: string;
  timeoutMs: number;
}

export interface SettlementConfig {
  enabled: boolean;
  provider: 'hyparrow';
  hyparrow: HyparrowConfig;
  mongoro: { webhookIps: string[] };
  telegram: TelegramAlertConfig;
}

// =============================================================================
// HYPARROW
// =============================================================================

/** Body of POST /money-transfer/send. Amount is kobo as a string. */
export interface HyparrowSendRequest {
  amount: string;
  recipientAccount: string;
  recipientBankCode: string;
  recipientName: string;
  senderPhone: string;
  senderEmail: string;
  senderLastname: string;
  senderOthernames: string;
  narration?: string;
  clientReference: string;
}

/** Envelope shared by Hyparrow transfer webhooks (transfer.settled / failed / reversed). */
export interface HyparrowTransferWebhook {
  event: string;
  timestamp: number | string;
  data: {
    transferCode?: string;
    clientReference?: string;
    status?: string;
    amount?: number; // kobo
    fee?: number; // kobo
    reason?: string;
    totalReturned?: number; // kobo
    provider?: {
      transactionResponseCode?: string;
      transactionRef?: string;
      responseMessage?: string;
    };
    [key: string]: unknown;
  };
}
