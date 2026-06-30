import { FiatCurrency } from '../../types';
import { RateQuote, RateProvider } from './types';
import { RateServiceUnavailableError } from '../../errors';

/**
 * Reads the current rate from the local `rates` table.
 * This is always enabled and acts as the fallback provider.
 */
export class SystemRateProvider implements RateProvider {
  readonly name = 'system';

  isEnabled(): boolean {
    return true;
  }

  async fetchRate(fiatCurrency: FiatCurrency): Promise<RateQuote> {
    if (fiatCurrency !== 'NGN') {
      throw new RateServiceUnavailableError(`Currency ${fiatCurrency} not supported by system provider`);
    }

    const pool = (await import('../../../../lib/mysql')).default;
    const [rows] = await pool.execute<any[]>('SELECT current_rate FROM rates LIMIT 1');

    if (!rows || rows.length === 0) {
      throw new RateServiceUnavailableError('No rates found in database');
    }

    const raw = rows[0].current_rate;
    const rate = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''));

    if (!Number.isFinite(rate) || rate <= 0) {
      throw new RateServiceUnavailableError('Invalid rate value in database');
    }

    return { provider: this.name, rate, fetchedAt: new Date() };
  }
}
