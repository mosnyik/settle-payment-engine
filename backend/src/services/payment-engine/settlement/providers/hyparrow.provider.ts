/**
 * Hyparrow Settlement Provider
 *
 * Adapts HyparrowService to the SettlementProvider interface.
 *
 * Never reports failure unless the money is definitely not in flight:
 * SettlementRouter and the Telegram fallback both treat a failure as "safe to
 * pay another way", so an ambiguous outcome (timeout, unexplained 5xx) is
 * reported as an uncertain success and resolved by webhook or a human instead.
 */

import { HyparrowService, hyparrowService } from '../hyparrow.service';
import { HyparrowConfig, SettlementRequest } from '../types';
import config from '../../../../config';
import { SettlementProvider, SettlementTransferResult } from './types';

/**
 * One automatic settlement per session (settlement_reversed is terminal), so
 * the session ID is a stable idempotency key: a retried send can never pay twice.
 */
export function hyparrowClientReference(sessionId: string): string {
  return `2S-${sessionId}`;
}

/** Hyparrow takes amounts in kobo, as an integer string. */
export function toKobo(amount: number): string {
  return Math.round(amount * 100).toString();
}

export class HyparrowSettlementProvider implements SettlementProvider {
  readonly name = 'hyparrow';

  constructor(
    private readonly hyparrow: HyparrowService = hyparrowService,
    private readonly sender: Pick<
      HyparrowConfig,
      'senderPhone' | 'senderEmail' | 'senderLastname' | 'senderOthernames'
    > = config.settlement.hyparrow
  ) {}

  isEnabled(): boolean {
    return this.hyparrow.isConfigured();
  }

  async transfer(request: SettlementRequest): Promise<SettlementTransferResult> {
    if (request.currency !== 'NGN') {
      return { success: false, message: `Hyparrow only pays NGN, got ${request.currency}` };
    }

    // Hyparrow expects the bank's registered name as recipientName
    const resolved = await this.hyparrow.resolveAccount(request.accountNumber, request.bankCode);
    if (!resolved.ok) {
      return { success: false, message: resolved.message };
    }
    if (resolved.accountName.toUpperCase() !== request.accountName.trim().toUpperCase()) {
      console.warn(
        `[Hyparrow] Name mismatch for session ${request.sessionId}: stored "${request.accountName}", bank "${resolved.accountName}"`
      );
    }

    const clientReference = hyparrowClientReference(request.sessionId);
    const outcome = await this.hyparrow.send({
      amount: toKobo(request.amount),
      recipientAccount: request.accountNumber,
      recipientBankCode: request.bankCode,
      recipientName: resolved.accountName,
      senderPhone: this.sender.senderPhone,
      senderEmail: this.sender.senderEmail,
      senderLastname: this.sender.senderLastname,
      senderOthernames: this.sender.senderOthernames,
      narration: request.narration,
      clientReference,
    });

    if (outcome.kind === 'accepted') {
      return {
        success: true,
        reference: clientReference,
        message: `Transfer ${outcome.status}`,
        raw: outcome.raw,
      };
    }

    if (outcome.kind === 'rejected') {
      return { success: false, message: outcome.message, raw: outcome.raw };
    }

    // Response lost — ask Hyparrow by the reference we generated before sending
    const status = await this.hyparrow.getStatus(clientReference);

    if (status.kind === 'found') {
      if (status.settlementStatus === 'reversed') {
        return { success: false, message: 'Transfer was reversed', raw: status.raw };
      }
      return {
        success: true,
        reference: clientReference,
        message: `Transfer ${status.settlementStatus} (recovered after: ${outcome.message})`,
        raw: status.raw,
      };
    }

    // Still can't tell. Hold the session in settling rather than risk a second payout.
    return {
      success: true,
      uncertain: true,
      reference: clientReference,
      message: `Outcome unknown: ${outcome.message}`,
    };
  }
}

export const hyparrowSettlementProvider = new HyparrowSettlementProvider();
