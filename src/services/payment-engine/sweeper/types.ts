/**
 * Sweeper Types
 *
 * Type definitions for the fund sweeper service.
 */

import { HDChain } from '../hd-wallet/types';
import { Network, CryptoCurrency } from '../types';

// =============================================================================
// SWEEP TYPES
// =============================================================================

/** Sweep request from watcher */
export interface SweepRequest {
  sessionId: string;
  chain: HDChain;
  network: Network;
  fromAddress: string;
  derivationIndex: number;
  amount: string;
  cryptoCurrency: CryptoCurrency;
  tokenContract?: string;
  /** Sweep destination — parent wallet (payment) or developer wallet (HDWaaS). Falls back to hot wallet. */
  toAddress?: string;
  /** Merchant funding wallet index — used to derive private key for gas pre-funding. */
  fundingWalletIndex?: number;
}

/** Result of a sweep operation */
export interface SweepResult {
  success: boolean;
  txHash?: string;
  gasUsed?: string;
  gasPrice?: string;
  error?: string;
}

/** Sweep status in database */
export type SweepStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

/** Sweep record from database */
export interface SweepRecord {
  id: number;
  sessionId: string;
  chain: HDChain;
  network: string;
  fromAddress: string;
  toAddress: string;
  assetType: 'native' | 'token';
  tokenContract: string | null;
  amountRaw: string;
  amountDecimal: number;
  txHash: string | null;
  status: SweepStatus;
  errorMessage: string | null;
  retryCount: number;
  gasUsed: string | null;
  gasPrice: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  confirmedAt: Date | null;
}

// =============================================================================
// CHAIN SWEEPER INTERFACE
// =============================================================================

/** Parameters for chain-specific sweep */
export interface ChainSweepParams {
  fromAddress: string;
  toAddress: string;
  amount: string;
  privateKey: string;
  tokenContract?: string;
}

/** Chain-specific sweeper interface */
export interface ChainSweeper {
  /** Sweep funds from address to hot wallet */
  sweep(params: ChainSweepParams): Promise<SweepResult>;

  /** Estimate gas/fee for sweep */
  estimateFee(params: ChainSweepParams): Promise<string>;

  /** Check if sweep is economical (amount > fees) */
  isEconomical(amount: string, estimatedFee: string): boolean;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Minimum sweep thresholds per asset */
export interface SweepThresholds {
  BTC: number;
  ETH: number;
  BNB: number;
  TRX: number;
  USDT: number;
  USDC: number;
}

/** RPC endpoints for chains */
export interface RPCEndpoints {
  ethereum: string;
  bsc: string;
  polygon?: string;
  base?: string;
}

/** Sweeper service configuration */
export interface SweeperConfig {
  enabled: boolean;
  maxRetries: number;
  hotWallets: {
    bitcoin: string;
    ethereum: string;
    tron: string;
  };
  rpc: RPCEndpoints;
  thresholds: SweepThresholds;
}

// =============================================================================
// TOKEN CONTRACTS
// =============================================================================

/** Verified token contracts for sweeping */
export const SWEEP_TOKEN_CONTRACTS: Record<Network, Record<string, string>> = {
  ethereum: {
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  erc20: {
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  bsc: {
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  },
  bep20: {
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  },
  tron: {
    USDT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  },
  trc20: {
    USDT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  },
  bitcoin: {},
  polygon: {},
  base: {},
};

/** Token decimals */
export const TOKEN_DECIMALS: Record<string, number> = {
  // Ethereum mainnet USDT has 6 decimals
  '0xdAC17F958D2ee523a2206206994597C13D831ec7': 6,
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 6,
  // BSC USDT/USDC have 18 decimals
  '0x55d398326f99059fF775485246999027B3197955': 18,
  '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d': 18,
  // Tron USDT has 6 decimals
  'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t': 6,
};
