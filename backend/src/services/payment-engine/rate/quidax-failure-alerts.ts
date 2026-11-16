/**
 * Quidax failure digest emails.
 *
 * Every failed Quidax call is recorded (time, market, reason, whether the
 * fallback worked). Failures are emailed as one digest, at most once every
 * RATE_ALERT_QUIDAX_DIGEST_MINUTES per process. The first failure after a quiet
 * period is sent right away; later ones wait for the window to close.
 *
 * Recording never throws and never blocks the pricing path.
 */

import os from "os";
import type { AxiosError } from "axios";
import config from "../../../config";
import { createAlertTransport } from "./rate-email-alerts";

export interface QuidaxFailure {
  at: Date;
  market: string;
  source: string; // e.g. "crypto price (API server)", "USDT/NGN rate updater"
  reason: string;
  fallback: string; // e.g. "CoinMarketCap succeeded", "CoinMarketCap failed: ..."
}

const MAX_BUFFERED = 500;

let buffer: QuidaxFailure[] = [];
let dropped = 0;
let lastSentAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let sending: Promise<void> | null = null;

function alertsConfigured(): boolean {
  const a = config.rateAlerts;
  return a.enabled && a.recipients.length > 0 && !!a.from && !!config.auth.email.smtpHost;
}

function windowMs(): number {
  const minutes = config.rateAlerts.quidaxDigestMinutes;
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 5) * 60_000;
}

/** Human-readable reason for a failed Quidax call. */
export function describeQuidaxError(error: unknown): string {
  const axiosError = error as AxiosError | undefined;
  // Check the flag directly (what axios.isAxiosError does) so this works even where axios is mocked.
  if (axiosError?.isAxiosError === true) {
    const { response, code, message } = axiosError;
    if (response) {
      let body = "";
      try {
        body = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
      } catch {
        body = "[unreadable body]";
      }
      return `HTTP ${response.status} ${response.statusText || ""}`.trim()
        + (body ? ` — ${body.slice(0, 300)}` : "");
    }
    if (code === "ECONNABORTED" || code === "ETIMEDOUT") {
      return `Timed out (${code}): ${message}`;
    }
    return `Network error${code ? ` (${code})` : ""}: ${message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function buildEmail(failures: QuidaxFailure[], droppedCount: number): { subject: string; text: string } {
  const markets = [...new Set(failures.map((f) => f.market))].join(", ");
  const subject = `[2Settle] Quidax rate API failed ${failures.length}x (${markets})`;

  const lines = failures.map((f) =>
    `${f.at.toISOString()}  ${f.market}  [${f.source}]\n  Reason:   ${f.reason}\n  Fallback: ${f.fallback}`,
  );

  const header = [`${failures.length} Quidax rate API call(s) failed since the last digest.`];
  if (droppedCount) {
    header.push(`${droppedCount} older failure(s) were dropped because the buffer was full.`);
  }

  const text = [
    ...header,
    "",
    ...lines,
    "",
    `Environment: ${process.env.NODE_ENV || "development"}`,
    `Host: ${os.hostname()} (pid ${process.pid})`,
    `Database: ${config.db.database}`,
  ].join("\n");

  return { subject, text };
}

async function send(): Promise<void> {
  if (buffer.length === 0) return;
  const failures = buffer;
  const droppedCount = dropped;
  buffer = [];
  dropped = 0;

  const { subject, text } = buildEmail(failures, droppedCount);
  const transport = createAlertTransport();
  try {
    const result = await transport.sendMail({
      from: config.rateAlerts.from,
      to: config.rateAlerts.recipients,
      subject,
      text,
    });
    if (result.rejected?.length) throw new Error("SMTP rejected one or more recipients");
    lastSentAt = Date.now();
    console.log(`[QuidaxAlerts] Sent digest with ${failures.length} failure(s)`);
  } catch (error) {
    // Put them back so the next window retries; keep the newest.
    buffer = [...failures, ...buffer];
    dropped += droppedCount;
    trimBuffer();
    lastSentAt = Date.now(); // back off a full window before retrying
    console.error("[QuidaxAlerts] Could not send digest:", error instanceof Error ? error.message : error);
    schedule();
  } finally {
    transport.close();
  }
}

function trimBuffer(): void {
  if (buffer.length > MAX_BUFFERED) {
    dropped += buffer.length - MAX_BUFFERED;
    buffer = buffer.slice(-MAX_BUFFERED);
  }
}

function schedule(): void {
  if (timer || buffer.length === 0) return;
  const delay = Math.max(0, lastSentAt + windowMs() - Date.now());
  timer = setTimeout(() => {
    timer = null;
    void flushQuidaxFailureAlerts();
  }, delay);
  timer.unref?.(); // never keep a process alive just for the digest
}

/** Record a failed Quidax call. Safe to call from any pricing path. */
export function recordQuidaxFailure(failure: Omit<QuidaxFailure, "at"> & { at?: Date }): void {
  try {
    console.warn(
      `[QuidaxAlerts] Quidax ${failure.market} failed [${failure.source}]: ${failure.reason} | fallback: ${failure.fallback}`,
    );
    if (!alertsConfigured()) return;
    buffer.push({ ...failure, at: failure.at ?? new Date() });
    trimBuffer();
    schedule();
  } catch (error) {
    console.error("[QuidaxAlerts] Could not record failure:", error);
  }
}

/** Send any buffered failures now (used by short-lived scripts before exit). */
export async function flushQuidaxFailureAlerts(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (sending) await sending;
  sending = send().finally(() => {
    sending = null;
  });
  await sending;
}

export const __testing__ = {
  reset(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    buffer = [];
    dropped = 0;
    lastSentAt = 0;
    sending = null;
  },
  pending: (): QuidaxFailure[] => [...buffer],
  buildEmail,
};
