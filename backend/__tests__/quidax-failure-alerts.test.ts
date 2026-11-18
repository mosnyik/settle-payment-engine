import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import config from '../src/config';
import {
  describeQuidaxError,
  flushQuidaxFailureAlerts,
  recordQuidaxFailure,
  __testing__,
} from '../src/services/payment-engine/rate/quidax-failure-alerts';

const { sendMail, close } = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail, close }) } }));

const failure = (market: string, reason = 'HTTP 503 Service Unavailable') => ({
  market,
  source: 'crypto USD price (API server)',
  reason,
  fallback: 'CoinMarketCap succeeded (64000)',
});

describe('Quidax failure digest emails', () => {
  const originalAlerts = { ...config.rateAlerts };
  const originalEmail = { ...config.auth.email };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    __testing__.reset();
    Object.assign(config.rateAlerts, {
      enabled: true,
      recipients: ['ops@example.com'],
      from: 'alerts@example.com',
      quidaxDigestMinutes: 5,
    });
    config.auth.email.smtpHost = 'smtp.example.com';
    sendMail.mockReset().mockResolvedValue({ rejected: [] });
    close.mockClear();
  });

  afterEach(() => {
    __testing__.reset();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.assign(config.rateAlerts, originalAlerts);
    Object.assign(config.auth.email, originalEmail);
  });

  it('emails the first failure right away with market, reason and fallback', async () => {
    recordQuidaxFailure(failure('btcusdt'));
    await vi.advanceTimersByTimeAsync(0);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toEqual(['ops@example.com']);
    expect(mail.subject).toContain('Quidax rate API failed 1x (btcusdt)');
    expect(mail.text).toContain('Reason:   HTTP 503 Service Unavailable');
    expect(mail.text).toContain('Fallback: CoinMarketCap succeeded (64000)');
  });

  it('batches failures inside the window into one digest that lists every failure', async () => {
    recordQuidaxFailure(failure('btcusdt'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sendMail).toHaveBeenCalledTimes(1);

    recordQuidaxFailure(failure('ethusdt', 'Timed out (ECONNABORTED)'));
    recordQuidaxFailure(failure('btcusdt', 'HTTP 429 Too Many Requests'));
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(sendMail).toHaveBeenCalledTimes(1); // still inside the window

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendMail).toHaveBeenCalledTimes(2);
    const digest = sendMail.mock.calls[1][0];
    expect(digest.subject).toContain('failed 2x (ethusdt, btcusdt)');
    expect(digest.text).toContain('Timed out (ECONNABORTED)');
    expect(digest.text).toContain('HTTP 429 Too Many Requests');
  });

  it('keeps failures and retries next window when SMTP fails', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP down'));
    recordQuidaxFailure(failure('btcusdt'));
    await vi.advanceTimersByTimeAsync(0);
    expect(__testing__.pending()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(__testing__.pending()).toHaveLength(0);
  });

  it('flush sends buffered failures immediately (short-lived updater script)', async () => {
    recordQuidaxFailure(failure('btcusdt'));
    await vi.advanceTimersByTimeAsync(0);
    recordQuidaxFailure({ ...failure('usdtngn'), source: 'USDT/NGN rate updater' });

    await flushQuidaxFailureAlerts();
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls[1][0].text).toContain('usdtngn  [USDT/NGN rate updater]');
  });

  it('does not email when rate alerts are disabled', async () => {
    config.rateAlerts.enabled = false;
    recordQuidaxFailure(failure('btcusdt'));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('describes axios HTTP errors with status and body', () => {
    const error = Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      response: { status: 429, statusText: 'Too Many Requests', data: { message: 'slow down' } },
    });
    expect(describeQuidaxError(error)).toBe('HTTP 429 Too Many Requests — {"message":"slow down"}');
    expect(describeQuidaxError(new Error('Quidax btcusdt ticker has no valid buy price')))
      .toBe('Quidax btcusdt ticker has no valid buy price');
  });
});
