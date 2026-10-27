/**
 * Settlement Service
 *
 * Orchestrates fiat payout after crypto deposit confirmation.
 * Dispatches to a SettlementProvider via SettlementRouter (balance-aware
 * provider selection), with Telegram fallback when no provider can cover it.
 */

import crypto from 'crypto';
import config from '../../../config';
import { pool } from '../../../lib/mysql';
import { TelegramService, telegramService, SessionAlertData } from './telegram.service';
import { SettlementRouter, settlementRouter, SettlementDispatchResult } from './settlement-router';
import { ProviderBalanceRepository, providerBalanceRepository } from './provider-balance.repository';
import { sendPaymentWebhook } from '../payment-webhook.service';
import {
  SettlementConfig,
  SettlementAttempt,
  CreateSettlementAttemptData,
  SettlementProviderUpdate,
  MongoroWebhookPayload,
  HyparrowTransferWebhook,
} from './types';
import { getApiKeyById } from '../../../security/services/apiKey.service';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

interface ReceiverRow extends RowDataPacket {
  id: number;
  bank_code: string;
  account_number: string;
  account_name: string;
  bank_name?: string;
}

/** Bank transfer narrations are commonly capped at 100 characters (NIP). */
const MAX_NARRATION_LENGTH = 100;

/** "2Settle <ref>" plus the payment description, trimmed to fit the bank's narration limit. */
function buildNarration(reference: string, description: string | null): string {
  const base = `2Settle ${reference}`;
  const note = description?.replace(/\s+/g, ' ').trim();
  if (!note) return base;
  return `${base} ${note}`.slice(0, MAX_NARRATION_LENGTH).trim();
}

interface ReceiverData {
  accountNumber: string;
  bankCode: string;
  accountName: string;
  bankName?: string;
}

interface SessionRow extends RowDataPacket {
  id: string;
  reference: string;
  status: string;
  fiat_amount: number;
  settled_fiat_amount: number | null;
  fiat_currency: string;
  receiver_id: number | null;
  api_key_id: number | null;
  is_sandbox: boolean;
  description: string | null;
  settlement_token: string | null;
  settlement_token_expires_at: Date | null;
}

export class SettlementService {
  private readonly config: SettlementConfig;
  private readonly router: SettlementRouter;
  private readonly telegram: TelegramService;
  private readonly balances: ProviderBalanceRepository;

