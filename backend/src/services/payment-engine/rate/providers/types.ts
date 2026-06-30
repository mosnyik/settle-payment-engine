import { FiatCurrency } from '../../types';

export interface RateQuote {
  provider: string;
  rate: number; // fiat units per USD (e.g. NGN per USD)
  fetchedAt: Date;
}

export interface RateProvider {
  readonly name: string;
  isEnabled(): boolean;
  fetchRate(fiatCurrency: FiatCurrency): Promise<RateQuote>;
}
