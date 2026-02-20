/**
 * Charge Calculator Tests
 *
 * Tests for fee calculation logic.
 * These are pure functions - no external dependencies.
 */

import { describe, it, expect } from 'vitest';
import {
  getFeeTier,
  getFiatCharge,
  fiatChargeToCrypto,
  calculateCharges,
  formatCryptoAmount,
  formatFiatAmount,
  validateAmount,
  DEFAULT_FEE_TIERS,
  AMOUNT_LIMITS,
} from '@/services/payment-engine/charges/charge-calculator';
import { RateLock } from '@/services/payment-engine/types';
import { InvalidInputError } from '@/services/payment-engine/errors';

// ===========================================================================
// TEST HELPERS
// ===========================================================================

/**
 * Create a mock rate lock for testing.
 */
function createMockRateLock(rate: number = 1600, assetPrice: number = 95000): RateLock {
  const now = new Date();
  return {
    rate,
    assetPrice,
    lockedAt: now,
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
  };
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('Charge Calculator', () => {
  // ===========================================================================
  // getFeeTier
  // ===========================================================================

  describe('getFeeTier', () => {
    it('should return basic tier for amounts <= 100,000', () => {
      expect(getFeeTier(50000).name).toBe('basic');
      expect(getFeeTier(100000).name).toBe('basic');
    });

    it('should return standard tier for amounts 100,001 - 1,000,000', () => {
      expect(getFeeTier(100001).name).toBe('standard');
      expect(getFeeTier(500000).name).toBe('standard');
      expect(getFeeTier(1000000).name).toBe('standard');
    });

    it('should return premium tier for amounts 1,000,001 - 2,000,000', () => {
      expect(getFeeTier(1000001).name).toBe('premium');
      expect(getFeeTier(1500000).name).toBe('premium');
      expect(getFeeTier(2000000).name).toBe('premium');
    });

    it('should throw error for amounts > 2,000,000', () => {
      expect(() => getFeeTier(2000001)).toThrow(InvalidInputError);
      expect(() => getFeeTier(5000000)).toThrow(InvalidInputError);
    });

    it('should return correct fee amounts for each tier', () => {
      expect(getFeeTier(50000).feeAmount).toBe(500);
      expect(getFeeTier(500000).feeAmount).toBe(1000);
      expect(getFeeTier(1500000).feeAmount).toBe(1500);
    });

    it('should handle edge cases at tier boundaries', () => {
      // At exactly 100,000 -> basic
      expect(getFeeTier(100000).feeAmount).toBe(500);

      // At exactly 100,001 -> standard
      expect(getFeeTier(100001).feeAmount).toBe(1000);

      // At exactly 1,000,000 -> standard
      expect(getFeeTier(1000000).feeAmount).toBe(1000);

      // At exactly 1,000,001 -> premium
      expect(getFeeTier(1000001).feeAmount).toBe(1500);

      // At exactly 2,000,000 -> premium (max limit)
      expect(getFeeTier(2000000).feeAmount).toBe(1500);

      // Above 2,000,000 -> error
      expect(() => getFeeTier(2000001)).toThrow(InvalidInputError);
    });

    it('should handle very small amounts', () => {
      expect(getFeeTier(0).name).toBe('basic');
      expect(getFeeTier(1).name).toBe('basic');
      expect(getFeeTier(0.01).name).toBe('basic');
    });

    it('should throw error for negative amounts', () => {
      expect(() => getFeeTier(-1)).toThrow(InvalidInputError);
      expect(() => getFeeTier(-100)).toThrow(InvalidInputError);
    });

    it('should handle custom fee tiers', () => {
      const customTiers = [
        { maxAmount: 50000, feeAmount: 250, name: 'micro' },
        { maxAmount: Infinity, feeAmount: 500, name: 'default' },
      ];

      expect(getFeeTier(25000, customTiers).name).toBe('micro');
      expect(getFeeTier(75000, customTiers).name).toBe('default');
    });
  });

  // ===========================================================================
  // validateAmount
  // ===========================================================================

  describe('validateAmount', () => {
    it('should accept amounts within limits', () => {
      expect(() => validateAmount(0)).not.toThrow();
      expect(() => validateAmount(1)).not.toThrow();
      expect(() => validateAmount(100000)).not.toThrow();
      expect(() => validateAmount(1000000)).not.toThrow();
      expect(() => validateAmount(2000000)).not.toThrow();
    });

    it('should throw for negative amounts', () => {
      expect(() => validateAmount(-1)).toThrow(InvalidInputError);
      expect(() => validateAmount(-0.01)).toThrow(InvalidInputError);
      expect(() => validateAmount(-100000)).toThrow(InvalidInputError);
    });

    it('should throw for amounts exceeding maximum', () => {
      expect(() => validateAmount(2000001)).toThrow(InvalidInputError);
      expect(() => validateAmount(3000000)).toThrow(InvalidInputError);
      expect(() => validateAmount(10000000)).toThrow(InvalidInputError);
    });

    it('should include helpful error messages', () => {
      try {
        validateAmount(3000000);
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidInputError);
        expect((error as InvalidInputError).message).toContain('2,000,000');
      }

      try {
        validateAmount(-100);
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidInputError);
        expect((error as InvalidInputError).message).toContain('negative');
      }
    });
  });

  // ===========================================================================
  // getFiatCharge
  // ===========================================================================

  describe('getFiatCharge', () => {
    it('should return ₦500 for amounts <= 100,000', () => {
      expect(getFiatCharge(50000)).toBe(500);
      expect(getFiatCharge(100000)).toBe(500);
    });

    it('should return ₦1,000 for amounts 100,001 - 1,000,000', () => {
      expect(getFiatCharge(100001)).toBe(1000);
      expect(getFiatCharge(500000)).toBe(1000);
      expect(getFiatCharge(1000000)).toBe(1000);
    });

    it('should return ₦1,500 for amounts 1,000,001 - 2,000,000', () => {
      expect(getFiatCharge(1000001)).toBe(1500);
      expect(getFiatCharge(1500000)).toBe(1500);
      expect(getFiatCharge(2000000)).toBe(1500);
    });

    it('should throw for amounts > 2,000,000', () => {
      expect(() => getFiatCharge(2000001)).toThrow(InvalidInputError);
    });
  });

  // ===========================================================================
  // fiatChargeToCrypto
  // ===========================================================================

  describe('fiatChargeToCrypto', () => {
    describe('for USDT', () => {
      it('should convert fiat charge to USDT (rate only)', () => {
        const rateLock = createMockRateLock(1600, 1); // Rate: ₦1600/USD
        const charge = fiatChargeToCrypto(500, 'USDT', rateLock);

        // ₦500 / 1600 = 0.3125 USDT
        expect(charge).toBeCloseTo(0.3125, 6);
      });

      it('should handle different rates', () => {
        const rateLock = createMockRateLock(1500, 1);
        const charge = fiatChargeToCrypto(1000, 'USDT', rateLock);

        // ₦1000 / 1500 = 0.6667 USDT
        expect(charge).toBeCloseTo(0.6667, 4);
      });
    });

    describe('for BTC', () => {
      it('should convert fiat charge to BTC (rate and asset price)', () => {
        const rateLock = createMockRateLock(1600, 95000); // Rate: ₦1600/USD, BTC: $95,000
        const charge = fiatChargeToCrypto(500, 'BTC', rateLock);

        // ₦500 / 1600 / 95000 = 0.0000032895 BTC
        expect(charge).toBeCloseTo(0.0000032895, 10);
      });
    });

    describe('for ETH', () => {
      it('should convert fiat charge to ETH', () => {
        const rateLock = createMockRateLock(1600, 3500); // Rate: ₦1600/USD, ETH: $3,500
        const charge = fiatChargeToCrypto(1000, 'ETH', rateLock);

        // ₦1000 / 1600 / 3500 = 0.000178571 ETH
        expect(charge).toBeCloseTo(0.000178571, 8);
      });
    });

    describe('for BNB', () => {
      it('should convert fiat charge to BNB', () => {
        const rateLock = createMockRateLock(1600, 600); // Rate: ₦1600/USD, BNB: $600
        const charge = fiatChargeToCrypto(500, 'BNB', rateLock);

        // ₦500 / 1600 / 600 = 0.000520833 BNB
        expect(charge).toBeCloseTo(0.000520833, 8);
      });
    });

    describe('for TRX', () => {
      it('should convert fiat charge to TRX', () => {
        const rateLock = createMockRateLock(1600, 0.25); // Rate: ₦1600/USD, TRX: $0.25
        const charge = fiatChargeToCrypto(500, 'TRX', rateLock);

        // ₦500 / 1600 / 0.25 = 1.25 TRX
        expect(charge).toBeCloseTo(1.25, 6);
      });
    });
  });

  // ===========================================================================
  // calculateCharges
  // ===========================================================================

  describe('calculateCharges', () => {
    it('should calculate all charge components for USDT', () => {
      const rateLock = createMockRateLock(1600, 1);
      const result = calculateCharges(50000, 'USDT', rateLock);

      expect(result.fiatCharge).toBe(500);
      expect(result.tierName).toBe('basic');
      expect(result.netFiatAmount).toBe(50000);

      // Crypto charge: ₦500 / 1600 = 0.3125 USDT
      expect(result.cryptoCharge).toBeCloseTo(0.3125, 6);

      // Total: (₦50000 / 1600) + 0.3125 = 31.25 + 0.3125 = 31.5625 USDT
      expect(result.totalCryptoAmount).toBeCloseTo(31.5625, 4);
    });

    it('should calculate all charge components for BTC', () => {
      const rateLock = createMockRateLock(1600, 95000);
      const result = calculateCharges(50000, 'BTC', rateLock);

      expect(result.fiatCharge).toBe(500);
      expect(result.tierName).toBe('basic');
      expect(result.netFiatAmount).toBe(50000);

      // Net crypto: ₦50000 / 1600 / 95000 = 0.000328947 BTC
      // Crypto charge: ₦500 / 1600 / 95000 = 0.0000032895 BTC
      // Total: 0.000328947 + 0.0000032895 = 0.000332236 BTC
      expect(result.totalCryptoAmount).toBeCloseTo(0.000332236, 8);
    });

    it('should use standard tier for 500,000 NGN', () => {
      const rateLock = createMockRateLock(1600, 1);
      const result = calculateCharges(500000, 'USDT', rateLock);

      expect(result.fiatCharge).toBe(1000);
      expect(result.tierName).toBe('standard');
    });

    it('should use premium tier for 2,000,000 NGN', () => {
      const rateLock = createMockRateLock(1600, 1);
      const result = calculateCharges(2000000, 'USDT', rateLock);

      expect(result.fiatCharge).toBe(1500);
      expect(result.tierName).toBe('premium');
    });

    it('should work with ETH', () => {
      const rateLock = createMockRateLock(1600, 3500);
      const result = calculateCharges(100000, 'ETH', rateLock);

      expect(result.fiatCharge).toBe(500);

      // Net crypto: ₦100000 / 1600 / 3500 = 0.017857 ETH
      // Crypto charge: ₦500 / 1600 / 3500 = 0.0000893 ETH
      // Total should be slightly more than net
      expect(result.totalCryptoAmount).toBeGreaterThan(0.017857);
      expect(result.totalCryptoAmount).toBeLessThan(0.018);
    });
  });

  // ===========================================================================
  // formatCryptoAmount
  // ===========================================================================

  describe('formatCryptoAmount', () => {
    it('should format USDT with 4 decimals', () => {
      expect(formatCryptoAmount(31.5625, 'USDT')).toBe('31.5625');
      expect(formatCryptoAmount(100, 'USDT')).toBe('100.0000');
    });

    it('should format BTC with 8 decimals', () => {
      expect(formatCryptoAmount(0.000332236, 'BTC')).toBe('0.00033224');
      expect(formatCryptoAmount(1.23456789, 'BTC')).toBe('1.23456789');
    });

    it('should format ETH with 8 decimals', () => {
      expect(formatCryptoAmount(0.017857, 'ETH')).toBe('0.01785700');
    });

    it('should format BNB with 8 decimals', () => {
      expect(formatCryptoAmount(0.5, 'BNB')).toBe('0.50000000');
    });

    it('should format TRX with 8 decimals', () => {
      expect(formatCryptoAmount(125.5, 'TRX')).toBe('125.50000000');
    });
  });

  // ===========================================================================
  // formatFiatAmount
  // ===========================================================================

  describe('formatFiatAmount', () => {
    it('should format NGN amounts with currency symbol', () => {
      const result = formatFiatAmount(50000, 'NGN');
      expect(result).toContain('50,000');
      // The exact symbol depends on locale, but it should be formatted
    });

    it('should format large amounts with commas', () => {
      const result = formatFiatAmount(1000000, 'NGN');
      expect(result).toContain('1,000,000');
    });

    it('should handle decimal amounts', () => {
      const result = formatFiatAmount(50000.50, 'NGN');
      expect(result).toContain('50,000');
    });

    it('should default to NGN if no currency provided', () => {
      const result = formatFiatAmount(50000);
      expect(result).toBeDefined();
    });
  });

  // ===========================================================================
  // DEFAULT_FEE_TIERS
  // ===========================================================================

  describe('DEFAULT_FEE_TIERS', () => {
    it('should have 3 tiers', () => {
      expect(DEFAULT_FEE_TIERS).toHaveLength(3);
    });

    it('should have tiers in ascending order', () => {
      expect(DEFAULT_FEE_TIERS[0].maxAmount).toBe(100000);
      expect(DEFAULT_FEE_TIERS[1].maxAmount).toBe(1000000);
      expect(DEFAULT_FEE_TIERS[2].maxAmount).toBe(2000000);
    });

    it('should have correct fee amounts', () => {
      expect(DEFAULT_FEE_TIERS[0].feeAmount).toBe(500);
      expect(DEFAULT_FEE_TIERS[1].feeAmount).toBe(1000);
      expect(DEFAULT_FEE_TIERS[2].feeAmount).toBe(1500);
    });

    it('should have descriptive names', () => {
      expect(DEFAULT_FEE_TIERS[0].name).toBe('basic');
      expect(DEFAULT_FEE_TIERS[1].name).toBe('standard');
      expect(DEFAULT_FEE_TIERS[2].name).toBe('premium');
    });
  });

  // ===========================================================================
  // AMOUNT_LIMITS
  // ===========================================================================

  describe('AMOUNT_LIMITS', () => {
    it('should have MIN of 0', () => {
      expect(AMOUNT_LIMITS.MIN).toBe(0);
    });

    it('should have MAX of 2,000,000', () => {
      expect(AMOUNT_LIMITS.MAX).toBe(2000000);
    });
  });
});
