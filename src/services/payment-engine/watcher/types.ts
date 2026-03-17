/**
 * Deposit Watcher Types
 *
 * Type definitions for the blockchain deposit monitoring system.
 */

import { Network, CryptoCurrency, HDChain } from '../types';

// =============================================================================
// CHAIN TYPES
// =============================================================================

/** Chains that have watcher implementations */
export type WatchableChain = 'bitcoin' | 'ethereum' | 'bsc' | 'tron';

/** Map network to its watchable chain */
export const NETWORK_TO_WATCHABLE_CHAIN: Record<Network, WatchableChain> = {
  bitcoin: 'bitcoin',
  ethereum: 'ethereum',
  bsc: 'bsc',
  tron: 'tron',
  polygon: 'ethereum', // Uses Ethereum adapter (future: separate Polygonscan)
  base: 'ethereum', // Uses Ethereum adapter (future: separate Basescan)
  erc20: 'ethereum',
  bep20: 'bsc',
  trc20: 'tron',
};

/** Required confirmations per chain */
export const REQUIRED_CONFIRMATIONS: Record<WatchableChain, number> = {
  bitcoin: 2,
  ethereum: 12,
  bsc: 15,
  tron: 19,
};

/** Dust thresholds per chain (amounts below are ignored) */
export const DUST_THRESHOLDS: Record<WatchableChain, number> = {
  bitcoin: 0.00001, // 1000 satoshis
  ethereum: 0.0001, // ~$0.30
  bsc: 0.0001,
  tron: 0.1, // TRX
};

/** Verified token contract addresses (protect against fake tokens) */
export const VERIFIED_TOKENS: Record<
  WatchableChain,
  Record<string, string>
> = {
  bitcoin: {}, // No tokens on Bitcoin
  ethereum: {
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  bsc: {
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  },
  tron: {
    USDT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  },
};

// =============================================================================
// TRANSACTION TYPES
// =============================================================================

/** Transaction status from blockchain */
export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

/** Transaction data from blockchain explorer */
export interface ChainTransaction {
  txHash: string;
  from: string;
  to: string;
  /** Amount in smallest unit (satoshis, wei, sun) */
  amount: string;
  /** Amount converted to decimal (BTC, ETH, etc.) */
  amountDecimal: number;
  confirmations: number;
  blockNumber: number | null;
  blockTime: number | null;
  /** For token transfers */
  tokenAddress?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  /** Has required confirmations */
  isConfirmed: boolean;
  status: TransactionStatus;
  // Security fields
  /** Bitcoin: can be replaced before confirmation (sequence < 0xFFFFFFFE) */
  isRbfEnabled?: boolean;
  /** If TX was replaced via RBF, the new TX hash */
  replacedByTxHash?: string;
  /** EVM: came from internal/contract call */
  isInternalTx?: boolean;
}

/** Amount match result */
export type AmountMatchResult =
  | 'exact'
  | 'within_tolerance'
  | 'underpaid'
  | 'overpaid';

// =============================================================================
// SESSION TYPES
// =============================================================================

/** Session being watched for deposits */
export interface WatchedSession {
  id: string;
  depositAddress: string;
  network: Network;
  chain: WatchableChain;
  cryptoCurrency: CryptoCurrency;
  expectedAmount: number;
  walletId?: number; // Deprecated: use derivationIndex
  derivationIndex?: number; // HD wallet derivation index
  hdChain?: HDChain; // HD wallet chain (for sweeper)
  fundingWalletIndex?: number; // For gas pre-funding on token sweeps
  toAddress?: string; // Sweep destination — falls back to hot wallet if absent
  status: 'pending' | 'confirming';
  txHash?: string;
  expiresAt: Date;
}

/** HDWaaS wallet being watched for deposits */
export interface WatchedHDWallet {
  id: string; // Wallet ID (wal_xxx)
  apiKeyId: number;
  depositAddress: string;
  network: string;
  chain: WatchableChain;
  cryptoCurrency: string;
  derivationIndex: number;
  hdChain: string;
  status: 'watching' | 'confirming';
  txHash?: string;
  amount?: number;
  expiresAt?: Date;
  sweepAddress?: string | null;
}

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

/** Configuration for a specific chain's watcher */
export interface ChainWatcherConfig {
  enabled: boolean;
  pollingIntervalMs: number;
  apiKey?: string;
  apiUrl?: string;
  /** Minimum delay between API calls (rate limit protection) */
  rateLimitMs?: number;
}

/** Overall watcher configuration */
export interface WatcherConfig {
  enabled: boolean;
  /** Amount tolerance for matching deposits (0.02 = 2%) */
  amountTolerance: number;
  /** Max sessions to check per poll cycle */
  maxSessionsPerPoll: number;
  chains: {
    bitcoin: ChainWatcherConfig;
    ethereum: ChainWatcherConfig;
    bsc: ChainWatcherConfig;
    tron: ChainWatcherConfig;
  };
}

// =============================================================================
// STATE TYPES
// =============================================================================

/** Processed transaction record (for deduplication) */
export interface ProcessedTransaction {
  txHash: string;
  sessionId: string;
  chain: WatchableChain;
  action: 'mark_deposit' | 'confirm_deposit';
  confirmations?: number;
  processedAt: Date;
}

// =============================================================================
// EVENT TYPES
// =============================================================================

/** Watcher event types for monitoring and logging */
export type WatcherEventType =
  // Lifecycle events
  | 'watcher_started'
  | 'watcher_stopped'
  | 'poll_started'
  | 'poll_completed'
  // Deposit events
  | 'deposit_detected'
  | 'deposit_confirmed'
  | 'session_expired'
  // Error events
  | 'api_error'
  | 'validation_error'
  // Security/fraud events
  | 'reorg_detected'
  | 'rbf_replacement'
  | 'fake_token_attempt'
  | 'dust_deposit_ignored'
  | 'underpaid_deposit'
  | 'tx_disappeared'
  | 'high_value_manual_review';

/** Watcher event data */
export interface WatcherEvent {
  type: WatcherEventType;
  chain?: WatchableChain;
  sessionId?: string;
  txHash?: string;
  details?: Record<string, unknown>;
  timestamp: Date;
}

// =============================================================================
// VALIDATION TYPES
// =============================================================================

/** Result of validating a transaction */
export interface TransactionValidationResult {
  valid: boolean;
  reason?:
    | 'zero_confirmation'
    | 'dust_amount'
    | 'unverified_token_contract'
    | 'rbf_insufficient_confirmations'
    | 'underpaid'
    | 'overpaid'
    | 'expired_session';
}

/** Result of checking a deposit */
export interface DepositCheckResult {
  sessionId: string;
  found: boolean;
  transaction?: ChainTransaction;
  amountMatch?: AmountMatchResult;
  validation?: TransactionValidationResult;
  error?: string;
}
