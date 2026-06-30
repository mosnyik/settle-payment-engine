import axios, { AxiosRequestConfig } from 'axios';
import { FiatCurrency } from '../../types';
import { RateQuote, RateProvider } from './types';

/**
 * Base class for HTTP-based rate providers.
 *
 * Subclasses implement `buildRequest` (returns Axios config) and
 * `parseResponse` (extracts the NGN-per-USD rate from the response body).
 * Error handling, timeout, and enabled-flag logic live here.
 */
export abstract class HttpRateProvider implements RateProvider {
  abstract readonly name: string;
  protected abstract readonly timeoutMs: number;

  abstract isEnabled(): boolean;

  /**
   * Return the Axios request config for the given currency.
   * Headers, params, and base URL all go here.
   */
  protected abstract buildRequest(fiatCurrency: FiatCurrency): AxiosRequestConfig;

  /**
   * Extract the rate (fiat per USD) from the raw response body.
   * Throw a descriptive Error if the body does not contain a usable rate.
   */
  protected abstract parseResponse(data: unknown, fiatCurrency: FiatCurrency): number;

  async fetchRate(fiatCurrency: FiatCurrency): Promise<RateQuote> {
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