  constructor(
    settlementConfig: SettlementConfig = config.settlement,
    router: SettlementRouter = settlementRouter,
    telegramSvc: TelegramService = telegramService,
    balances: ProviderBalanceRepository = providerBalanceRepository
  ) {
    this.config = settlementConfig;
    this.router = router;
    this.telegram = telegramSvc;
    this.balances = balances;
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

    // Sandbox short-circuit — skip all real I/O and auto-complete the settlement
    if (Boolean(session.is_sandbox)) {
      console.log(`[Settlement] Sandbox session ${session.reference} — auto-completing settlement`);
      await this.updateSessionStatus(sessionId, 'settling');
      await this.markSessionSettled(sessionId);
      sendPaymentWebhook(sessionId, 'payment.settling').catch(() => {});
      sendPaymentWebhook(sessionId, 'payment.settled').catch(() => {});
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
    const payoutFiatAmount = this.getPayoutFiatAmount(session);

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
        amount: payoutFiatAmount,
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

    const narration = buildNarration(session.reference, session.description);

    // 5. Route to whichever enabled provider has enough balance to cover this
    // payout, preferring the one with the highest balance. Falls through to
    // the next-best provider if the transfer itself fails.
    let dispatch: SettlementDispatchResult;
    try {
      dispatch = await this.router.dispatch({
        sessionId,
        amount: payoutFiatAmount,
        currency: session.fiat_currency,
        accountNumber: receiver.accountNumber,
        bankCode: receiver.bankCode,
        accountName: receiver.accountName,
        bankName: receiver.bankName,
        narration,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No settlement provider available';

      await this.createSettlementAttempt({
        sessionId,
        provider: 'none',
        status: 'failed',
        amount: payoutFiatAmount,
        accountNumber: receiver.accountNumber,
        bankCode: receiver.bankCode,
        accountName: receiver.accountName,
        errorMessage: message,
      });

      await this.handleSettlementFailure(session, receiver, message);
      return;
    }

    const { provider, result } = dispatch;

    await this.createSettlementAttempt({
      sessionId,
      provider,
      status: result.success ? 'pending' : 'failed', // pending: still awaiting webhook confirmation
      amount: payoutFiatAmount,
      accountNumber: receiver.accountNumber,
      bankCode: receiver.bankCode,
      accountName: receiver.accountName,
      reference: result.reference,
      responsePayload: result.raw,
      errorMessage: result.success ? undefined : result.message,
    });

    if (result.success && result.reference) {
      await this.updateSessionSettlement(sessionId, result.reference, provider);
      console.log(`[Settlement] Initiated for ${session.reference} via ${provider}, ref: ${result.reference}`);

      if (result.uncertain) {
        // The transfer may already be on its way — a manual payout now could pay twice
        await this.telegram.sendSettlementReviewAlert(
          { reference: session.reference, fiatAmount: payoutFiatAmount, fiatCurrency: session.fiat_currency },
          result.reference,
          `${provider}: ${result.message}`
        );
      }
    } else {
      await this.handleSettlementFailure(session, receiver, result.message);
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
      fiatAmount: this.getPayoutFiatAmount(session),
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
      // Both the provider AND Telegram failed - mark as failed
      console.error(`[Settlement] Settlement and Telegram alert both failed for ${session.reference}, marking as failed`);
      await this.updateSessionStatus(session.id, 'failed');
      sendPaymentWebhook(session.id, 'payment.failed').catch(() => {});
    }
  }

  /**
   * Handle Hyparrow transfer webhook (transfer.settled / transfer.failed / transfer.reversed)
   */
  async handleHyparrowWebhook(payload: HyparrowTransferWebhook): Promise<void> {
    const { event, data } = payload;
    const reference = data?.clientReference;
    if (!reference) {
      console.warn(`[Settlement] Hyparrow ${event} without clientReference, ignoring`);
      return;
    }

    const responseCode = data.provider?.transactionResponseCode;
    const raw = payload as unknown as Record<string, unknown>;

    switch (event) {
      case 'transfer.settled':
        return this.handleProviderUpdate({
          reference,
          status: 'success',
          fee: typeof data.fee === 'number' ? data.fee / 100 : undefined,
          payload: raw,
        });
      case 'transfer.failed':
        return this.handleProviderUpdate({
          reference,
          status: 'failed',
          message: `${data.provider?.responseMessage || 'Declined'}${responseCode ? ` (code ${responseCode})` : ''}`,
          payload: raw,
        });
      case 'transfer.reversed': {
        const principal = typeof data.principalReturned === 'number' ? data.principalReturned : data.amount;
        return this.handleProviderUpdate({
          reference,
          status: 'reversed',
          message: `Reversed: ${data.reason || 'unknown reason'}`,
          refunded: typeof principal === 'number' ? principal / 100 : undefined,
          payload: raw,
        });
      }
      default:
        // Other account events (wallet.funded, test.webhook, ...) don't affect settlement
        console.log(`[Settlement] Ignoring Hyparrow event ${event}`);
    }
  }

  /**
   * Handle Mongoro webhook callback.
   * Mongoro is no longer used for new payouts; this only resolves transfers in flight at cutover.
   */
  async handleWebhook(payload: MongoroWebhookPayload): Promise<void> {
    if (payload.status === 'pending') return;

    await this.handleProviderUpdate({
      reference: payload.reference,
      // Mongoro's "failed" was always treated as final
      status: payload.status === 'success' ? 'success' : 'reversed',
      message: payload.message || `Transfer ${payload.status}`,
      fee: payload.fee,
      payload: payload as unknown as Record<string, unknown>,
    });
  }

  /**
   * Apply a provider's settlement outcome to the session
   */
  async handleProviderUpdate(update: SettlementProviderUpdate): Promise<void> {
    const { reference, status, message } = update;

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

    const sessionData: SessionAlertData = {
      reference: session.reference,
      fiatAmount: this.getPayoutFiatAmount(session),
      fiatCurrency: session.fiat_currency,
    };

    const attempt = await this.getSettlementAttemptByReference(reference);

    if (status === 'failed') {
      // Declined, but the money has not come back yet and the decline can still
      // resolve to a credit — the session stays settling until settled/reversed.
      if (attempt?.status === 'failed') return; // duplicate delivery

      if (attempt) {
        await this.updateSettlementAttempt(attempt.id, {
          status: 'failed',
          responsePayload: update.payload,
          errorMessage: message,
        });
      }
      await this.telegram.sendSettlementReviewAlert(
        sessionData,
        reference,
        `${message || 'Transfer failed'}. Awaiting reversal from the provider.`
      );
      console.warn(`[Settlement] Transfer failed for ${session.reference}, awaiting reversal: ${message}`);
      return;
    }

    if (attempt) {
      await this.updateSettlementAttempt(attempt.id, {
        status,
        responsePayload: update.payload,
        errorMessage: status !== 'success' ? message : undefined,
      });
    }

    // Handle based on status
    if (status === 'success') {
      // Mark session as settled
      await this.markSessionSettled(session.id, update.fee);
      sendPaymentWebhook(session.id, 'payment.settled').catch(() => {});
      console.log(`[Settlement] Completed for ${session.reference}`);
    } else {
      // The money is back in the provider wallet — make it spendable again
      if (attempt && update.refunded) {
        await this.balances.credit(attempt.provider, session.fiat_currency, update.refunded);
      }

      // Mark as reversed and send alert
      await this.updateSessionStatus(session.id, 'settlement_reversed');
      sendPaymentWebhook(session.id, 'payment.settlement_reversed').catch(() => {});

      await this.telegram.sendSettlementReversalAlert(
        sessionData,
        reference,
        message || `Transfer ${status}`
      );

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
      amount: this.getPayoutFiatAmount(session),
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

  private async getSettlementMode(apiKeyId: number | null | undefined): Promise<'mongoro' | 'self'> {
    if (!apiKeyId) return 'mongoro';
    try {
      const apiKey = await getApiKeyById(apiKeyId);
      return apiKey?.settlementMode ?? 'mongoro';
    } catch {
      return 'mongoro';
    }
  }

  private getPayoutFiatAmount(session: SessionRow): number {
    return Number(session.settled_fiat_amount ?? session.fiat_amount);
  }

  private async getSession(sessionId: string): Promise<SessionRow | null> {
    const [rows] = await pool.execute<SessionRow[]>(
      `SELECT id, reference, status, fiat_amount, settled_fiat_amount, fiat_currency, receiver_id, api_key_id, is_sandbox, description
       FROM payment_sessions WHERE id = ?`,
      [sessionId]
    );
    return rows[0] || null;
  }

  private async getSessionByReference(reference: string): Promise<SessionRow | null> {
    const [rows] = await pool.execute<SessionRow[]>(
      `SELECT id, reference, status, fiat_amount, settled_fiat_amount, fiat_currency, receiver_id, api_key_id,
              settlement_token, settlement_token_expires_at
       FROM payment_sessions WHERE reference = ?`,
      [reference]
    );
    return rows[0] || null;
  }

  private async getSessionBySettlementReference(settlementRef: string): Promise<SessionRow | null> {
    const [rows] = await pool.execute<SessionRow[]>(
      `SELECT id, reference, status, fiat_amount, settled_fiat_amount, fiat_currency, receiver_id, api_key_id
       FROM payment_sessions WHERE settlement_reference = ?`,
      [settlementRef]
    );
    return rows[0] || null;
  }

  private async getReceiver(receiverId: number | null | undefined): Promise<ReceiverData | null> {
    if (!receiverId) return null;

    const [rows] = await pool.execute<ReceiverRow[]>(
      `SELECT id, bank_code, bank_account AS account_number, account_name, bank_name
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

  private async markSessionSettled(sessionId: string, settlementFee?: number): Promise<void> {
    await pool.execute(
      `UPDATE payment_sessions
       SET status = 'settled', settled_at = NOW(), settlement_fee = ?, updated_at = NOW()
       WHERE id = ?`,
      [settlementFee ?? null, sessionId]
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
