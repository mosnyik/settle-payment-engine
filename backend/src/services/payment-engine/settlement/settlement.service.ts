/**
 * Settlement Service
 *
 * Orchestrates fiat payout after crypto deposit confirmation.
 * Uses Mongoro for bank transfers with Telegram fallback for failures.
 */

import crypto from 'crypto';
import config from '../../../config';
import { pool } from '../../../lib/mysql';
import { MongoroService, mongoroService } from './mongoro.service';
import { PaystackService, paystackService } from './paystack.service';
import { TelegramService, telegramService, SessionAlertData } from './telegram.service';
import { sendPaymentWebhook } from '../payment-webhook.service';
import {
  SettlementConfig,
  SettlementAttempt,
  CreateSettlementAttemptData,
  MongoroWebhookPayload,
  PaystackWebhookPayload,
} from './types';
import { getApiKeyById } from '../../../security/services/apiKey.service';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

interface ReceiverRow extends RowDataPacket {
  id: number;
  bank_code: string;
  account_number: string;
  account_name: string;
  bank_name?: string;
  paystack_recipient_code: string | null;
}

interface ReceiverData {
  accountNumber: string;
  bankCode: string;
  accountName: string;
  bankName?: string;
  paystackRecipientCode?: string;
}

interface SessionRow extends RowDataPacket {
  id: string;
  reference: string;
  status: string;
  fiat_amount: number;
  fiat_currency: string;
  receiver_id: number | null;
  api_key_id: number | null;
  settlement_token: string | null;
  settlement_token_expires_at: Date | null;
}

export class SettlementService {
  private readonly config: SettlementConfig;
  private readonly mongoro: MongoroService;
  private readonly paystack: PaystackService;
  private readonly telegram: TelegramService;

  constructor(
    settlementConfig: SettlementConfig = config.settlement,
    mongoroSvc: MongoroService = mongoroService,
    paystackSvc: PaystackService = paystackService,
    telegramSvc: TelegramService = telegramService
  ) {
    this.config = settlementConfig;
    this.mongoro = mongoroSvc;
    this.paystack = paystackSvc;
    this.telegram = telegramSvc;
  }

