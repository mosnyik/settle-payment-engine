import path from 'path';
import nodemailer from 'nodemailer';
import config from '../../../config';
import { AlertState, RateOutcome, decideAlert, readState, writeState } from './rate-alert-state';

export function getRateRowId(): number {
  const id = Number(process.env.RATE_ROW_ID || '1');
  if (!Number.isInteger(id) || id <= 0) throw new Error('RATE_ROW_ID must be a positive integer');
  return id;
}

function stateFile(kind: string): string {
  const key = encodeURIComponent(`${config.db.host}-${config.db.port}-${config.db.database}-${getRateRowId()}`);
  return path.join(config.rateAlerts.stateDirectory, `${key}.${kind}.json`);
}

export async function recordRateOutcome(error?: string): Promise<void> {
  if (!config.rateAlerts.enabled) return;
  const file = stateFile('outcome');
  const previous = await readState<RateOutcome>(file);
  await writeState(file, error === undefined
    ? { lastSuccessAt: Date.now() }
    : { lastSuccessAt: previous?.lastSuccessAt, failedAt: Date.now(), error });
}

export function validateRateAlertConfig(): void {
  const alerts = config.rateAlerts;
  if (!alerts.recipients.length || alerts.recipients.some((email) => !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(email))) {
    throw new Error('RATE_ALERT_EMAIL_TO must contain comma-separated email addresses');
  }
  if (!alerts.from || !config.auth.email.smtpHost) throw new Error('Rate alerts require RATE_ALERT_EMAIL_FROM and SMTP_HOST');
  for (const value of [alerts.staleAfterMinutes, alerts.checkIntervalSeconds, alerts.cooldownMinutes]) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Rate alert timing settings must be positive numbers');
  }
  getRateRowId();
}

const smtp = () => nodemailer.createTransport({
  host: config.auth.email.smtpHost,
  port: config.auth.email.smtpPort,
  secure: config.auth.email.smtpPort === 465,
  auth: config.auth.email.smtpUser ? { user: config.auth.email.smtpUser, pass: config.auth.email.smtpPassword } : undefined,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
});

// Only the separate monitor writes alert state; the updater writes outcome state.
export async function checkRateAlerts(): Promise<void> {
  validateRateAlertConfig();
  const now = Date.now();
  const file = stateFile('alerts');
  let state = await readState<AlertState>(file);
  if (!state) {
    state = { monitoringStartedAt: now };
    await writeState(file, state);
  }
  const outcome = await readState<RateOutcome>(stateFile('outcome'));
  const decision = decideAlert(outcome, state, now,
    config.rateAlerts.staleAfterMinutes * 60000, config.rateAlerts.cooldownMinutes * 60000);
  if (!decision) return;
  const transport = smtp();
  try {
    const result = await transport.sendMail({
      from: config.rateAlerts.from,
      to: config.rateAlerts.recipients,
      subject: `[2Settle] Rate updater ${decision.kind} (${config.db.database})`,
      text: `${decision.detail}\nDatabase: ${config.db.database}\nRate row: ${getRateRowId()}\nEnvironment: ${process.env.NODE_ENV || 'development'}\nServer: ${config.db.host}:${config.db.port}`,
    });
    if (result.rejected?.length) throw new Error('SMTP rejected one or more rate alert recipients');
    await writeState(file, {
      ...state,
      incidentOpen: decision.kind !== 'recovery',
      lastAlertAt: decision.kind === 'recovery' ? undefined : now,
    });
    console.log(`[RateMonitor] Sent ${decision.kind} email`);
  } finally {
    transport.close();
  }
}
