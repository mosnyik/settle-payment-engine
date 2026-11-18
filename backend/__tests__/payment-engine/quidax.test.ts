/**
 * Quidax ticker client: buy price, one retry on empty/bad ticker, raw body in errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { fetchQuidaxBuyPrice } from '@/services/payment-engine/rate/quidax';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const get = axios.get as unknown as ReturnType<typeof vi.fn>;

function tickerResponse(ticker: Record<string, unknown>, status = 'success') {
  return { data: { status, data: { market: 'ethusdt', ticker } } };
}

describe('fetchQuidaxBuyPrice', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('returns the ticker buy price', async () => {
    get.mockResolvedValueOnce(tickerResponse({ buy: '1770.65', sell: '1777.75', last: '1784.11' }));

    await expect(fetchQuidaxBuyPrice('ETHUSDT', { retryDelayMs: 0 })).resolves.toBe(1770.65);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toContain('/markets/tickers/ethusdt');
  });

  it('retries once when the ticker has no buy price, and succeeds', async () => {
    get
      .mockResolvedValueOnce(tickerResponse({ buy: '0.0', sell: '1777.75' }))
      .mockResolvedValueOnce(tickerResponse({ buy: '1770.65', sell: '1777.75' }));

    await expect(fetchQuidaxBuyPrice('ethusdt', { retryDelayMs: 0 })).resolves.toBe(1770.65);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('retries once on a non-success status, and succeeds', async () => {
    get
      .mockResolvedValueOnce({ data: { status: 'error', message: 'busy' } })
      .mockResolvedValueOnce(tickerResponse({ buy: '1770.65' }));

    await expect(fetchQuidaxBuyPrice('ethusdt', { retryDelayMs: 0 })).resolves.toBe(1770.65);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('includes the raw ticker in the error when both attempts are empty', async () => {
    get
      .mockResolvedValueOnce(tickerResponse({ buy: null, sell: '1777.75' }))
      .mockResolvedValueOnce(tickerResponse({ buy: '', sell: '1778.1' }));

    const error = await fetchQuidaxBuyPrice('ethusdt', { retryDelayMs: 0 }).catch((e) => e);
    expect(get).toHaveBeenCalledTimes(2);
    expect(error.message).toContain('Quidax ethusdt ticker has no valid buy price');
    expect(error.message).toContain('"buy":""');      // second attempt's raw ticker
    expect(error.message).toContain('"buy":null');    // first attempt's raw ticker
    expect(error.message).toContain('retried once after 0ms');
  });

  it('does not retry network/HTTP errors', async () => {
    const httpError = Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      response: { status: 503, statusText: 'Service Unavailable', data: 'down' },
    });
    get.mockRejectedValueOnce(httpError);

    await expect(fetchQuidaxBuyPrice('ethusdt', { retryDelayMs: 0 })).rejects.toBe(httpError);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('truncates very large raw bodies', async () => {
    const huge = 'x'.repeat(5000);
    get
      .mockResolvedValueOnce({ data: { status: 'error', junk: huge } })
      .mockResolvedValueOnce({ data: { status: 'error', junk: huge } });

    const error = await fetchQuidaxBuyPrice('ethusdt', { retryDelayMs: 0 }).catch((e) => e);
    expect(error.message.length).toBeLessThan(1000);
    expect(error.message).toContain('…');
  });
});
