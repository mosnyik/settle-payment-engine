import { AxiosRequestConfig } from 'axios';
import { FiatCurrency } from '../../types';
import { HttpRateProvider } from './http-provider';
import config from '../../../../config';

/**
 * Busha rate provider.
 *
 * TODO: Plug in the real Busha endpoint and response shape.
 *
 * Steps to activate:
 *  1. Set BUSHA_RATE_ENABLED=true, BUSHA_API_KEY, and BUSHA_API_URL in .env
 *  2. Implement `buildRequest` with the correct path / auth headers
 *  3. Implement `parseResponse` to extract the NGN-per-USD rate from the response
 */
export class BushaRateProvider extends HttpRateProvider {
  readonly name = 'busha';
  protected readonly timeoutMs = 8000;

  isEnabled(): boolean {
    return config.rateEngine.providers.busha.enabled;
  }

  protected buildRequest(_fiatCurrency: FiatCurrency): AxiosRequestConfig {
    // TODO: replace with real Busha rate endpoint
    return {
      method: 'GET',
      baseURL: config.rateEngine.providers.busha.apiUrl,
      url: '/TODO/rates/NGN',
      headers: {
        Authorization: `Bearer ${config.rateEngine.providers.busha.apiKey}`,
        Accept: 'application/json',
      },
    };
  }

  protected parseResponse(data: unknown, _fiatCurrency: FiatCurrency): number {
    // TODO: navigate to the NGN/USD (or NGN/USDT) field in the Busha response
    // Example shape (update to match real response):
    //   { rate: 1650.5 }
    const body = data as Record<string, unknown>;
    const rate = body['rate'];
    if (typeof rate !== 'number') {
      throw new Error(`Unexpected Busha response shape: ${JSON.stringify(data)}`);
    }
    return rate;
  }
}
