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

interface ReceiverAlertData {
  accountNumber: string;
  bankCode: string;
  accountName: string;
  bankName?: string;
}

interface TelegramInlineKeyboardMarkup {
  inline_keyboard: Array<Array<{
    text: string;
    callback_data: string;
  }>>;
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
  async sendMessage(message: string, replyMarkup?: TelegramInlineKeyboardMarkup): Promise<boolean> {
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
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
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
   * Acknowledge a Telegram button press.
   */
  async answerCallbackQuery(callbackQueryId: string, text: string, showAlert = false): Promise<boolean> {
    if (!this.isEnabled()) {
      console.warn('[Telegram] Alerts disabled or not configured');
      return false;
    }

    try {
      const url = `${this.baseUrl}${this.config.botToken}/answerCallbackQuery`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text,
          show_alert: showAlert,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Telegram] Failed to answer callback query:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[Telegram] Error answering callback query:', error);
      return false;
    }
  }

  /**
   * Remove or replace buttons on an existing Telegram message.
   */
  async editMessageReplyMarkup(
    chatId: string | number,
    messageId: number,
    replyMarkup?: TelegramInlineKeyboardMarkup
  ): Promise<boolean> {
    if (!this.isEnabled()) {
      console.warn('[Telegram] Alerts disabled or not configured');
      return false;
    }

    try {
      const url = `${this.baseUrl}${this.config.botToken}/editMessageReplyMarkup`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: replyMarkup || { inline_keyboard: [] },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Telegram] Failed to edit message reply markup:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[Telegram] Error editing message reply markup:', error);
      return false;
    }
  }

  /**
   * Send alert for settlement API failure
   */
  async sendSettlementFailureAlert(
    session: SessionAlertData,
    receiver: ReceiverAlertData,
    error: string
  ): Promise<boolean> {
    const message = this.formatSettlementFailure(session, receiver, error);
    return this.sendMessage(message, this.manualSettlementKeyboard(session.reference));
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
    receiver: ReceiverAlertData,
    error: string
  ): string {
    const bankDisplay = this.escapeHtml(receiver.bankName || receiver.bankCode);
    const amount = session.fiatAmount.toLocaleString();
    const fiatCurrency = this.escapeHtml(session.fiatCurrency);
    const reference = this.escapeHtml(session.reference);
    const accountNumber = this.escapeHtml(receiver.accountNumber);
    const accountName = this.escapeHtml(receiver.accountName);

    return `
<b>Manual Settlement Required</b>

<b>Session:</b> ${reference}
<b>Amount:</b> ${fiatCurrency} ${amount}
<b>Account:</b> ${accountNumber}
<b>Bank:</b> ${bankDisplay}
<b>Name:</b> ${accountName}

<b>Error:</b> ${this.escapeHtml(error)}

After manual payment, use the buttons below.
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
    const sessionReference = this.escapeHtml(session.reference);
    const fiatCurrency = this.escapeHtml(session.fiatCurrency);
    const escapedReference = this.escapeHtml(reference);

    return `
<b>Settlement Reversed</b>

<b>Session:</b> ${sessionReference}
<b>Amount:</b> ${fiatCurrency} ${amount}
<b>Reference:</b> ${escapedReference}

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

  private manualSettlementKeyboard(reference: string): TelegramInlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'Settlement completed', callback_data: `settle:${reference}` },
        ],
      ],
    };
  }
}

export const telegramService = new TelegramService();