  /**
   * Check if settlement is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Initiate settlement for a confirmed session.
   * Called automatically when deposit is confirmed.
   */
  async settleSession(sessionId: string): Promise<void> {
    if (!this.isEnabled()) {
      console.log(`[Settlement] Disabled, skipping session ${sessionId}`);
      return;
    }

    // 1. Get session and validate
    const session = await this.getSession(sessionId);
    if (!session) {
      console.error(`[Settlement] Session not found: ${sessionId}`);
      return;
    }

    if (session.status !== 'confirmed') {
      console.error(`[Settlement] Invalid status for ${sessionId}: ${session.status} (expected confirmed)`);
      return;
    }

    // 2. Get receiver bank details
    const receiver = await this.getReceiver(session.receiver_id);
    if (!receiver) {
      console.error(`[Settlement] No receiver for session ${sessionId}`);
      await this.handleSettlementFailure(
        session,
        { accountNumber: 'N/A', bankCode: 'N/A', accountName: 'N/A' },
        'No receiver bank details found'
      );
      return;
    }

    // 3. Determine settlement mode from the API key that created this session
    const settlementMode = await this.getSettlementMode(session.api_key_id);

    // 4. Update status to settling
    await this.updateSessionStatus(sessionId, 'settling');

    if (settlementMode === 'self') {
      // Self-settlement: generate a one-time token, store it, fire webhook with token included.
      // The integrator must echo this token back on POST /payments/:ref/settle.
      const settlementToken = crypto.randomBytes(32).toString('hex');
      const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await pool.execute(
        `UPDATE payment_sessions
         SET settlement_token = ?, settlement_token_expires_at = ?, updated_at = NOW()
         WHERE id = ?`,
        [settlementToken, tokenExpiresAt, sessionId]
      );

      await this.createSettlementAttempt({
        sessionId,
        provider: 'self',
        status: 'pending',
        amount: session.fiat_amount,
        accountNumber: receiver.accountNumber,
        bankCode: receiver.bankCode,
        accountName: receiver.accountName,
      });

      // Include token in the payment.settling webhook payload — only the integrator's
      // server receives this, so they are the only ones who can complete the settlement.
      sendPaymentWebhook(sessionId, 'payment.settling', { settlementToken }).catch(() => {});

      console.log(`[Settlement] Self-settlement mode for ${session.reference} — token issued, awaiting integrator callback`);
      return;
    }

    const narration = `2Settle ${session.reference}`;

    if (settlementMode === 'paystack') {
      // 5a. Pre-flight balance check — don't attempt a transfer we know will fail
      const balanceResult = await this.paystack.getBalance();
      if (balanceResult.success && balanceResult.balance !== undefined) {
        if (balanceResult.balance < session.fiat_amount) {
          // Balance won't cover this payment — alert and leave in settling for manual resolution
          await this.telegram.sendPaystackInsufficientBalanceAlert(
            { reference: session.reference, fiatAmount: session.fiat_amount, fiatCurrency: session.fiat_currency },
            receiver,
            'pre-transfer-check'
          );
          console.error(`[Settlement][Paystack] Insufficient balance (${balanceResult.balance}) for ${session.reference} (${session.fiat_amount}) — skipping transfer`);
          return;
        }
      }

      // 5b. Paystack mode — initiate transfer
      const attemptId = await this.createSettlementAttempt({
        sessionId,
        provider: 'paystack',
        status: 'pending',
        amount: session.fiat_amount,
        accountNumber: receiver.accountNumber,
        bankCode: receiver.bankCode,
        accountName: receiver.accountName,
      });

      const response = await this.paystack.transfer(
        receiver.accountNumber,
        receiver.bankCode,
        receiver.accountName,
        session.fiat_amount,
        narration,
        session.fiat_currency,
        receiver.paystackRecipientCode
      );

      if (response.success && response.data?.reference) {
        // Cache recipient code on first successful transfer so future transfers skip createRecipient()
        if (!receiver.paystackRecipientCode && response.data.recipientCode && session.receiver_id) {
          await pool.execute(
            `UPDATE receivers SET paystack_recipient_code = ? WHERE id = ?`,
            [response.data.recipientCode, session.receiver_id]
          );
        }

        await this.updateSettlementAttempt(attemptId, {
          status: 'pending',
          reference: response.data.reference,
          responsePayload: response.data as unknown as Record<string, unknown>,
        });
        await this.updateSessionSettlement(sessionId, response.data.reference, 'paystack');
        console.log(`[Settlement][Paystack] Initiated for ${session.reference}, ref: ${response.data.reference}`);
      } else {
        await this.updateSettlementAttempt(attemptId, {
          status: 'failed',
          errorMessage: response.message,
          responsePayload: response as unknown as Record<string, unknown>,
        });
        await this.handleSettlementFailure(session, receiver, response.message);
      }
      return;
    }

    // 5b. Mongoro mode: create attempt record
    const attemptData: CreateSettlementAttemptData = {
      sessionId,
      provider: 'mongoro',
      status: 'pending',
      amount: session.fiat_amount,
      accountNumber: receiver.accountNumber,
      bankCode: receiver.bankCode,
      accountName: receiver.accountName,
    };

    const attemptId = await this.createSettlementAttempt(attemptData);

    // 6. Call Mongoro API
    const response = await this.mongoro.transfer(
      receiver.accountNumber,
      receiver.bankCode,
      receiver.bankName || receiver.bankCode,
      receiver.accountName,
      session.fiat_amount,
      narration,
      session.fiat_currency
    );

    // 7. Handle response
    if (response.success && response.data?.reference) {
      await this.updateSettlementAttempt(attemptId, {
        status: 'pending', // Still pending until webhook confirms
        reference: response.data.reference,
        responsePayload: response.data as unknown as Record<string, unknown>,
      });

      await this.updateSessionSettlement(sessionId, response.data.reference, 'mongoro');

      console.log(`[Settlement] Initiated for ${session.reference}, ref: ${response.data.reference}`);
    } else {
      await this.updateSettlementAttempt(attemptId, {
        status: 'failed',
        errorMessage: response.message,
        responsePayload: response as unknown as Record<string, unknown>,
      });

      await this.handleSettlementFailure(session, receiver, response.message);
    }
  }

