/**
 * Settlement Service
 *
 * Orchestrates fiat payout after crypto deposit confirmation.
 * Uses Mongoro for bank transfers with Telegram fallback for failures.
 */

import config from '../../../config';
import { pool } from '../../../lib/db';
import { PaymentSession } from '../types';
import { MongoroService, mongoroService } from './mongoro.service';
import { TelegramService, telegramService } from './telegram.service';
import {
  SettlementConfig,
  SettlementAttempt,
  CreateSettlementAttemptData,
  MongoroWebhookPayload,
} from './types';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

interface ReceiverRow extends RowDataPacket {
  id: number;
  bank_code: string;
  account_number: string;
  account_name: string;
  bank_name?: string;
}

interface SessionRow extends RowDataPacket {
  id: string;
  reference: string;
  status: string;
  fiat_amount: number;
  fiat_currency: string;
  receiver_id: number | null;
}

export class SettlementService {
  private readonly config: SettlementConfig;
  private readonly mongoro: MongoroService;
  private readonly telegram: TelegramService;

  constructor(
    settlementConfig: SettlementConfig = config.settlement,
    mongoroSvc: MongoroService = mongoroService,
    telegramSvc: TelegramService = telegramService
  ) {
    this.config = settlementConfig;
    this.mongoro = mongoroSvc;
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
    const receiver = await this.getReceiver(session.receiverId);
    if (!receiver) {
      console.error(`[Settlement] No receiver for session ${sessionId}`);
      await this.handleSettlementFailure(
        session,
        { accountNumber: 'N/A', bankCode: 'N/A', accountName: 'N/A' },
        'No receiver bank details found'
      );
      return;
    }

    // 3. Update status to settling
    await this.updateSessionStatus(sessionId, 'settling');

    // 4. Create settlement attempt record
    const attemptData: CreateSettlementAttemptData = {
      sessionId,
      provider: 'mongoro',
      status: 'pending',
      amount: session.fiatAmount,
      accountNumber: receiver.accountNumber,
      bankCode: receiver.bankCode,
      accountName: receiver.accountName,
    };

    const attemptId = await this.createSettlementAttempt(attemptData);

    // 5. Call Mongoro API
    const narration = `2Settle ${session.reference}`;
    const response = await this.mongoro.transfer(
      receiver.accountNumber,
      receiver.bankCode,
      receiver.bankName || receiver.bankCode,
      receiver.accountName,
      session.fiatAmount,
      narration,
      session.fiatCurrency
    );

    // 6. Handle response
    if (response.success && response.data?.reference) {
      // Success - save reference and wait for webhook
      await this.updateSettlementAttempt(attemptId, {
        status: 'pending', // Still pending until webhook confirms
        reference: response.data.reference,
        responsePayload: response.data as unknown as Record<string, unknown>,
      });

      await this.updateSessionSettlement(sessionId, response.data.reference);

      console.log(`[Settlement] Initiated for ${session.reference}, ref: ${response.data.reference}`);
    } else {
      // Failure - send Telegram alert
      await this.updateSettlementAttempt(attemptId, {
        status: 'failed',
        errorMessage: response.message,
        responsePayload: response as unknown as Record<string, unknown>,
      });

      await this.handleSettlementFailure(session, receiver, response.message);
    }
  }

  /**
   * Handle settlement failure - send Telegram alert or mark as failed
   */
  private async handleSettlementFailure(
    session: PaymentSession | SessionRow,
    receiver: { accountNumber: string; bankCode: string; accountName: string; bankName?: string },
    error: string
  ): Promise<void> {
    console.error(`[Settlement] Failed for ${session.reference}: ${error}`);

    // Convert SessionRow to PaymentSession-like object if needed
    const sessionData: PaymentSession = 'fiat_amount' in session
      ? {
          ...session,
          fiatAmount: session.fiat_amount,
          fiatCurrency: session.fiat_currency as PaymentSession['fiatCurrency'],
          receiverId: session.receiver_id ?? undefined,
        } as PaymentSession
      : session as PaymentSession;

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
      console.log(`[Settlement] Completed for ${session.reference}`);
    } else if (status === 'reversed' || status === 'failed') {
      // Mark as reversed and send alert
      await this.updateSessionStatus(session.id, 'settlement_reversed');

      const sessionData = await this.getSession(session.id);
      if (sessionData) {
        await this.telegram.sendSettlementReversalAlert(
          sessionData as PaymentSession,
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

  private async getSession(sessionId: string): Promise<SessionRow | null> {
    const [rows] = await pool.execute<SessionRow[]>(
      `SELECT id, reference, status, fiat_amount, fiat_currency, receiver_id
       FROM payment_sessions WHERE id = ?`,
      [sessionId]
    );
    return rows[0] || null;
  }

  private async getSessionByReference(reference: string): Promise<SessionRow | null> {
    const [rows] = await pool.execute<SessionRow[]>(
      `SELECT id, reference, status, fiat_amount, fiat_currency, receiver_id
       FROM payment_sessions WHERE reference = ?`,
      [reference]
    );
    return rows[0] || null;
  }

  private async getSessionBySettlementReference(settlementRef: string): Promise<SessionRow | null> {
    const [rows] = await pool.execute<SessionRow[]>(
      `SELECT id, reference, status, fiat_amount, fiat_currency, receiver_id
       FROM payment_sessions WHERE settlement_reference = ?`,
      [settlementRef]
    );
    return rows[0] || null;
  }

  private async getReceiver(receiverId: number | null | undefined): Promise<ReceiverRow | null> {
    if (!receiverId) return null;

    const [rows] = await pool.execute<ReceiverRow[]>(
      `SELECT id, bank_code, account_number, account_name, bank_name
       FROM receivers WHERE id = ?`,
      [receiverId]
    );
    return rows[0] || null;
  }

  private async updateSessionStatus(sessionId: string, status: string): Promise<void> {
    await pool.execute(
      `UPDATE payment_sessions SET status = ?, updated_at = NOW() WHERE id = ?`,
      [status, sessionId]
    );
  }

  private async updateSessionSettlement(sessionId: string, reference: string): Promise<void> {
    await pool.execute(
      `UPDATE payment_sessions
       SET settlement_reference = ?, settlement_provider = 'mongoro', settlement_started_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [reference, sessionId]
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
    const values: unknown[] = [];

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
