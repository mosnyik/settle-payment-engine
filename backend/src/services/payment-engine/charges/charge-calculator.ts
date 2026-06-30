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
  chargeUsd: number;
  tierName: string;
  netFiatAmount: number;
  totalCryptoAmount: number;
  chargeFrom: 'fiat' | 'crypto';
}

export const AMOUNT_LIMITS = {
  MIN: 1,
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

function isStablecoin(crypto: CryptoCurrency): boolean {
  return crypto === 'USDT' || crypto === 'USDC';
}

export function getCryptoAmountDecimals(crypto: CryptoCurrency): number {
  if (isStablecoin(crypto)) return 2;
  if (crypto === 'BTC') return 8;
  return 5;
}

export function roundCryptoAmount(
  amount: number,
  crypto: CryptoCurrency
): number {
  return Number(amount.toFixed(getCryptoAmountDecimals(crypto)));
}

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
  if (isStablecoin(crypto)) {
    return fiatCharge / rateLock.rate;
  }
  return fiatCharge / rateLock.rate / rateLock.assetPrice;
}

export function calculateCharges(
  fiatAmount: number,
  crypto: CryptoCurrency,
  rateLock: RateLock,
  tiers: FeeTier[] = DEFAULT_FEE_TIERS,
  chargeFrom: 'fiat' | 'crypto' = 'crypto',
  percentageFeeRate: number = 0
): ChargeResult {
  const tier = getFeeTier(fiatAmount, tiers);
  const flatFiatCharge = tier.feeAmount;
  const flatCryptoCharge = fiatChargeToCrypto(flatFiatCharge, crypto, rateLock);

  let netCrypto: number;
  if (isStablecoin(crypto)) {
    netCrypto = fiatAmount / rateLock.rate;
  } else {
    netCrypto = fiatAmount / rateLock.rate / rateLock.assetPrice;
  }

  const extraCryptoFee = percentageFeeRate > 0 ? netCrypto * percentageFeeRate : 0;
  const extraFiatFee = isStablecoin(crypto)
    ? extraCryptoFee * rateLock.rate
    : extraCryptoFee * (rateLock.assetPrice ?? 1) * rateLock.rate;

  const fiatCharge = flatFiatCharge + extraFiatFee;
  const cryptoCharge = flatCryptoCharge + extraCryptoFee;
  const chargeUsd = fiatCharge / rateLock.rate;

  if (chargeFrom === 'fiat') {
    // Charge deducted from fiat payout — receiver gets fiatAmount - fiatCharge.
    // Payer sends crypto only for fiatAmount (no extra crypto needed).
    return {
      fiatCharge,
      cryptoCharge,
      chargeUsd,
      tierName: tier.name,
      netFiatAmount: fiatAmount - fiatCharge,
      totalCryptoAmount: roundCryptoAmount(netCrypto, crypto),
      chargeFrom: 'fiat',
    };
  }

  // chargeFrom === 'crypto' (default):
  // Receiver gets full fiatAmount. Payer sends extra crypto to cover the charge.
  return {
    fiatCharge,
    cryptoCharge,
    chargeUsd,
    tierName: tier.name,
    netFiatAmount: fiatAmount,
    totalCryptoAmount: roundCryptoAmount(netCrypto + cryptoCharge, crypto),
    chargeFrom: 'crypto',
  };
}

/**
 * Reverse (crypto-first) charge calculation.
 *
 * Given the total crypto amount the payer will send, derives the fiat amount
 * the receiver gets after subtracting the flat platform fee and optional
 * percentage fee (e.g. first-transaction 3% on non-USDT assets).
 *
 * Algorithm (converges in ≤ 2 iterations):
 *  1. grossFiat = cryptoAmount × assetPrice × rate
 *  2. Look up tier for an initial estimate → flatFeeAmount1
 *  3. netFiat1 = (grossFiat - flatFeeAmount1) / (1 + percentageFeeRate)
 *  4. Look up tier for netFiat1 → flatFeeAmount2 (corrects boundary crossover)
 *  5. netFiat = (grossFiat - flatFeeAmount2) / (1 + percentageFeeRate)
 *  6. Validate netFiat within AMOUNT_LIMITS
 *  7. Delegate to calculateCharges(netFiat, ...) for a consistent ChargeResult
 */
export function calculateChargesFromCrypto(
  cryptoAmount: number,
  crypto: CryptoCurrency,
  rateLock: RateLock,
  tiers: FeeTier[] = DEFAULT_FEE_TIERS,
  percentageFeeRate: number = 0
): ChargeResult & { derivedFiatAmount: number } {
  // Step 1: gross fiat equivalent of the full crypto amount
  const grossFiat = isStablecoin(crypto)
    ? cryptoAmount * rateLock.rate
    : cryptoAmount * (rateLock.assetPrice ?? 1) * rateLock.rate;

  const feeDivisor = percentageFeeRate > 0 ? 1 + percentageFeeRate : 1;

  // Steps 2–3: first fee estimate (rough estimate for tier lookup)
  const roughFiat = grossFiat / feeDivisor;
  const tier1 = getFeeTier(roughFiat, tiers);
  const netFiat1 = (grossFiat - tier1.feeAmount) / feeDivisor;

  // Steps 4–5: one correction pass (handles tier boundary crossover)
  const tier2 = getFeeTier(netFiat1, tiers);
  const netFiat = (grossFiat - tier2.feeAmount) / feeDivisor;

  // Step 6: validate derived fiat is within engine limits
  validateAmount(netFiat);

  // Step 7: canonical forward calculation — crypto-first always uses chargeFrom:'crypto'
  const result = calculateCharges(netFiat, crypto, rateLock, tiers, 'crypto', percentageFeeRate);

  return { ...result, derivedFiatAmount: netFiat };
}

export function formatCryptoAmount(
  amount: number,
  crypto: CryptoCurrency
): string {
  return amount.toFixed(getCryptoAmountDecimals(crypto));
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
