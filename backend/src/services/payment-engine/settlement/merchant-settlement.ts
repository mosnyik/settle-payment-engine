/**
 * Merchant-collection settlement instructions.
 *
 * When an asset is collected straight into the merchant's own wallet, 2Settle
 * never holds the crypto, so it can't pay the recipient out of its balance.
 * Instead the merchant is told, on WhatsApp, to pay:
 *   1. the recipient   - the session's payout amount, to their bank account
 *   2. 2Settle         - the exchange spread, to the profit account
 * with the deposit tx hash as evidence. An admin marks the session settled
 * once both payments are confirmed (POST /v1/admin/sessions/:reference/settle).
 *
 * WhatsApp only lets a business start a conversation with an approved
 * template, so this sends a Utility template. Create it in WhatsApp Manager ->
 * Message templates, category Utility, named WHATSAPP_SETTLEMENT_TEMPLATE_NAME,
 * with these 12 body parameters in order:
 *
 *   {{1}}  payment reference          2S-ABC123
 *   {{2}}  crypto received            0.00015 BTC
 *   {{3}}  deposit tx hash            3f9a...c21e
 *   {{4}}  explorer link              https://mempool.space/tx/3f9a...
 *   {{5}}  recipient amount           NGN 150,000.00
 *   {{6}}  recipient account name     Jane Smith
 *   {{7}}  recipient bank             GTBank
 *   {{8}}  recipient account number   0987654321
 *   {{9}}  2Settle profit amount      NGN 1,515.15
 *   {{10}} profit account name        2Settle Ltd
 *   {{11}} profit bank                Providus Bank
 *   {{12}} profit account number      1234567890
 */

import axios from 'axios';
import config from '../../../config';
import type { MerchantCollectionSettlementConfig } from './types';

export interface MerchantSettlementAmountsInput {
  /** Fiat the recipient is owed (settled_fiat_amount ?? fiat_amount) */
  payoutFiat: number;
  /** Crypto actually received (falls back to the quoted crypto amount) */
  cryptoReceived: number | null;
  /** USD price of the asset at rate lock */
  assetPrice: number | null;
  /** Rate the user was quoted (after spread) */
  rate: number | null;
  /** Market rate before spread, stored at rate lock */
  marketRate: number | null;
  /** Current USER_RATE_SPREAD - only used for sessions locked before market_rate was stored */
  fallbackSpread: number;
}

