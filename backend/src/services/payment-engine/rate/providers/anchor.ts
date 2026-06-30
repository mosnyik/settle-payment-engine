import { AxiosRequestConfig } from 'axios';
import { FiatCurrency } from '../../types';
import { HttpRateProvider } from './http-provider';
import config from '../../../../config';

/**
 * Anchor rate provider.
 *
 * TODO: Plug in the real Anchor endpoint and response shape.
 *
 * Steps to activate:
 *  1. Set ANCHOR_RATE_ENABLED=true, ANCHOR_API_KEY, and ANCHOR_API_URL in .env
 *  2. Implement `buildRequest` with the correct path / auth headers
 *  3. Implement `parseResponse` to extract the NGN-per-USD rate from the response
 */
export class AnchorRateProvider extends HttpRateProvider {
  readonly name = 'anchor';
  protected readonly timeoutMs = 8000;

  isEnabled(): boolean {
    return config.rateEngine.providers.anchor.enabled;
  }

  protected buildRequest(_fiatCurrency: FiatCurrency): AxiosRequestConfig {
    // TODO: replace with real Anchor FX rate endpoint
    return {
      method: 'GET',
      baseURL: config.rateEngine.providers.anchor.apiUrl,
      url: '/TODO/fx-rates',
      headers: {
        Authorization: `Bearer ${config.rateEngine.providers.anchor.apiKey}`,
        Accept: 'application/json',
      },
    };
  }

  protected parseResponse(data: unknown, _fiatCurrency: FiatCurrency): number {
    // TODO: navigate to the NGN/USD rate field in the Anchor response
    // Example shape (update to match real response):
    //   { data: { usd_ngn: 1648.0 } }
    const body = data as Record<string, unknown>;
    const inner = body['data'] as Record<string, unknown> | undefined;
    const rate = inner?.['usd_ngn'];
    if (typeof rate !== 'number') {
      throw new Error(`Unexpected Anchor response shape: ${JSON.stringify(data)}`);
    }
    return rate;
  }
}
