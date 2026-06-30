import { AxiosRequestConfig } from 'axios';
import { FiatCurrency } from '../../types';
import { HttpRateProvider } from './http-provider';
import config from '../../../../config';

/**
 * LiquidRamp rate provider.
 *
 * TODO: Plug in the real LiquidRamp endpoint and response shape.
 *
 * Steps to activate:
 *  1. Set LIQUIDRAMP_RATE_ENABLED=true, LIQUIDRAMP_API_KEY, and LIQUIDRAMP_API_URL in .env
 *  2. Implement `buildRequest` with the correct path / auth headers
 *  3. Implement `parseResponse` to extract the NGN-per-USD rate from the response
 */
export class LiquidRampRateProvider extends HttpRateProvider {
  readonly name = 'liquidramp';
  protected readonly timeoutMs = 8000;

  isEnabled(): boolean {
    return config.rateEngine.providers.liquidramp.enabled;
  }

  protected buildRequest(_fiatCurrency: FiatCurrency): AxiosRequestConfig {
    // TODO: replace with real LiquidRamp rate endpoint
    return {
      method: 'GET',
      baseURL: config.rateEngine.providers.liquidramp.apiUrl,
      url: '/TODO/rates',
      headers: {
        'X-API-Key': config.rateEngine.providers.liquidramp.apiKey,
        Accept: 'application/json',
      },
    };
  }

  protected parseResponse(data: unknown, _fiatCurrency: FiatCurrency): number {
    // TODO: navigate to the NGN/USD rate field in the LiquidRamp response
    // Example shape (update to match real response):
    //   { ngn_usd: 1655.0 }
    const body = data as Record<string, unknown>;
    const rate = body['ngn_usd'];
    if (typeof rate !== 'number') {
      throw new Error(`Unexpected LiquidRamp response shape: ${JSON.stringify(data)}`);
    }
    return rate;
  }
}
