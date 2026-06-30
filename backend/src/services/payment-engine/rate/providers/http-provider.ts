import axios, { AxiosRequestConfig } from 'axios';
import { FiatCurrency } from '../../types';
import { RateQuote, RateProvider } from './types';

const MAX_STALE_MS = 5 * 60 * 1000; // reject cached rates older than 5 minutes

/**
 * Base class for HTTP-based rate providers.
 *
 * Transaction path  → fetchRate()     reads the last rate from provider_rates DB table.
 * Background job    → fetchLiveRate() makes the actual HTTP call to the provider API.
 *
 * This split means external provider APIs are never called during transaction
 * processing, regardless of transaction volume.
 */
export abstract class HttpRateProvider implements RateProvider {
  abstract readonly name: string;
  protected abstract readonly timeoutMs: number;

  abstract isEnabled(): boolean;

  /** Axios config for the provider's rate endpoint. */
  protected abstract buildRequest(fiatCurrency: FiatCurrency): AxiosRequestConfig;

  /** Extract the fiat-per-USD rate from the raw response body. */
  protected abstract parseResponse(data: unknown, fiatCurrency: FiatCurrency): number;

  /**
   * Read the last rate stored by the fetch job from the provider_rates table.
   * Throws if no row exists yet (job hasn't run) or the cached value is stale.
   */
  async fetchRate(fiatCurrency: FiatCurrency): Promise<RateQuote> {
    const pool = (await import('../../../../lib/mysql')).default;
    const [rows] = await pool.execute<any[]>(
      'SELECT rate, fetched_at FROM provider_rates WHERE provider = ? AND fiat_currency = ? LIMIT 1',
      [this.name, fiatCurrency],
    );

    if (!rows || rows.length === 0) {
      throw new Error(
        `No cached rate for provider "${this.name}" — rate fetch job has not run yet`,
      );
    }

    const fetchedAt = new Date(rows[0].fetched_at);
    const ageMs = Date.now() - fetchedAt.getTime();
    if (ageMs > MAX_STALE_MS) {
      throw new Error(
        `Cached rate for provider "${this.name}" is stale (${Math.round(ageMs / 1000)}s old)`,
      );
    }

    const rate = parseFloat(rows[0].rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Invalid cached rate for provider "${this.name}": ${rows[0].rate}`);
    }

    return { provider: this.name, rate, fetchedAt };
  }

  /**
   * Make a live HTTP call to the provider API.
   * Called only by the rate fetch job — never during transaction processing.
   */
  async fetchLiveRate(fiatCurrency: FiatCurrency): Promise<RateQuote> {
    const requestConfig = this.buildRequest(fiatCurrency);
    const response = await axios.request({
      ...requestConfig,
      timeout: this.timeoutMs,
    });

    const rate = this.parseResponse(response.data, fiatCurrency);

    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`${this.name} returned an invalid rate: ${rate}`);
    }

    return { provider: this.name, rate, fetchedAt: new Date() };
  }
}
