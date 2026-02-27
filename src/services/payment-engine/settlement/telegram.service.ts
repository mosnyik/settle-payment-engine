/**
 * Telegram Notification Service
 *
 * Sends alerts to admin group when settlement fails or reverses.
 */

import config from '../../../config';
import { TelegramAlertConfig } from './types';

/** Minimal session data needed for telegram alerts */
export interface SessionAlertData {
  reference: string;
  fiatAmount: number;
  fiatCurrency: string;
}

export class TelegramService {
  private readonly config: TelegramAlertConfig;
  private readonly baseUrl = 'https://api.telegram.org/bot';

  constructor(telegramConfig: TelegramAlertConfig = config.settlement.telegram) {
    this.config = telegramConfig;
  }

  /**
   * Check if Telegram alerts are enabled and configured
   */
  isEnabled(): boolean {
    return (
      this.config.enabled &&
      Boolean(this.config.botToken) &&
      Boolean(this.config.chatId)
    );
  }

  /**
   * Send a message to the configured Telegram chat
   */
  async sendMessage(message: string): Promise<boolean> {
    if (!this.isEnabled()) {
      console.warn('[Telegram] Alerts disabled or not configured');
      return false;
    }

    try {
      const url = `${this.baseUrl}${this.config.botToken}/sendMessage`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text: message,
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Telegram] Failed to send message:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[Telegram] Error sending message:', error);
      return false;
    }
  }

  /**
   * Send alert for settlement API failure
   */
  async sendSettlementFailureAlert(
    session: SessionAlertData,
    receiver: { accountNumber: string; bankCode: string; accountName: string; bankName?: string },
    error: string
  ): Promise<boolean> {
    const message = this.formatSettlementFailure(session, receiver, error);
    return this.sendMessage(message);
  }

  /**
   * Send alert for settlement reversal
   */
  async sendSettlementReversalAlert(
    session: SessionAlertData,
    reference: string,
    reason: string
  ): Promise<boolean> {
    const message = this.formatSettlementReversal(session, reference, reason);
    return this.sendMessage(message);
  }

  /**
   * Format settlement failure message
   */
  formatSettlementFailure(
    session: SessionAlertData,
    receiver: { accountNumber: string; bankCode: string; accountName: string; bankName?: string },
    error: string
  ): string {
    const bankDisplay = receiver.bankName || receiver.bankCode;
    const amount = session.fiatAmount.toLocaleString();

    return `
<b>Manual Settlement Required</b>

<b>Session:</b> ${session.reference}
<b>Amount:</b> ${session.fiatCurrency} ${amount}
<b>Account:</b> ${receiver.accountNumber}
<b>Bank:</b> ${bankDisplay}
<b>Name:</b> ${receiver.accountName}

<b>Error:</b> ${this.escapeHtml(error)}

After manual payment, use:
<code>/settle ${session.reference}</code>
    `.trim();
  }

  /**
   * Format settlement reversal message
   */
  formatSettlementReversal(
    session: SessionAlertData,
    reference: string,
    reason: string
  ): string {
    const amount = session.fiatAmount.toLocaleString();

    return `
<b>Settlement Reversed</b>

<b>Session:</b> ${session.reference}
<b>Amount:</b> ${session.fiatCurrency} ${amount}
<b>Reference:</b> ${reference}

<b>Reason:</b> ${this.escapeHtml(reason)}

<b>Action Required:</b> Investigate and resolve manually.
    `.trim();
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

export const telegramService = new TelegramService();
