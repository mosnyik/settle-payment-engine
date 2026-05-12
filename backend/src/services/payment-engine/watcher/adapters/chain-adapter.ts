/**
 * Chain Adapter Base Class
 *
 * Abstract base class that all blockchain adapters must implement.
 * Provides common functionality like rate limiting.
 */

import {
  ChainTransaction,
  WatchableChain,
  ChainWatcherConfig,
  REQUIRED_CONFIRMATIONS,
} from '../types';

/**
 * Options for fetching transactions
 */
export interface GetTransactionsOptions {
  /** Token contract address (for ERC20/BEP20/TRC20) */
  tokenAddress?: string;
  /** Maximum number of transactions to return */
  limit?: number;
}

/**
 * Options for fetching a specific transaction.
 */
export interface GetTransactionOptions {
  /** Expected recipient/deposit address. Used to disambiguate multi-output/internal txs. */
  address?: string;
  /** Token contract address (for ERC20/BEP20/TRC20) */
  tokenAddress?: string;
}

/**
 * Abstract base class for blockchain adapters.
 * Each chain implements this to provide a unified interface for the watcher.
 */
export abstract class ChainAdapter {
  protected readonly chain: WatchableChain;
  protected readonly config: ChainWatcherConfig;
  protected lastCallTime: number = 0;

  constructor(chain: WatchableChain, config: ChainWatcherConfig) {
    this.chain = chain;
    this.config = config;
  }

  /**
   * Rate limit enforcement.
   * Ensures minimum delay between API calls.
   */
  protected async enforceRateLimit(): Promise<void> {
    if (!this.config.rateLimitMs) return;

    const elapsed = Date.now() - this.lastCallTime;
    const remaining = this.config.rateLimitMs - elapsed;

    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }

    this.lastCallTime = Date.now();
  }

  /**
   * Get recent transactions for an address.
   * Should return newest first.
   */
  abstract getTransactions(
    address: string,
    options?: GetTransactionsOptions
  ): Promise<ChainTransaction[]>;

  /**
   * Get a specific transaction by hash.
   * Used for confirmation tracking.
   */
  abstract getTransaction(
    txHash: string,
    options?: GetTransactionOptions
  ): Promise<ChainTransaction | null>;

  /**
   * Get current block number.
   * Used for calculating confirmations.
   */
  abstract getCurrentBlockNumber(): Promise<number>;

  /**
   * Get the chain this adapter handles.
   */
  getChain(): WatchableChain {
    return this.chain;
  }

  /**
   * Check if the adapter is properly configured.
   */
  isConfigured(): boolean {
    return this.config.enabled;
  }

  /**
   * Get required confirmations for this chain.
   */
  getRequiredConfirmations(): number {
    return REQUIRED_CONFIRMATIONS[this.chain];
  }

  /**
   * Wrap errors with context.
   */
  protected wrapError(operation: string, error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(`${this.constructor.name}.${operation}: ${message}`);
  }
}
