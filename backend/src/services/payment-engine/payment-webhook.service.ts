/**
 * Payment Webhook Service
 *
 * Fires webhooks to API key holders when a payment session status changes.
 * Reuses the webhook signing approach from the WaaS webhook service.
 */

import pool from '../../lib/mysql';
import { hmacSha256 } from '../../security/utils/crypto';
import { RowDataPacket } from 'mysql2';

// =============================================================================
// TYPES
// =============================================================================

export type PaymentWebhookEvent =
  | 'payment.confirming'
  | 'payment.confirmed'
  | 'payment.settling'
  | 'payment.settled'
  | 'payment.failed'
  | 'payment.expired'
  | 'payment.settlement_reversed';

interface SessionWebhookRow extends RowDataPacket {
  id: string;
  reference: string;
  type: string;
  status: string;
  fiat_amount: number;
  fiat_currency: string;
  crypto_amount: number | null;
  crypto: string | null;
  network: string | null;
  tx_hash: string | null;
  received_amount: number | null;
  settled_fiat_amount: number | null;
  metadata: string | Record<string, unknown> | null;
  webhook_url: string | null;
  webhook_secret: string | null;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Send a webhook for a payment session event.
 * Silently no-ops if the API key has no webhook configured.
 * Pass extraData to include additional fields in the payload (e.g. settlementToken).
 */
export async function sendPaymentWebhook(
  sessionId: string,
  event: PaymentWebhookEvent,
  extraData?: Record<string, unknown>
): Promise<void> {
  try {
    const [rows] = await pool.query<SessionWebhookRow[]>(
      `SELECT ps.id, ps.reference, ps.type, ps.status,
              ps.fiat_amount, ps.fiat_currency, ps.crypto_amount, ps.crypto,
              ps.network, ps.tx_hash, ps.received_amount, ps.settled_fiat_amount, ps.metadata,
              ak.webhook_url, ak.webhook_secret
       FROM payment_sessions ps
       LEFT JOIN api_keys ak ON ak.id = ps.api_key_id
       WHERE ps.id = ?`,
      [sessionId]
    );

    const row = rows[0];
    if (!row || !row.webhook_url || !row.webhook_secret) return;

    const metadata = row.metadata
      ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata)
      : null;

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      payment: {
        id: row.id,
        reference: row.reference,
        type: row.type,
        status: row.status,
        fiatAmount: Number(row.fiat_amount),
        fiatCurrency: row.fiat_currency,
        cryptoAmount: row.crypto_amount != null ? Number(row.crypto_amount) : null,
        crypto: row.crypto,
        network: row.network,
        txHash: row.tx_hash,
        receivedAmount: row.received_amount != null ? Number(row.received_amount) : null,
        settledFiatAmount: row.settled_fiat_amount != null ? Number(row.settled_fiat_amount) : null,
        metadata,
      },
      ...(extraData ?? {}),
    };

    const payloadString = JSON.stringify(payload);
    const signature = hmacSha256(row.webhook_secret, payloadString);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    await fetch(row.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Timestamp': payload.timestamp,
        'User-Agent': '2Settle-Webhook/1.0',
      },
      body: payloadString,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log(`[PaymentWebhook] Delivered ${event} for session ${sessionId.slice(0, 8)}...`);
  } catch (error) {
    console.error(
      `[PaymentWebhook] Failed to deliver ${event} for session ${sessionId.slice(0, 8)}...:`,
      error instanceof Error ? error.message : error
    );
  }
}