  /**
   * Confirm settlement for self-settlement mode.
   * Called by the integrator after they have sent the fiat to the receiver.
   * Requires the settlementToken that was included in the payment.settling webhook.
   */
  async confirmSelfSettlement(
    reference: string,
    settlementToken: string,
    settlementReference?: string
  ): Promise<{ success: boolean; message: string }> {
    const session = await this.getSessionByReference(reference);
    if (!session) {
      return { success: false, message: 'Session not found' };
    }

    if (session.status !== 'settling') {
      return { success: false, message: `Invalid status: ${session.status} (expected settling)` };
    }

    const settlementMode = await this.getSettlementMode(session.api_key_id);
    if (settlementMode !== 'self') {
      return { success: false, message: 'This session is not in self-settlement mode' };
    }

    // Validate the one-time settlement token
    if (!session.settlement_token) {
      return { success: false, message: 'No settlement token found for this session' };
    }
    if (!crypto.timingSafeEqual(
      Buffer.from(session.settlement_token),
      Buffer.from(settlementToken)
    )) {
      console.warn(`[Settlement] Invalid settlement token attempt for ${reference}`);
      return { success: false, message: 'Invalid settlement token' };
    }
    if (session.settlement_token_expires_at && new Date() > session.settlement_token_expires_at) {
      return { success: false, message: 'Settlement token has expired' };
    }

    // Consume the token — one-time use only
    await pool.execute(
      `UPDATE payment_sessions SET settlement_token = NULL, settlement_token_expires_at = NULL, updated_at = NOW() WHERE id = ?`,
      [session.id]
    );

    await this.markSessionSettled(session.id);

    if (settlementReference) {
      await pool.execute(
        `UPDATE payment_sessions SET settlement_reference = ?, settlement_provider = 'self', updated_at = NOW() WHERE id = ?`,
        [settlementReference, session.id]
      );
    }

    // Mark the pending self-settlement attempt as success
    const [attempts] = await pool.execute<(SettlementAttempt & RowDataPacket)[]>(
      `SELECT * FROM settlement_attempts WHERE session_id = ? AND provider = 'self' ORDER BY created_at DESC LIMIT 1`,
      [session.id]
    );
    if (attempts[0]) {
      await this.updateSettlementAttempt(attempts[0].id, {
        status: 'success',
        reference: settlementReference,
      });
    }

    sendPaymentWebhook(session.id, 'payment.settled').catch(() => {});
    console.log(`[Settlement] Self-settlement confirmed for ${reference}`);

    return { success: true, message: 'Session marked as settled' };
  }

  /**
   * Handle settlement failure - send Telegram alert or mark as failed
   */
  private async handleSettlementFailure(
    session: SessionRow,
    receiver: ReceiverData,
    error: string
  ): Promise<void> {
    console.error(`[Settlement] Failed for ${session.reference}: ${error}`);

    // Convert SessionRow to SessionAlertData
    const sessionData: SessionAlertData = {
      reference: session.reference,
      fiatAmount: session.fiat_amount,
      fiatCurrency: session.fiat_currency,
    };

    // Try to send Telegram alert
    const alertSent = await this.telegram.sendSettlementFailureAlert(
      sessionData,
      receiver,
      error
    );

    if (alertSent) {
      // Telegram succeeded - stay in settling, admin will handle
      console.log(`[Settlement] Telegram alert sent for ${session.reference}, awaiting manual settlement`);
    } else {
      // Both Mongoro AND Telegram failed - mark as failed
      console.error(`[Settlement] Both Mongoro and Telegram failed for ${session.reference}, marking as failed`);
      await this.updateSessionStatus(session.id, 'failed');
      sendPaymentWebhook(session.id, 'payment.failed').catch(() => {});
    }
  }

