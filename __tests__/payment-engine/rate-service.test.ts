/**
 * Rate Service Tests
 *
 * Tests for rate fetching, caching, and locking.
 * These tests mock the database and external API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  lockRate,
  isRateLockValid,
  fiatToCrypto,
  cryptoToFiat,
  clearRateCache,
  __testing__,
} from '@/services/payment-engine/rate/rate-service';

// ===========================================================================
// MOCKS
// ===========================================================================

// Mock the MySQL pool
vi.mock('@/lib/mysql', () => ({
  default: {
    execute: vi.fn(),
    query: vi.fn(),
  },
}));

// Mock axios
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

// ===========================================================================
// TEST HELPERS
// ===========================================================================

async function getMockedPool() {
  const pool = await import('@/lib/mysql');
  return pool.default;
}

async function getMockedAxios() {
  const axios = await import('axios');
  return axios.default;
}

/**
 * Setup mock for database rate query.
 */
async function mockDatabaseRate(currentRate: number = 1600) {
  const pool = await getMockedPool();
  (pool.execute as any).mockResolvedValue([
    [{ current_rate: currentRate, merchant_rate: currentRate, profit_rate: 0 }],
  ]);
}

/**
 * Setup mock for CoinMarketCap API.
 */
async function mockCoinMarketCapPrice(symbol: string, price: number) {
  const axios = await getMockedAxios();
  (axios.get as any).mockResolvedValue({
    data: {
      data: {
        [symbol]: {
          quote: {
            USD: { price },
          },
        },
      },
    },
  });
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('Rate Service', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearRateCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearRateCache();
  });

  // ===========================================================================
  // lockRate
  // ===========================================================================

  describe('lockRate', () => {
    it('should lock rate for USDT (price is always 1)', async () => {
      await mockDatabaseRate(1600);

      const lock = await lockRate('USDT', 'NGN');

      expect(lock.rate).toBeCloseTo(1587.2, 1); // 1600 - 0.8%
      expect(lock.assetPrice).toBe(1.0); // USDT is always $1
      expect(lock.lockedAt).toBeInstanceOf(Date);
      expect(lock.expiresAt).toBeInstanceOf(Date);
      expect(lock.expiresAt.getTime()).toBeGreaterThan(lock.lockedAt.getTime());
    });

    it('should lock rate for BTC (fetches price from API)', async () => {
      await mockDatabaseRate(1600);
      await mockCoinMarketCapPrice('BTC', 95000);

      const lock = await lockRate('BTC', 'NGN');

      expect(lock.rate).toBeCloseTo(1587.2, 1);
      expect(lock.assetPrice).toBe(95000);
    });

    it('should lock rate for ETH', async () => {
      await mockDatabaseRate(1600);
      await mockCoinMarketCapPrice('ETH', 3500);

      const lock = await lockRate('ETH', 'NGN');

      expect(lock.rate).toBeCloseTo(1587.2, 1);
      expect(lock.assetPrice).toBe(3500);
    });

    it('should respect custom TTL', async () => {
      await mockDatabaseRate(1600);

      const lock = await lockRate('USDT', 'NGN', 60); // 60 minutes

      const expectedExpiry = lock.lockedAt.getTime() + 60 * 60 * 1000;
      expect(lock.expiresAt.getTime()).toBeCloseTo(expectedExpiry, -3); // Within 1 second
    });

    it('should use default TTL of 30 minutes', async () => {
      await mockDatabaseRate(1600);

      const lock = await lockRate('USDT', 'NGN');

      const expectedExpiry = lock.lockedAt.getTime() + 30 * 60 * 1000;
      expect(lock.expiresAt.getTime()).toBeCloseTo(expectedExpiry, -3);
    });
  });

  // ===========================================================================
  // isRateLockValid
  // ===========================================================================

  describe('isRateLockValid', () => {
    it('should return true for unexpired lock', () => {
      const now = new Date();
      const lock = {
        rate: 1600,
        assetPrice: 1,
        lockedAt: now,
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000), // 30 min from now
      };

      expect(isRateLockValid(lock)).toBe(true);
    });

    it('should return false for expired lock', () => {
      const now = new Date();
      const lock = {
        rate: 1600,
        assetPrice: 1,
        lockedAt: new Date(now.getTime() - 60 * 60 * 1000), // 1 hour ago
        expiresAt: new Date(now.getTime() - 30 * 60 * 1000), // 30 min ago
      };

      expect(isRateLockValid(lock)).toBe(false);
    });

    it('should return false for lock expiring exactly now', () => {
      const now = new Date();
      const lock = {
        rate: 1600,
        assetPrice: 1,
        lockedAt: new Date(now.getTime() - 30 * 60 * 1000),
        expiresAt: new Date(now.getTime() - 1), // 1ms ago
      };

      expect(isRateLockValid(lock)).toBe(false);
    });
  });

  // ===========================================================================
  // fiatToCrypto
  // ===========================================================================

  describe('fiatToCrypto', () => {
    it('should convert fiat to USDT', () => {
      const lock = {
        rate: 1600,
        assetPrice: 1,
        lockedAt: new Date(),
        expiresAt: new Date(),
      };

      // ₦50,000 / 1600 = 31.25 USDT
      expect(fiatToCrypto(50000, lock)).toBeCloseTo(31.25, 4);
    });

    it('should convert fiat to BTC', () => {
      const lock = {
        rate: 1600,
        assetPrice: 95000,
        lockedAt: new Date(),
        expiresAt: new Date(),
      };

      // ₦50,000 / 1600 / 95000 = 0.000328947 BTC
      expect(fiatToCrypto(50000, lock)).toBeCloseTo(0.000328947, 8);
    });

    it('should convert fiat to ETH', () => {
      const lock = {
        rate: 1600,
        assetPrice: 3500,
        lockedAt: new Date(),
        expiresAt: new Date(),
      };

      // ₦100,000 / 1600 / 3500 = 0.017857 ETH
      expect(fiatToCrypto(100000, lock)).toBeCloseTo(0.017857, 5);
    });

    it('should handle small amounts', () => {
      const lock = {
        rate: 1600,
        assetPrice: 1,
        lockedAt: new Date(),
        expiresAt: new Date(),
      };

      // ₦100 / 1600 = 0.0625 USDT
      expect(fiatToCrypto(100, lock)).toBeCloseTo(0.0625, 6);
    });

    it('should handle large amounts', () => {
      const lock = {
        rate: 1600,
        assetPrice: 1,
        lockedAt: new Date(),
        expiresAt: new Date(),
      };

      // ₦10,000,000 / 1600 = 6250 USDT
      expect(fiatToCrypto(10000000, lock)).toBeCloseTo(6250, 2);
    });
  });

  // ===========================================================================
  // cryptoToFiat
  // ===========================================================================

  describe('cryptoToFiat', () => {
    it('should convert USDT to fiat', () => {
      const lock = {
        rate: 1600,
        assetPrice: 1,
        lockedAt: new Date(),
        expiresAt: new Date(),
      };

      // 31.25 USDT * 1 * 1600 = ₦50,000
      expect(cryptoToFiat(31.25, lock)).toBeCloseTo(50000, 0);
    });

    it('should convert BTC to fiat', () => {
      const lock = {
        rate: 1600,
        assetPrice: 95000,
        lockedAt: new Date(),
        expiresAt: new Date(),
      };

      // 0.000328947 BTC * 95000 * 1600 ≈ ₦50,000
      expect(cryptoToFiat(0.000328947, lock)).toBeCloseTo(50000, 0);
    });

    it('should be the inverse of fiatToCrypto', () => {
      const lock = {
        rate: 1600,
        assetPrice: 3500,
        lockedAt: new Date(),
        expiresAt: new Date(),
      };

      const fiat = 100000;
      const crypto = fiatToCrypto(fiat, lock);
      const backToFiat = cryptoToFiat(crypto, lock);

      expect(backToFiat).toBeCloseTo(fiat, 2);
    });
  });

  // ===========================================================================
  // Cache behavior
  // ===========================================================================

  describe('caching', () => {
    it('should cache exchange rates', async () => {
      const pool = await getMockedPool();
      await mockDatabaseRate(1600);

      // First call - should hit database
      await lockRate('USDT', 'NGN');
      expect(pool.execute).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await lockRate('USDT', 'NGN');
      expect(pool.execute).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should cache asset prices', async () => {
      await mockDatabaseRate(1600);
      await mockCoinMarketCapPrice('BTC', 95000);

      const axios = await getMockedAxios();

      // First call - should hit API
      await lockRate('BTC', 'NGN');
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await lockRate('BTC', 'NGN');
      expect(axios.get).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should clear cache when clearRateCache is called', async () => {
      const pool = await getMockedPool();
      await mockDatabaseRate(1600);

      // First call
      await lockRate('USDT', 'NGN');
      expect(pool.execute).toHaveBeenCalledTimes(1);

      // Clear cache
      clearRateCache();

      // Second call - should hit database again
      await lockRate('USDT', 'NGN');
      expect(pool.execute).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // Error handling
  // ===========================================================================

  describe('error handling', () => {
    it('should throw RateServiceUnavailableError when database fails', async () => {
      const pool = await getMockedPool();
      (pool.execute as any).mockRejectedValue(new Error('Database connection failed'));

      await expect(lockRate('USDT', 'NGN')).rejects.toThrow();
    });

    it('should throw RateServiceUnavailableError when API fails', async () => {
      await mockDatabaseRate(1600);

      const axios = await getMockedAxios();
      (axios.get as any).mockRejectedValue(new Error('API timeout'));

      await expect(lockRate('BTC', 'NGN')).rejects.toThrow();
    });

    it('should throw for unsupported fiat currency', async () => {
      await expect(lockRate('USDT', 'USD' as any)).rejects.toThrow();
    });
  });
});
