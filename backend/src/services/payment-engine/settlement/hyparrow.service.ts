/**
 * Hyparrow Money Transfer Service
 *
 * HTTP client for Hyparrow's NGN bank transfer API
 * (https://docs.hyparrow.com/money-transfer.md).
 *
 * Every send carries a clientReference, which Hyparrow treats as a permanent
 * idempotency key: resending the same reference never pays twice. That is what
 * lets us recover from a lost response — look the transfer up by the reference
 * we generated before the call instead of guessing whether it went through.
 */

import crypto from 'crypto';
import config from '../../../config';
import { HyparrowConfig, HyparrowSendRequest } from './types';

export type HyparrowSendOutcome =
  /** Hyparrow accepted the transfer (200, or 202 when the bank network did not answer). */
  | { kind: 'accepted'; transferCode?: string; status: string; fee?: number; raw: Record<string, unknown> }
  /** Definitely not sent, or sent and already reversed — safe to treat as failed. */
  | { kind: 'rejected'; message: string; raw?: Record<string, unknown> }
  /** Timeout, dropped connection or unexplained 5xx — the transfer may or may not exist. */
  | { kind: 'unknown'; message: string };

export type HyparrowStatusOutcome =
  | { kind: 'found'; settlementStatus: string; raw: Record<string, unknown> }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string };

export type HyparrowResolveOutcome =
  | { ok: true; accountName: string }
  | { ok: false; message: string };

interface HyparrowResponseBody {
  success?: boolean;
  message?: string;
  error?: string;
  code?: string;
  status?: string;
  data?: Record<string, unknown> & {
    accountName?: string;
    TransferCode?: string;
    Status?: string;
    Fee?: number;
    transaction?: { settlementStatus?: string };
  };
}

export class HyparrowService {
  private readonly config: HyparrowConfig;

  constructor(hyparrowConfig: HyparrowConfig = config.settlement.hyparrow) {
    this.config = hyparrowConfig;
  }

  /**
   * Check if Hyparrow is properly configured (credentials plus the sender
   * details Hyparrow requires on every transfer)
   */
  isConfigured(): boolean {
    const c = this.config;
    return Boolean(
      c.apiKey && c.apiSecret &&
      c.senderPhone && c.senderEmail && c.senderLastname && c.senderOthernames
    );
  }

  /**
   * Resolve the registered account name for an account number + CBN bank code
   */
  async resolveAccount(accountNumber: string, bankCode: string): Promise<HyparrowResolveOutcome> {
    try {
      const { status, body } = await this.request('POST', '/money-transfer/account-inquiry', {
        accountNumber,
        bankCode,
      });

      const accountName = body.data?.accountName;
      if (status >= 200 && status < 300 && body.success !== false && accountName) {
        return { ok: true, accountName };
      }

      return { ok: false, message: body.error || body.message || `Account inquiry failed (HTTP ${status})` };
    } catch (error) {
      return { ok: false, message: `Account inquiry error: ${errorMessage(error)}` };
    }
  }

  /**
   * Initiate a bank transfer
   */
  async send(request: HyparrowSendRequest): Promise<HyparrowSendOutcome> {
    let status: number;
    let body: HyparrowResponseBody;

    try {
      ({ status, body } = await this.request('POST', '/money-transfer/send', request));
    } catch (error) {
      console.error(`[Hyparrow] Send ${request.clientReference} got no response:`, error);
      return { kind: 'unknown', message: `No response from Hyparrow: ${errorMessage(error)}` };
    }

    const raw = body as Record<string, unknown>;

    if (status === 200 || status === 202) {
      const transferStatus = String(body.data?.Status ?? 'pending');

      // An idempotent replay returns the original transfer as it stands —
      // if that attempt was rejected and reversed, nothing is in flight.
      if (transferStatus === 'reversed') {
        return { kind: 'rejected', message: 'Transfer was rejected and reversed', raw };
      }

      return {
        kind: 'accepted',
        transferCode: body.data?.TransferCode,
        status: transferStatus,
        fee: typeof body.data?.Fee === 'number' ? body.data.Fee : undefined,
        raw,
      };
    }

    const message = body.error || body.message || `HTTP ${status}`;

    // 4xx: validation, insufficient balance, reference conflict or a network
    // rejection that Hyparrow already reversed — nothing is in flight.
    // 5xx with status "reversed": the request never left Hyparrow.
    if ((status >= 400 && status < 500) || body.status === 'reversed') {
      return { kind: 'rejected', message, raw };
    }

    return { kind: 'unknown', message: `Hyparrow returned HTTP ${status}: ${message}` };
  }

  /**
   * Get transfer status by transferCode or our clientReference
   */
  async getStatus(reference: string): Promise<HyparrowStatusOutcome> {
    try {
      const { status, body } = await this.request(
        'GET',
        `/money-transfer/status?reference=${encodeURIComponent(reference)}`
      );

      if (status === 404) {
        return { kind: 'not_found' };
      }

      const settlementStatus = body.data?.transaction?.settlementStatus;
      if (status === 200 && settlementStatus) {
        return { kind: 'found', settlementStatus, raw: body as Record<string, unknown> };
      }

      return { kind: 'error', message: body.error || body.message || `HTTP ${status}` };
    } catch (error) {
      return { kind: 'error', message: errorMessage(error) };
    }
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    payload?: unknown
  ): Promise<{ status: number; body: HyparrowResponseBody }> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
        'X-API-Secret': this.config.apiSecret,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    // Gateways in front of Hyparrow can answer with HTML — treat as an empty body
    const body = await response.json().catch(() => ({})) as HyparrowResponseBody;
    return { status: response.status, body };
  }
}

/** Hyparrow re-signs every delivery attempt, so a genuine one is always fresh. */
const WEBHOOK_TOLERANCE_SEC = 300;

/**
 * Verify X-Hyparrow-Signature-256: hex HMAC-SHA256 of `${timestamp}.${rawBody}`,
 * keyed with the webhook secret. Timestamped, so captured deliveries can't be replayed.
 */
export function verifyHyparrowSignature(
  rawBody: Buffer,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: string,
  nowSec: number = Date.now() / 1000
): boolean {
  if (!secret || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > WEBHOOK_TOLERANCE_SEC) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');

  return signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export const hyparrowService = new HyparrowService();