  /**
   * Handle Paystack webhook callback
   */
  async handlePaystackWebhook(payload: PaystackWebhookPayload): Promise<void> {
    const { event, data } = payload;
    const reference = data?.reference;

    if (!reference) {
      console.error('[Settlement][Paystack] Webhook missing reference');
      return;
    }

    const session = await this.getSessionBySettlementReference(reference);
    if (!session) {
      console.error(`[Settlement][Paystack] No session found for reference: ${reference}`);
      return;
    }

    if (session.status !== 'settling') {
      console.warn(`[Settlement][Paystack] Webhook for ${reference} but session status is ${session.status}`);
      return;
    }

    const attempt = await this.getSettlementAttemptByReference(reference);

    if (event === 'transfer.success') {
      if (attempt) {
        await this.updateSettlementAttempt(attempt.id, {
          status: 'success',
          responsePayload: payload as unknown as Record<string, unknown>,
        });
      }
      await this.markSessionSettled(session.id);
      sendPaymentWebhook(session.id, 'payment.settled').catch(() => {});
      console.log(`[Settlement][Paystack] Completed for ${session.reference}`);
      // Check balance after each successful transfer — catch low balance before the next one fails
      this.checkPaystackBalance().catch(() => {});
      return;
    }

    if (event === 'transfer.failed' || event === 'transfer.reversed') {
      const isInsufficientBalance = this.paystack.isInsufficientBalanceError(
        data.reason,
        data.gateway_response
      );

      // Mark attempt as failed regardless
      if (attempt) {
        await this.updateSettlementAttempt(attempt.id, {
          status: event === 'transfer.reversed' ? 'reversed' : 'failed',
          errorMessage: data.reason,
          responsePayload: payload as unknown as Record<string, unknown>,
        });
      }

      if (isInsufficientBalance) {
        // Keep session in 'settling' — do NOT mark as reversed.
        // Admin tops up Paystack balance and uses /settle to confirm manually.
        const sessionData = await this.getSession(session.id);
        const receiver = await this.getReceiver(session.receiver_id);

        if (sessionData && receiver) {
          await this.telegram.sendPaystackInsufficientBalanceAlert(
            {
              reference: sessionData.reference,
              fiatAmount: sessionData.fiat_amount,
              fiatCurrency: sessionData.fiat_currency,
            },
            receiver,
            reference
          );
        }

        console.error(`[Settlement][Paystack] Insufficient balance for ${session.reference} — staying in settling, awaiting manual resolution`);
        return;
      }

      // Any other failure/reversal — mark as reversed and alert
      await this.updateSessionStatus(session.id, 'settlement_reversed');
      sendPaymentWebhook(session.id, 'payment.settlement_reversed').catch(() => {});

      const sessionData = await this.getSession(session.id);
      if (sessionData) {
        await this.telegram.sendSettlementReversalAlert(
          {
            reference: sessionData.reference,
            fiatAmount: sessionData.fiat_amount,
            fiatCurrency: sessionData.fiat_currency,
          },
          reference,
          `Paystack: ${data.reason || event.replace('transfer.', '')}`
        );
      }

      console.error(`[Settlement][Paystack] ${event} for ${session.reference}: ${data.reason ?? 'unknown reason'}`);
    }
  }

  /**
   * Check Paystack balance and send a low balance alert if below the configured threshold.
   * Called after each successful transfer so the next one doesn't silently fail.
   */
  async checkPaystackBalance(): Promise<void> {
    const threshold = this.config.paystack.lowBalanceThreshold;
    const result = await this.paystack.getBalance();
    if (!result.success || result.balance === undefined) return;

    if (result.balance < threshold) {
      await this.telegram.sendPaystackLowBalanceAlert(result.balance);
      console.warn(`[Settlement][Paystack] Low balance alert: NGN ${result.balance.toLocaleString()} (threshold: NGN ${threshold.toLocaleString()})`);
    }
  }

