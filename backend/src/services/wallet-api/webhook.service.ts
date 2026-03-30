/**
 * Webhook Service
 * Handles webhook delivery for wallet-as-a-service events
 */

import pool from '../../lib/mysql';
import { hmacSha256 } from '../../security/utils/crypto';
import { getWebhookConfig } from '../../security/services/apiKey.service';
import { incrementUsage } from './usage.service';
import { WatchedWallet, WebhookPayload, WebhookEventType } from './types';
import { ResultSetHeader, RowDataPacket } from 'mysql2';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000; // 1 second
const MAX_DELAY_MS = 300000; // 5 minutes
const WEBHOOK_TIMEOUT_MS = 30000; // 30 seconds

// =============================================================================
// TYPES
// =============================================================================

interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  responseTimeMs?: number;
}

interface PendingWebhook {
  walletId: string;
  apiKeyId: number;
  eventType: WebhookEventType;
  retryCount: number;
}

// =============================================================================
// WEBHOOK PAYLOAD GENERATION
// =============================================================================

/**
 * Build webhook payload from wallet data
 */
export function buildWebhookPayload(
  wallet: WatchedWallet,
  event: WebhookEventType
): WebhookPayload {
  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    wallet: {
      id: wallet.id,
      address: wallet.address,
      network: wallet.network,
      crypto: wallet.crypto,
    },
  };

  // Add deposit info if available
  if (wallet.txHash && wallet.amount !== undefined) {
    payload.deposit = {
      txHash: wallet.txHash,
      amount: wallet.amount.toString(),
      confirmations: wallet.confirmations,
    };
  }

  // Add sweep info if available
  if (wallet.sweepTxHash) {
    payload.sweep = {
      txHash: wallet.sweepTxHash,
    };
  }

  // Add metadata if provided
  if (wallet.metadata) {
    payload.metadata = wallet.metadata;
  }

  return payload;
}

/**
 * Sign a webhook payload with HMAC-SHA256
 */
export function signWebhookPayload(payload: WebhookPayload, secret: string): string {
  const payloadString = JSON.stringify(payload);
  return hmacSha256(secret, payloadString);
}

// =============================================================================
// WEBHOOK DELIVERY
// =============================================================================

/**
 * Deliver a webhook to the configured URL
 */
