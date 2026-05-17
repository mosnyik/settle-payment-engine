/**
 * Payment Engine Types
 *
 * This file defines all the data structures used by the payment engine.
 */

// =============================================================================
// ENUMS
// =============================================================================

export type PaymentType = 'transfer' | 'gift' | 'request' | 'merchant' | 'bank_confirmation';

export type PaymentStatus =
  | 'created'
  | 'pending'
  | 'confirming'
  | 'confirmed'
  | 'settling'
  | 'settled'
  | 'expired'
  | 'failed'
  | 'settlement_reversed';

export type CryptoCurrency = 'BTC' | 'ETH' | 'BNB' | 'TRX' | 'USDT' | 'USDC';

export type Network =
  | 'bitcoin'
  | 'ethereum'
  | 'bsc'
  | 'tron'
  | 'polygon'
  | 'base'
  | 'erc20'
  | 'bep20'
  | 'trc20';

export const NETWORK_TO_CHAIN: Record<Network, string> = {
  bitcoin: 'bitcoin',
  ethereum: 'ethereum',
  bsc: 'bsc',
  tron: 'tron',
  polygon: 'polygon',
  base: 'base',
  erc20: 'ethereum',
  bep20: 'bsc',
  trc20: 'tron',
};

export type FiatCurrency = 'NGN' | 'GHS' | 'KES' | 'ZAR';

// =============================================================================
// INPUT TYPES
// =============================================================================

export interface PayerInput {
  chatId: string;
  phone?: string;
  walletAddress?: string;
}

export interface ReceiverInput {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  bankName?: string;
  phone?: string;
}

export interface CreatePaymentInput {
  type: PaymentType;
  fiatAmount?: number; // Required unless cryptoAmount is provided
  /** When provided (and fiatAmount is absent), triggers reverse (crypto-first) calculation. Not valid for type 'request'. */
  cryptoAmount?: number;
  fiatCurrency: FiatCurrency;
  crypto?: CryptoCurrency; // Optional for request type (provided at fulfillment)
  network?: Network; // Optional for request type (provided at fulfillment)
  payer?: PayerInput; // Optional for request type
  receiver?: ReceiverInput;
  merchantId?: string;
  merchantReference?: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
  /** Bank's own internal transaction reference (bank_confirmation type only) */
  bankRef?: string;
  /**
   * Transfer only. Controls which side bears the platform fee.
   * 'fiat'   — charge deducted from fiat payout; receiver gets fiatAmount - charge.
   * 'crypto' — charge added to crypto; receiver gets full fiatAmount.
   */
  chargeFrom?: 'fiat' | 'crypto';
  // Populated from API key at request time
  apiKeyId?: number;
  fundingWalletIndex?: number;
  parentWallet?: string; // Chain-specific parent wallet address for sweep destination
  /** Per-key confirmation threshold overrides — populated from api_keys.confirmation_thresholds */
  confirmationThresholds?: Partial<Record<string, number>>;
  /** Sandbox mode — skips real watcher and real settlement */
  isSandbox?: boolean;
}

// =============================================================================
// OUTPUT TYPES
// =============================================================================

export interface RateLock {
  rate: number;
  assetPrice: number;
  lockedAt: Date;
  expiresAt: Date;
}

/** HD wallet chain types */
export type HDChain = 'bitcoin' | 'ethereum' | 'tron';

export interface PaymentSession {
  id: string;
  reference: string;
  type: PaymentType;
  status: PaymentStatus;
  fiatAmount: number;
  fiatCurrency: FiatCurrency;
  /** USD value of the transaction at rate-lock time (netFiatAmount / rate). Persisted for analytics. */
  transactionUsd?: number;
  cryptoAmount?: number; // Optional for request type (set at fulfillment)
  crypto?: CryptoCurrency; // Optional for request type (set at fulfillment)
  network?: Network; // Optional for request type (set at fulfillment)
  rate?: number; // Optional for request type (set at fulfillment)
  assetPrice?: number; // Optional for request type (set at fulfillment)
  chargeAmount?: number; // Optional for request type (set at fulfillment)
  chargeFrom?: 'fiat' | 'crypto';
  depositAddress?: string; // Optional for request type (set at fulfillment)
  walletId?: number; // Deprecated: use derivationIndex
  derivationIndex?: number; // HD wallet derivation index
  hdChain?: HDChain; // HD wallet chain
  fundingWalletIndex?: number; // Merchant funding wallet index (for gas pre-funding)
  parentWallet?: string; // Sweep destination (from API key's parent wallet for the chain)
  payerId?: number;
  receiverId?: number;
  merchantId?: string;
  apiKeyId?: number;
  txHash?: string;
  confirmations?: number;
  receivedAmount?: number;
  /** Fiat amount paid or payable during settlement, derived from the actual received crypto. */
  settledFiatAmount?: number;
  createdAt: Date;
  expiresAt: Date;
  confirmedAt?: Date;
  settledAt?: Date;
  metadata?: Record<string, unknown>;
  /** Bank's own internal transaction reference (bank_confirmation type only) */
  bankRef?: string;
  /** True if session was created with a sandbox API key */
  isSandbox?: boolean;
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

export interface WalletAssignment {
  address: string;
  walletId: number;
  assignedAt: Date;
  expiresAt: Date;
}

export interface PaymentEngineConfig {
  sessionTtlMinutes: number;
  rateLockTtlMinutes: number;
  amountTolerance: number;
  confirmations: {
    bitcoin: number;
    ethereum: number;
    bsc: number;
    tron: number;
    polygon: number;
    base: number;
  };
}

export const DEFAULT_CONFIG: PaymentEngineConfig = {
  sessionTtlMinutes: 30,
  rateLockTtlMinutes: 30,
  amountTolerance: 0.02,
  confirmations: {
    bitcoin: 2,
    ethereum: 12,
    bsc: 15,
    tron: 19,
    polygon: 128,
    base: 12,
  },
};

export function getRequiredConfirmations(
  network: Network,
  config: PaymentEngineConfig = DEFAULT_CONFIG
): number {
  const chain = NETWORK_TO_CHAIN[network];
  const chainKey = chain as keyof typeof config.confirmations;
  return config.confirmations[chainKey] ?? 12;
}
