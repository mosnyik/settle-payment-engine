/**
 * Rate Service
 */

import axios from "axios";
import {
  CryptoCurrency,
  FiatCurrency,
  RateLock,
  DEFAULT_CONFIG,
} from "../types";
import { RateServiceUnavailableError } from "../errors";
import config from "../../../config";
import { getBestRate, clearAggregatorCache } from "./rate-aggregator";

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
  private assetPriceCache: Map<CryptoCurrency, CacheEntry<AssetPrice>> =
    new Map();
  private readonly TTL_MS = 60 * 1000;

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
    this.assetPriceCache.clear();
  }
}

const cache = new RateCache();

async function fetchExchangeRateFromAggregator(
  fiatCurrency: FiatCurrency,
): Promise<RateData> {
  try {
    const quote = await getBestRate(fiatCurrency);

    // Apply 1% downward adjustment so the locked rate accounts for slippage
    const adjustment = 0.01 * quote.rate;
    const adjustedRate = quote.rate - adjustment;

    // merchant_rate / profit_rate come from the DB row; read them separately
    // so we can still surface them without duplicating the provider abstraction.
    const pool = (await import("../../../lib/mysql")).default;
    const [rows] = await pool.execute<any[]>(
      "SELECT merchant_rate, profit_rate FROM rates LIMIT 1",
    );
    const rateRow = rows?.[0] ?? {};
    const parseDbRate = (v: unknown): number => {
      if (typeof v === "number") return v;
      if (v == null) return 0;
      return parseFloat(String(v).replace(/,/g, "")) || 0;
    };

    return {
      exchangeRate: adjustedRate,
      merchantRate: parseDbRate(rateRow.merchant_rate),
      profitRate: parseDbRate(rateRow.profit_rate),
    };
  } catch (error) {
    if (error instanceof RateServiceUnavailableError) throw error;
    throw new RateServiceUnavailableError(
      "Failed to fetch exchange rate",
      error instanceof Error ? error : undefined,
    );
  }
}

// Keep the old name as an internal alias so __testing__ exports still work.
const fetchExchangeRateFromDb = fetchExchangeRateFromAggregator;

async function fetchAssetPriceFromApi(
  crypto: CryptoCurrency,
): Promise<AssetPrice> {
  try {
    if (crypto === "USDT") {
      return {
        symbol: "USDT",
        priceUsd: 1,
        fetchedAt: new Date(),
      };
    }

    const response = await axios.get(
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
      {
        params: { symbol: crypto },
        headers: {
          "X-CMC_PRO_API_KEY": config.coinmarketcap.apiKey,
        },
        timeout: 10000,
      },
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
      error instanceof Error ? error : undefined,
    );
  }
}

export async function getExchangeRate(
  fiatCurrency: FiatCurrency = "NGN",
): Promise<RateData> {
  // Caching is handled inside the aggregator (per-provider + best-rate cache).
  return fetchExchangeRateFromAggregator(fiatCurrency);
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
  fiatCurrency: FiatCurrency = "NGN",
  ttlMinutes: number = DEFAULT_CONFIG.rateLockTtlMinutes,
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
  clearAggregatorCache();
}

export const __testing__ = {
  cache,
  fetchExchangeRateFromDb,
  fetchAssetPriceFromApi,
};