async function deliverWebhook(
  url: string,
  payload: WebhookPayload,
  signature: string
): Promise<WebhookDeliveryResult> {
  const startTime = Date.now();
  const payloadString = JSON.stringify(payload);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    const response = await fetch(url, {
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

    const responseTimeMs = Date.now() - startTime;

    // Consider 2xx status codes as success
    const success = response.status >= 200 && response.status < 300;

    return {
      success,
      statusCode: response.status,
      responseTimeMs,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      error: errorMessage,
      responseTimeMs,
    };
  }
}

/**
 * Log a webhook delivery attempt
 */
async function logDeliveryAttempt(
  walletId: string,
  apiKeyId: number,
  eventType: WebhookEventType,
  webhookUrl: string,
  payload: WebhookPayload,
  result: WebhookDeliveryResult
): Promise<void> {
  try {
    await pool.query<ResultSetHeader>(
      `INSERT INTO webhook_delivery_log (
        wallet_id, api_key_id, event_type, payload, webhook_url,
        http_status, error_message, response_time_ms, success
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        walletId,
        apiKeyId,
        eventType,
        JSON.stringify(payload),
        webhookUrl,
        result.statusCode || null,
        result.error || null,
        result.responseTimeMs || null,
        result.success,
      ]
    );
  } catch (error) {
    console.error('[WebhookService] Failed to log delivery attempt:', error);
  }
}

/**
 * Update wallet webhook status after delivery attempt
 */
async function updateWalletWebhookStatus(
  walletId: string,
  eventType: WebhookEventType,
  success: boolean,
  error?: string,
  retryCount?: number
): Promise<void> {
  const updates: string[] = [];
  const values: unknown[] = [];

  if (eventType === 'deposit.detected') {
    updates.push('webhook_deposit_sent = ?');
    values.push(success);
  } else if (eventType === 'deposit.confirmed' || eventType === 'sweep.completed') {
    updates.push('webhook_confirmed_sent = ?');
    values.push(success);
  }

  if (error) {
    updates.push('webhook_last_error = ?');
    values.push(error.substring(0, 500)); // Truncate to fit column
  }

  if (retryCount !== undefined) {
    updates.push('webhook_retry_count = ?');
    values.push(retryCount);
  }

  if (updates.length === 0) return;

  values.push(walletId);

  await pool.query(
    `UPDATE watched_wallets SET ${updates.join(', ')} WHERE id = ?`,
    values
  );
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Send a webhook for a wallet event
 * Returns true if delivery was successful, false otherwise
 */
export async function sendWebhook(
  wallet: WatchedWallet,
  event: WebhookEventType
): Promise<boolean> {
  // Get webhook configuration
  const config = await getWebhookConfig(wallet.apiKeyId);
  if (!config) {
    console.log(`[WebhookService] No webhook configured for API key ${wallet.apiKeyId}`);
    return false;
  }

  // Build and sign payload
  const payload = buildWebhookPayload(wallet, event);
  const signature = signWebhookPayload(payload, config.webhookSecret);

  // Deliver webhook
  const result = await deliverWebhook(config.webhookUrl, payload, signature);

  // Log attempt
  await logDeliveryAttempt(
    wallet.id,
    wallet.apiKeyId,
    event,
    config.webhookUrl,
    payload,
    result
  );

  // Update wallet status
  await updateWalletWebhookStatus(
    wallet.id,
    event,
    result.success,
    result.error,
    result.success ? 0 : 1
  );

  // Track usage
  if (result.success) {
    await incrementUsage(wallet.apiKeyId, 'webhooks_sent');
    console.log(`[WebhookService] Webhook delivered: ${event} for wallet ${wallet.id}`);
  } else {
    await incrementUsage(wallet.apiKeyId, 'webhooks_failed');
    console.warn(
      `[WebhookService] Webhook failed: ${event} for wallet ${wallet.id}:`,
      result.error || `HTTP ${result.statusCode}`
    );
  }

  return result.success;
}

/**
 * Retry failed webhooks
 * Call this periodically to retry failed webhook deliveries
 */
export async function retryFailedWebhooks(): Promise<number> {
  // Get wallets needing webhook retry
  const [rows] = await pool.query<(RowDataPacket & PendingWebhook)[]>(
    `SELECT
      id as walletId,
      api_key_id as apiKeyId,
      CASE
        WHEN status = 'deposit_detected' AND webhook_deposit_sent = FALSE THEN 'deposit.detected'
        WHEN status IN ('confirmed', 'swept') AND webhook_confirmed_sent = FALSE THEN 'deposit.confirmed'
      END as eventType,
      webhook_retry_count as retryCount
    FROM watched_wallets
    WHERE (
      (status = 'deposit_detected' AND webhook_deposit_sent = FALSE)
      OR (status IN ('confirmed', 'swept') AND webhook_confirmed_sent = FALSE)
    )
    AND webhook_retry_count < ?
    ORDER BY created_at ASC
    LIMIT 50`,
    [MAX_RETRIES]
  );

  let successCount = 0;

  for (const row of rows) {
    // Calculate delay based on retry count (exponential backoff)
    const delay = Math.min(
      BASE_DELAY_MS * Math.pow(2, row.retryCount),
      MAX_DELAY_MS
    );

    // Wait before retrying
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Get full wallet data
    const [walletRows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM watched_wallets WHERE id = ?',
      [row.walletId]
    );

    if (walletRows.length === 0) continue;

    const wallet = walletRowToWatchedWallet(walletRows[0]);

    // Get webhook config
    const config = await getWebhookConfig(wallet.apiKeyId);
    if (!config) continue;

    // Build and sign payload
    const payload = buildWebhookPayload(wallet, row.eventType);
    const signature = signWebhookPayload(payload, config.webhookSecret);

    // Deliver webhook
    const result = await deliverWebhook(config.webhookUrl, payload, signature);

    // Log attempt
    await logDeliveryAttempt(
      wallet.id,
      wallet.apiKeyId,
      row.eventType,
      config.webhookUrl,
      payload,
      result
    );

    // Update wallet status
    await updateWalletWebhookStatus(
      wallet.id,
      row.eventType,
      result.success,
      result.error,
      row.retryCount + 1
    );

    // Track usage
    if (result.success) {
      await incrementUsage(wallet.apiKeyId, 'webhooks_sent');
      successCount++;
      console.log(`[WebhookService] Retry successful: ${row.eventType} for wallet ${wallet.id}`);
    } else {
      await incrementUsage(wallet.apiKeyId, 'webhooks_failed');
      console.warn(
        `[WebhookService] Retry failed (${row.retryCount + 1}/${MAX_RETRIES}): ${row.eventType} for wallet ${wallet.id}`
      );
    }
  }

  return successCount;
}

/**
 * Helper to convert database row to WatchedWallet
 */
function walletRowToWatchedWallet(row: RowDataPacket): WatchedWallet {
  let metadata: Record<string, unknown> | undefined;
  if (row.metadata) {
    metadata = typeof row.metadata === 'string'
      ? JSON.parse(row.metadata)
      : row.metadata;
  }

  return {
    id: row.id,
    apiKeyId: row.api_key_id,
    address: row.address,
    network: row.network,
    crypto: row.crypto,
    derivationIndex: row.derivation_index,
    hdChain: row.hd_chain,
    status: row.status,
    txHash: row.tx_hash || undefined,
    amount: row.amount ? Number(row.amount) : undefined,
    confirmations: row.confirmations,
    detectedAt: row.detected_at || undefined,
    confirmedAt: row.confirmed_at || undefined,
    sweepTxHash: row.sweep_tx_hash || undefined,
    sweptAt: row.swept_at || undefined,
    webhookDepositSent: row.webhook_deposit_sent,
    webhookConfirmedSent: row.webhook_confirmed_sent,
    webhookLastError: row.webhook_last_error || undefined,
    webhookRetryCount: row.webhook_retry_count,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at || undefined,
  };
}

// =============================================================================
// WEBHOOK RETRY SCHEDULER
// =============================================================================

let retryInterval: NodeJS.Timeout | null = null;

/**
 * Start the webhook retry scheduler
 */
export function startWebhookRetryScheduler(intervalMs: number = 60000): void {
  if (retryInterval) {
    console.warn('[WebhookService] Retry scheduler already running');
    return;
  }

  retryInterval = setInterval(async () => {
    try {
      const count = await retryFailedWebhooks();
      if (count > 0) {
        console.log(`[WebhookService] Retried ${count} webhooks successfully`);
      }
    } catch (error) {
      console.error('[WebhookService] Error in retry scheduler:', error);
    }
  }, intervalMs);

  console.log('[WebhookService] Retry scheduler started');
}

/**
 * Stop the webhook retry scheduler
 */
export function stopWebhookRetryScheduler(): void {
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
    console.log('[WebhookService] Retry scheduler stopped');
  }
}
