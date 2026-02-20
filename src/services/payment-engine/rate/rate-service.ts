/**
 * Rate Service
 */

import axios from 'axios';
import { CryptoCurrency, FiatCurrency, RateLock, DEFAULT_CONFIG } from '../types';
import { RateServiceUnavailableError } from '../errors';
import config from '../../../config';

interface RateData {
  exchangeRate: number;
  merchantRate: number;
  profitRate: number;
}

interface AssetPrice {
  symbol: CryptoCurrency;
  priceUsd: number;
  fetchedAt: Date;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: Date;
}

class RateCache {
  private exchangeRateCache: CacheEntry<RateData> | null = null;
  private assetPriceCache: Map<CryptoCurrency, CacheEntry<AssetPrice>> = new Map();
  private readonly TTL_MS = 60 * 1000;

  getExchangeRate(): RateData | null {
    if (!this.exchangeRateCache) return null;
    if (new Date() > this.exchangeRateCache.expiresAt) {
      this.exchangeRateCache = null;
      return null;
    }
    return this.exchangeRateCache.data;
  }

  setExchangeRate(data: RateData): void {
    this.exchangeRateCache = {
      data,
      expiresAt: new Date(Date.now() + this.TTL_MS),
    };
  }

  getAssetPrice(symbol: CryptoCurrency): AssetPrice | null {
    const entry = this.assetPriceCache.get(symbol);
    if (!entry) return null;
    if (new Date() > entry.expiresAt) {
      this.assetPriceCache.delete(symbol);
      return null;
    }
    return entry.data;
  }

  setAssetPrice(price: AssetPrice): void {
    this.assetPriceCache.set(price.symbol, {
      data: price,
      expiresAt: new Date(Date.now() + this.TTL_MS),
    });
  }

  clear(): void {
    this.exchangeRateCache = null;
    this.assetPriceCache.clear();
  }
}

const cache = new RateCache();

async function fetchExchangeRateFromDb(fiatCurrency: FiatCurrency): Promise<RateData> {
  if (fiatCurrency !== 'NGN') {
    throw new RateServiceUnavailableError(`Currency ${fiatCurrency} not supported yet`);
  }

  try {
    const pool = (await import('../../../lib/mysql')).default;
    const [rows] = await pool.execute<any[]>('SELECT * FROM rates LIMIT 1');

    if (!rows || rows.length === 0) {
      throw new RateServiceUnavailableError('No rates found in database');
    }

    const rateRow = rows[0];

    const parseRate = (value: string | number): number => {
      if (typeof value === 'number') return value;
      return parseFloat(value.toString().replace(/,/g, ''));
    };

    const currentRate = parseRate(rateRow.current_rate);
    const merchantRate = parseRate(rateRow.merchant_rate || rateRow.current_rate);
    const profitRate = parseRate(rateRow.profit_rate || 0);

    // Apply 0.8% adjustment
    const percentage = 0.8;
    const adjustment = (percentage / 100) * currentRate;
    const adjustedRate = currentRate - adjustment;

    return {
      exchangeRate: adjustedRate,
      merchantRate,
      profitRate,
    };
  } catch (error) {
    if (error instanceof RateServiceUnavailableError) {
      throw error;
    }
    throw new RateServiceUnavailableError(
      'Failed to fetch exchange rate',
      error instanceof Error ? error : undefined
    );
  }
}

async function fetchAssetPriceFromApi(crypto: CryptoCurrency): Promise<AssetPrice> {
  try {
    if (crypto === 'USDT') {
      return {
        symbol: 'USDT',
        priceUsd: 1.0,
        fetchedAt: new Date(),
      };
    }

    const response = await axios.get(
      'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest',
      {
        params: { symbol: crypto },
        headers: {
          'X-CMC_PRO_API_KEY': config.coinmarketcap.apiKey,
        },
        timeout: 10000,
      }
    );

    const priceUsd = response.data.data[crypto].quote.USD.price;

    return {
      symbol: crypto,
      priceUsd,
      fetchedAt: new Date(),
    };
  } catch (error) {
    throw new RateServiceUnavailableError(
      `Failed to fetch ${crypto} price`,
      error instanceof Error ? error : undefined
    );
  }
}

export async function getExchangeRate(fiatCurrency: FiatCurrency = 'NGN'): Promise<RateData> {
  const cached = cache.getExchangeRate();
  if (cached) {
    return cached;
  }

  const rateData = await fetchExchangeRateFromDb(fiatCurrency);
  cache.setExchangeRate(rateData);

  return rateData;
}

export async function getAssetPrice(crypto: CryptoCurrency): Promise<number> {
  const cached = cache.getAssetPrice(crypto);
  if (cached) {
    return cached.priceUsd;
  }

  const assetPrice = await fetchAssetPriceFromApi(crypto);
  cache.setAssetPrice(assetPrice);

  return assetPrice.priceUsd;
}

export async function lockRate(
  crypto: CryptoCurrency,
  fiatCurrency: FiatCurrency = 'NGN',
  ttlMinutes: number = DEFAULT_CONFIG.rateLockTtlMinutes
): Promise<RateLock> {
  const [rateData, assetPrice] = await Promise.all([
    getExchangeRate(fiatCurrency),
    getAssetPrice(crypto),
  ]);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

  return {
    rate: rateData.exchangeRate,
    assetPrice,
    lockedAt: now,
    expiresAt,
  };
}

export function isRateLockValid(lock: RateLock): boolean {
  return new Date() < lock.expiresAt;
}

export function fiatToCrypto(fiatAmount: number, lock: RateLock): number {
  const usdAmount = fiatAmount / lock.rate;
  const cryptoAmount = usdAmount / lock.assetPrice;
  return cryptoAmount;
}

export function cryptoToFiat(cryptoAmount: number, lock: RateLock): number {
  const usdAmount = cryptoAmount * lock.assetPrice;
  const fiatAmount = usdAmount * lock.rate;
  return fiatAmount;
}

export function clearRateCache(): void {
  cache.clear();
}

export const __testing__ = {
  cache,
  fetchExchangeRateFromDb,
  fetchAssetPriceFromApi,
};