  /**
   * Handle Mongoro webhook callback
   */
  async handleWebhook(payload: MongoroWebhookPayload): Promise<void> {
    const { reference, status, message } = payload;

    if (!reference) {
      console.error('[Settlement] Webhook missing reference');
      return;
    }

    // Find session by settlement reference
    const session = await this.getSessionBySettlementReference(reference);
    if (!session) {
      console.error(`[Settlement] No session found for reference: ${reference}`);
      return;
    }

    // Validate session is in settling status
    if (session.status !== 'settling') {
      console.warn(`[Settlement] Webhook for ${reference} but session status is ${session.status}`);
      return;
    }

    // Update settlement attempt
    const attempt = await this.getSettlementAttemptByReference(reference);
    if (attempt) {
      await this.updateSettlementAttempt(attempt.id, {
        status: status === 'success' ? 'success' : status === 'reversed' ? 'reversed' : 'failed',
        responsePayload: payload as unknown as Record<string, unknown>,
        errorMessage: status !== 'success' ? message : undefined,
      });
    }

    // Handle based on status
    if (status === 'success') {
      // Mark session as settled
      await this.markSessionSettled(session.id);
      sendPaymentWebhook(session.id, 'payment.settled').catch(() => {});
      console.log(`[Settlement] Completed for ${session.reference}`);
    } else if (status === 'reversed' || status === 'failed') {
      // Mark as reversed and send alert
      await this.updateSessionStatus(session.id, 'settlement_reversed');
      sendPaymentWebhook(session.id, 'payment.settlement_reversed').catch(() => {});

      const sessionData = await this.getSession(session.id);
      if (sessionData) {
        await this.telegram.sendSettlementReversalAlert(
          {
            reference: sessionData.reference,
            fiatAmount: sessionData.fiat_amount,
            fiatCurrency: sessionData.fiat_currency,
          },
          reference,
          message || `Transfer ${status}`
        );
      }

      console.error(`[Settlement] ${status} for ${session.reference}: ${message}`);
    }
  }

  /**
   * Manual settlement - called when admin pays manually via Telegram
   */
  async manualSettle(reference: string): Promise<{ success: boolean; message: string }> {
    const session = await this.getSessionByReference(reference);
    if (!session) {
      return { success: false, message: 'Session not found' };
    }

    if (session.status !== 'settling') {
      return { success: false, message: `Invalid status: ${session.status} (expected settling)` };
    }

    await this.markSessionSettled(session.id);
    sendPaymentWebhook(session.id, 'payment.settled').catch(() => {});

    // Record manual settlement attempt
    await this.createSettlementAttempt({
      sessionId: session.id,
      provider: 'manual',
      status: 'success',
      amount: session.fiat_amount,
      accountNumber: 'manual',
      bankCode: 'manual',
      accountName: 'Manual settlement by admin',
    });

    console.log(`[Settlement] Manual settlement completed for ${reference}`);
    return { success: true, message: 'Session marked as settled' };
  }

  // =============================================================================
  // DATABASE HELPERS
  // =============================================================================

  private async getSettlementMode(apiKeyId: number | null | undefined): Promise<'mongoro' | 'paystack' | 'self'> {
    if (!apiKeyId) return 'mongoro';
    try {
      const apiKey = await getApiKeyById(apiKeyId);
      return apiKey?.settlementMode ?? 'mongoro';
    } catch {
      return 'mongoro';
    }
  }

  private async getSession(sessionId: string): Promise<SessionRow | null> {
    const [rows] = await pool.execute<SessionRow[]>(
      `SELECT id, reference, status, fiat_amount, fiat_currency, receiver_id, api_key_id
       FROM payment_sessions WHERE id = ?`,
      [sessionId]
    );
    return rows[0] || null;
  }

