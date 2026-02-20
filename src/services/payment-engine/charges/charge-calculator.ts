/**
 * Charge Calculator
 */

import { CryptoCurrency, RateLock } from '../types';
import { InvalidInputError } from '../errors';

export interface FeeTier {
  maxAmount: number;
  feeAmount: number;
  name: string;
}

export interface ChargeResult {
  fiatCharge: number;
  cryptoCharge: number;
  tierName: string;
  netFiatAmount: number;
  totalCryptoAmount: number;
}

export const AMOUNT_LIMITS = {
  MIN: 0,
  MAX: 2_000_000,
} as const;

export const DEFAULT_FEE_TIERS: FeeTier[] = [
  {
    maxAmount: 100_000,
    feeAmount: 500,
    name: 'basic',
  },
  {
    maxAmount: 1_000_000,
    feeAmount: 1_000,
    name: 'standard',
  },
  {
    maxAmount: 2_000_000,
    feeAmount: 1_500,
    name: 'premium',
  },
];

export function validateAmount(fiatAmount: number): void {
  if (fiatAmount < AMOUNT_LIMITS.MIN) {
    throw new InvalidInputError(
      `Amount cannot be negative. Minimum is ₦${AMOUNT_LIMITS.MIN.toLocaleString()}.`,
      'fiatAmount',
      fiatAmount
    );
  }

  if (fiatAmount > AMOUNT_LIMITS.MAX) {
    throw new InvalidInputError(
      `Amount exceeds maximum limit. Maximum is ₦${AMOUNT_LIMITS.MAX.toLocaleString()}.`,
      'fiatAmount',
      fiatAmount
    );
  }
}

export function getFeeTier(
  fiatAmount: number,
  tiers: FeeTier[] = DEFAULT_FEE_TIERS
): FeeTier {
  validateAmount(fiatAmount);

  for (const tier of tiers) {
    if (fiatAmount <= tier.maxAmount) {
      return tier;
    }
  }

  return tiers[tiers.length - 1];
}

export function getFiatCharge(
  fiatAmount: number,
  tiers: FeeTier[] = DEFAULT_FEE_TIERS
): number {
  const tier = getFeeTier(fiatAmount, tiers);
  return tier.feeAmount;
}

export function fiatChargeToCrypto(
  fiatCharge: number,
  crypto: CryptoCurrency,
  rateLock: RateLock
): number {
  if (crypto === 'USDT') {
    return fiatCharge / rateLock.rate;
  }
  return fiatCharge / rateLock.rate / rateLock.assetPrice;
}

export function calculateCharges(
  fiatAmount: number,
  crypto: CryptoCurrency,
  rateLock: RateLock,
  tiers: FeeTier[] = DEFAULT_FEE_TIERS
): ChargeResult {
  const tier = getFeeTier(fiatAmount, tiers);
  const fiatCharge = tier.feeAmount;
  const cryptoCharge = fiatChargeToCrypto(fiatCharge, crypto, rateLock);

  let netCrypto: number;
  if (crypto === 'USDT') {
    netCrypto = fiatAmount / rateLock.rate;
  } else {
    netCrypto = fiatAmount / rateLock.rate / rateLock.assetPrice;
  }

  const totalCryptoAmount = netCrypto + cryptoCharge;

  return {
    fiatCharge,
    cryptoCharge,
    tierName: tier.name,
    netFiatAmount: fiatAmount,
    totalCryptoAmount,
  };
}

export function formatCryptoAmount(
  amount: number,
  crypto: CryptoCurrency
): string {
  const decimals = crypto === 'USDT' ? 4 : 8;
  return amount.toFixed(decimals);
}

export function formatFiatAmount(
  amount: number,
  currency: string = 'NGN'
): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}