export interface MerchantSettlementAmounts {
  recipientAmount: number;
  profitAmount: number;
  /** True when market_rate was missing and had to be re-derived from today's spread */
  profitEstimated: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Recipient gets the payout. 2Settle's profit is what the received crypto is
 * worth at the market rate minus that payout - i.e. the spread. (Fees are
 * currently 0; if they were re-enabled they would land in the profit too.)
 */
export function computeMerchantSettlementAmounts(input: MerchantSettlementAmountsInput): MerchantSettlementAmounts {
  const recipientAmount = round2(input.payoutFiat);
  const rate = input.rate && input.rate > 0 ? input.rate : null;

  let marketRate = input.marketRate && input.marketRate > 0 ? input.marketRate : null;
  let profitEstimated = false;
  if (!marketRate && rate) {
    marketRate = rate / (1 - input.fallbackSpread);
    profitEstimated = true;
  }

  if (!marketRate || !rate) {
    return { recipientAmount, profitAmount: 0, profitEstimated: true };
  }

  let grossAtMarket: number;
  if (input.cryptoReceived && input.cryptoReceived > 0 && input.assetPrice && input.assetPrice > 0) {
    grossAtMarket = input.cryptoReceived * input.assetPrice * marketRate;
  } else {
    // No crypto figures - the spread share of the payout
    grossAtMarket = input.payoutFiat * (marketRate / rate);
    profitEstimated = true;
  }

  return {
    recipientAmount,
    profitAmount: Math.max(0, round2(grossAtMarket - input.payoutFiat)),
    profitEstimated,
  };
}

export interface MerchantSettlementInstruction {
  reference: string;
  fiatCurrency: string;
  crypto: string;
  network: string;
  cryptoReceived: number;
  txHash: string;
  recipient: { accountName: string; bankName: string; accountNumber: string };
  recipientAmount: number;
  profitAmount: number;
  profitAccount: { accountName: string; bankName: string; accountNumber: string };
}

const EXPLORER_TX_URL: Record<string, string> = {
  bitcoin: 'https://mempool.space/tx/',
  ethereum: 'https://etherscan.io/tx/',
  erc20: 'https://etherscan.io/tx/',
  bsc: 'https://bscscan.com/tx/',
  bep20: 'https://bscscan.com/tx/',
  tron: 'https://tronscan.org/#/transaction/',
  trc20: 'https://tronscan.org/#/transaction/',
  polygon: 'https://polygonscan.com/tx/',
  base: 'https://basescan.org/tx/',
};

export function explorerTxUrl(network: string, txHash: string): string {
  const base = EXPLORER_TX_URL[network];
  return base ? `${base}${txHash}` : txHash;
}

export function formatMoney(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Trailing zeros trimmed, never scientific notation. */
function formatCrypto(amount: number): string {
  return amount.toFixed(8).replace(/\.?0+$/, '');
}

/** WhatsApp template parameters can't contain newlines, tabs or 4+ spaces in a row. */
function templateText(value: string): string {
  const cleaned = value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return cleaned || '-';
}

/** The 12 body parameters, in template order (see file header). */
export function buildTemplateParameters(i: MerchantSettlementInstruction): string[] {
  return [
    i.reference,
    `${formatCrypto(i.cryptoReceived)} ${i.crypto}`,
    i.txHash,
    explorerTxUrl(i.network, i.txHash),
    formatMoney(i.fiatCurrency, i.recipientAmount),
    i.recipient.accountName,
    i.recipient.bankName,
    i.recipient.accountNumber,
    formatMoney(i.fiatCurrency, i.profitAmount),
    i.profitAccount.accountName,
    i.profitAccount.bankName,
    i.profitAccount.accountNumber,
  ].map(templateText);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Telegram (HTML) version, sent to ops when the WhatsApp message can't go out. */
export function formatInstructionForTelegram(
  i: MerchantSettlementInstruction,
  merchantPhone: string | null,
  reason: string
): string {
  const e = escapeHtml;
  return `
<b>Merchant Settlement Instruction NOT delivered</b>

<b>Session:</b> ${e(i.reference)}
<b>Merchant WhatsApp:</b> ${e(merchantPhone ?? 'not set')}
<b>Reason:</b> ${e(reason)}

<b>Received:</b> ${e(formatCrypto(i.cryptoReceived))} ${e(i.crypto)} (${e(i.network)})
<b>Tx hash:</b> <code>${e(i.txHash)}</code>
${e(explorerTxUrl(i.network, i.txHash))}

<b>1) Merchant pays recipient:</b> <code>${e(formatMoney(i.fiatCurrency, i.recipientAmount))}</code>
${e(i.recipient.accountName)} · ${e(i.recipient.bankName)} · <code>${e(i.recipient.accountNumber)}</code>

<b>2) Merchant pays 2Settle profit:</b> <code>${e(formatMoney(i.fiatCurrency, i.profitAmount))}</code>
${e(i.profitAccount.accountName)} · ${e(i.profitAccount.bankName)} · <code>${e(i.profitAccount.accountNumber)}</code>

Forward this to the merchant. The crypto is in the merchant's wallet - do NOT pay the recipient from our balance. Mark settled once both payments are confirmed.
  `.trim();
}

interface GraphApiError {
  error?: { message?: string; code?: number; error_data?: { details?: string } };
}

export interface WhatsAppTransport {
  phoneNumberId: string;
  accessToken: string;
  graphVersion: string;
  baseUrl: string;
}

export class MerchantSettlementWhatsApp {
  constructor(
    private readonly settings: MerchantCollectionSettlementConfig = config.settlement.merchantCollection,
    private readonly transport: WhatsAppTransport = config.auth.whatsapp
  ) {}

  /** Why sending is impossible right now, or null if it can be attempted. */
  unavailableReason(): string | null {
    if (!this.settings.whatsapp.enabled) return 'WHATSAPP_SETTLEMENT_ENABLED is not true';
    if (!this.transport.phoneNumberId || !this.transport.accessToken) {
      return 'WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN not configured';
    }
    if (!this.settings.whatsapp.templateName) return 'WHATSAPP_SETTLEMENT_TEMPLATE_NAME not configured';
    const { profitAccount } = this.settings;
    if (!profitAccount.accountNumber || !profitAccount.accountName || !profitAccount.bankName) {
      return 'PROFIT_ACCOUNT_BANK / PROFIT_ACCOUNT_NUMBER / PROFIT_ACCOUNT_NAME not configured';
    }
    return null;
  }

  /** Sends the template. Resolves with Meta's message id; throws on rejection. */
  async send(phone: string, instruction: MerchantSettlementInstruction): Promise<string> {
    const unavailable = this.unavailableReason();
    if (unavailable) throw new Error(unavailable);

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone.replace(/\D/g, ''), // country code, no "+"
      type: 'template',
      template: {
        name: this.settings.whatsapp.templateName,
        language: { code: this.settings.whatsapp.templateLanguage },
        components: [
          {
            type: 'body',
            parameters: buildTemplateParameters(instruction).map((text) => ({ type: 'text', text })),
          },
        ],
      },
    };

    try {
      const { data } = await axios.post<{ messages?: Array<{ id: string }> }>(
        `${this.transport.baseUrl}/${this.transport.graphVersion}/${this.transport.phoneNumberId}/messages`,
        body,
        {
          headers: {
            Authorization: `Bearer ${this.transport.accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );
      const messageId = data?.messages?.[0]?.id;
      if (!messageId) throw new Error('WhatsApp settlement message failed: no message id in response');
      return messageId;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data) {
        const { error } = err.response.data as GraphApiError;
        const detail = error?.error_data?.details || error?.message || '';
        throw new Error(`WhatsApp settlement message failed: ${error?.code ?? err.response.status} ${detail}`.trim());
      }
      throw err;
    }
  }
}

export const merchantSettlementWhatsApp = new MerchantSettlementWhatsApp();