  private async getSessionByReference(reference: string): Promise<SessionRow | null> {
    const [rows] = await pool.execute<SessionRow[]>(
      `SELECT id, reference, status, fiat_amount, fiat_currency, receiver_id, api_key_id,
              settlement_token, settlement_token_expires_at
       FROM payment_sessions WHERE reference = ?`,
      [reference]
    );
    return rows[0] || null;
  }

  private async getSessionBySettlementReference(settlementRef: string): Promise<SessionRow | null> {
    const [rows] = await pool.execute<SessionRow[]>(
      `SELECT id, reference, status, fiat_amount, fiat_currency, receiver_id, api_key_id
       FROM payment_sessions WHERE settlement_reference = ?`,
      [settlementRef]
    );
    return rows[0] || null;
  }

  private async getReceiver(receiverId: number | null | undefined): Promise<ReceiverData | null> {
    if (!receiverId) return null;

    const [rows] = await pool.execute<ReceiverRow[]>(
      `SELECT id, bank_code, account_number, account_name, bank_name, paystack_recipient_code
       FROM receivers WHERE id = ?`,
      [receiverId]
    );

    const row = rows[0];
    if (!row) return null;

    return {
      accountNumber: row.account_number,
      bankCode: row.bank_code,
      accountName: row.account_name,
      bankName: row.bank_name,
      paystackRecipientCode: row.paystack_recipient_code ?? undefined,
    };
  }

  private async updateSessionStatus(sessionId: string, status: string): Promise<void> {
    await pool.execute(
      `UPDATE payment_sessions SET status = ?, updated_at = NOW() WHERE id = ?`,
      [status, sessionId]
    );
  }

  private async updateSessionSettlement(sessionId: string, reference: string, provider: string = 'mongoro'): Promise<void> {
    await pool.execute(
      `UPDATE payment_sessions
       SET settlement_reference = ?, settlement_provider = ?, settlement_started_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [reference, provider, sessionId]
    );
  }

  private async markSessionSettled(sessionId: string): Promise<void> {
    await pool.execute(
      `UPDATE payment_sessions SET status = 'settled', settled_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [sessionId]
    );
  }

  private async createSettlementAttempt(data: CreateSettlementAttemptData): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO settlement_attempts
       (session_id, provider, reference, status, amount, account_number, bank_code, account_name, request_payload, response_payload, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.sessionId,
        data.provider || 'mongoro',
        data.reference || null,
        data.status,
        data.amount,
        data.accountNumber,
        data.bankCode,
        data.accountName,
        data.requestPayload ? JSON.stringify(data.requestPayload) : null,
        data.responsePayload ? JSON.stringify(data.responsePayload) : null,
        data.errorMessage || null,
      ]
    );
    return result.insertId;
  }

  private async updateSettlementAttempt(
    attemptId: number,
    data: Partial<{
      status: string;
      reference: string;
      responsePayload: Record<string, unknown>;
      errorMessage: string;
    }>
  ): Promise<void> {
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (data.status) {
      updates.push('status = ?');
      values.push(data.status);
    }
    if (data.reference) {
      updates.push('reference = ?');
      values.push(data.reference);
    }
    if (data.responsePayload) {
      updates.push('response_payload = ?');
      values.push(JSON.stringify(data.responsePayload));
    }
    if (data.errorMessage !== undefined) {
      updates.push('error_message = ?');
      values.push(data.errorMessage);
    }

    if (updates.length === 0) return;

    values.push(attemptId);
    await pool.execute(
      `UPDATE settlement_attempts SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );
  }

  private async getSettlementAttemptByReference(reference: string): Promise<SettlementAttempt | null> {
    const [rows] = await pool.execute<(SettlementAttempt & RowDataPacket)[]>(
      `SELECT * FROM settlement_attempts WHERE reference = ? ORDER BY created_at DESC LIMIT 1`,
      [reference]
    );
    return rows[0] || null;
  }
}

export const settlementService = new SettlementService();
