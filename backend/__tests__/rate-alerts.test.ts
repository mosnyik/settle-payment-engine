import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import config, { parseRateAlertRecipients } from '../src/config';
import { decideAlert } from '../src/services/payment-engine/rate/rate-alert-state';
import { checkRateAlerts, recordRateOutcome } from '../src/services/payment-engine/rate/rate-email-alerts';

const { sendMail, close } = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail, close }) } }));

describe('rate alert decisions', () => {
  const state = { monitoringStartedAt: 0 };
  it('trims, removes blanks and deduplicates multiple recipients', () => {
    expect(parseRateAlertRecipients(' ops@example.com,admin@example.com,,ops@example.com '))
      .toEqual(['ops@example.com', 'admin@example.com']);
  });
  it('alerts immediately for a recorded failure', () => {
    expect(decideAlert({ failedAt: 1, error: 'Unavailable' }, state, 2, 100, 200)?.kind).toBe('failure');
  });
  it('detects no updates even when the updater never started', () => {
    expect(decideAlert(undefined, state, 99, 100, 200)).toBeUndefined();
    expect(decideAlert(undefined, state, 100, 100, 200)?.kind).toBe('stale');
  });
  it('detects an updater that stopped after a successful run', () => {
    expect(decideAlert({ lastSuccessAt: 50 }, state, 150, 100, 200)?.kind).toBe('stale');
  });
  it('suppresses repeat alerts until cooldown expires', () => {
    const incident = { ...state, incidentOpen: true, lastAlertAt: 100 };
    expect(decideAlert({ failedAt: 10 }, incident, 299, 100, 200)).toBeUndefined();
    expect(decideAlert({ failedAt: 10 }, incident, 300, 100, 200)?.kind).toBe('failure');
  });
  it('sends recovery without waiting for cooldown', () => {
    expect(decideAlert({ lastSuccessAt: 101 }, { ...state, incidentOpen: true, lastAlertAt: 100 }, 102, 100, 200)?.kind)
      .toBe('recovery');
    expect(decideAlert({ lastSuccessAt: 101 }, state, 102, 100, 200)).toBeUndefined();
  });
});

describe('persisted email monitoring', () => {
  const originalAlerts = { ...config.rateAlerts };
  const originalEmail = { ...config.auth.email };
  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rate-alert-test-'));
    Object.assign(config.rateAlerts, {
      enabled: true, recipients: ['ops@example.com', 'admin@example.com'], from: 'alerts@example.com',
      staleAfterMinutes: 45, checkIntervalSeconds: 60, cooldownMinutes: 60, stateDirectory: directory,
    });
    config.auth.email.smtpHost = 'smtp.example.com';
    vi.stubEnv('RATE_ROW_ID', '1');
    sendMail.mockReset().mockResolvedValue({ rejected: [] });
    close.mockClear();
  });
  afterEach(async () => {
    Object.assign(config.rateAlerts, originalAlerts);
    Object.assign(config.auth.email, originalEmail);
    vi.unstubAllEnvs();
    await fs.rm(directory, { recursive: true, force: true });
  });
  it('emails both recipients, persists cooldown and sends recovery only once', async () => {
    await recordRateOutcome('CoinGecko unavailable');
    await checkRateAlerts();
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: ['ops@example.com', 'admin@example.com'] }));
    await checkRateAlerts();
    expect(sendMail).toHaveBeenCalledTimes(1);
    await recordRateOutcome();
    await checkRateAlerts();
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls[1][0].subject).toContain('recovery');
    await checkRateAlerts();
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
  it('retries after SMTP failure instead of marking the alert delivered', async () => {
    await recordRateOutcome('Database unavailable');
    sendMail.mockRejectedValueOnce(new Error('SMTP offline'));
    await expect(checkRateAlerts()).rejects.toThrow('SMTP offline');
    await checkRateAlerts();
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
  it('rejects invalid recipients before sending', async () => {
    config.rateAlerts.recipients = ['invalid'];
    await expect(checkRateAlerts()).rejects.toThrow('RATE_ALERT_EMAIL_TO');
    expect(sendMail).not.toHaveBeenCalled();
  });
});
