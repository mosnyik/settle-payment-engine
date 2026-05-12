/**
 * Bitcoin Adapter
 *
 * Uses Blockstream.info API (Esplora) for Bitcoin blockchain data.
 * Free, no API key required.
 *
 * API Docs: https://github.com/Blockstream/esplora/blob/master/API.md
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { ChainAdapter, GetTransactionOptions, GetTransactionsOptions } from './chain-adapter';
import { ChainTransaction, ChainWatcherConfig } from '../types';

// =============================================================================
// BLOCKSTREAM API TYPES
// =============================================================================

interface BlockstreamVin {
  txid: string;
  vout: number;
  prevout?: {
    scriptpubkey_address?: string;
    value?: number;
  };
  sequence: number;
}

interface BlockstreamVout {
  scriptpubkey_address?: string;
  value: number;
}

interface BlockstreamTx {
  txid: string;
  vin: BlockstreamVin[];
  vout: BlockstreamVout[];
  status: {
    confirmed: boolean;
    block_height?: number;
    block_time?: number;
  };
}

// =============================================================================
// BITCOIN ADAPTER
// =============================================================================

/**
 * Bitcoin adapter using Blockstream.info API.
 * Supports native BTC transactions only (no tokens on Bitcoin).
 */
export class BitcoinAdapter extends ChainAdapter {
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;
  private cachedBlockHeight: number = 0;
  private blockHeightCacheTime: number = 0;
  private readonly BLOCK_CACHE_TTL_MS = 30000; // 30 seconds

  constructor(config: ChainWatcherConfig) {
    super('bitcoin', config);

    this.baseUrl = config.apiUrl || 'https://blockstream.info/api';
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        Accept: 'application/json',
      },
    });
  }

  /**
   * Get recent transactions for a Bitcoin address.
   */
  async getTransactions(
    address: string,
    options?: GetTransactionsOptions
  ): Promise<ChainTransaction[]> {
    await this.enforceRateLimit();

    try {
      const response = await this.client.get<BlockstreamTx[]>(
        `/address/${address}/txs`
      );
      const txs = response.data;

      const limit = options?.limit || 25;
      const currentBlock = await this.getCurrentBlockNumber();

      // Filter to transactions that send TO this address
      return txs
        .slice(0, limit)
        .filter((tx) => this.hasOutputToAddress(tx, address))
        .map((tx) => this.mapTransaction(tx, address, currentBlock));
    } catch (error) {
      throw this.handleApiError('getTransactions', error);
    }
  }

  /**
   * Get a specific transaction by hash.
   */
  async getTransaction(
    txHash: string,
    options?: GetTransactionOptions
  ): Promise<ChainTransaction | null> {
    await this.enforceRateLimit();

    try {
      const response = await this.client.get<BlockstreamTx>(`/tx/${txHash}`);
      const tx = response.data;
      const currentBlock = await this.getCurrentBlockNumber();

      const toAddress =
        options?.address ||
        tx.vout.find((o) => o.scriptpubkey_address)?.scriptpubkey_address ||
        '';

      const mapped = this.mapTransaction(tx, toAddress, currentBlock);
      if (options?.address && mapped.amountDecimal <= 0) {
        return null;
      }

      return mapped;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return null;
      }
      throw this.handleApiError('getTransaction', error);
    }
  }

  /**
   * Get current block height.
   * Cached for 30 seconds to reduce API calls.
   */
  async getCurrentBlockNumber(): Promise<number> {
    const now = Date.now();

    // Return cached value if fresh
    if (
      this.cachedBlockHeight > 0 &&
      now - this.blockHeightCacheTime < this.BLOCK_CACHE_TTL_MS
    ) {
      return this.cachedBlockHeight;
    }

    await this.enforceRateLimit();

    try {
      const response = await this.client.get<string>('/blocks/tip/height');
      this.cachedBlockHeight = parseInt(response.data, 10);
      this.blockHeightCacheTime = now;
      return this.cachedBlockHeight;
    } catch (error) {
      // If we have a cached value, return it on error
      if (this.cachedBlockHeight > 0) {
        return this.cachedBlockHeight;
      }
      throw this.handleApiError('getCurrentBlockNumber', error);
    }
  }

  /**
   * Check if transaction has an output to the given address.
   */
  private hasOutputToAddress(tx: BlockstreamTx, address: string): boolean {
    const lowerAddress = address.toLowerCase();
    return tx.vout.some(
      (o) => o.scriptpubkey_address?.toLowerCase() === lowerAddress
    );
  }

  /**
   * Map Blockstream transaction to ChainTransaction.
   */
  private mapTransaction(
    tx: BlockstreamTx,
    toAddress: string,
    currentBlock: number
  ): ChainTransaction {
    const lowerAddress = toAddress.toLowerCase();

    // Sum all outputs to our address
    const amountSatoshis = tx.vout
      .filter((o) => o.scriptpubkey_address?.toLowerCase() === lowerAddress)
      .reduce((sum, o) => sum + o.value, 0);

    const amountBtc = amountSatoshis / 100_000_000;

    // Calculate confirmations
    const confirmations = tx.status.confirmed
      ? currentBlock - (tx.status.block_height || 0) + 1
      : 0;

    // Check for RBF (Replace-by-Fee)
    // A transaction is RBF-enabled if any input has sequence < 0xFFFFFFFE
    const isRbfEnabled = tx.vin.some((vin) => vin.sequence < 0xfffffffe);

    // Get sender address from first input
    const fromAddress = tx.vin[0]?.prevout?.scriptpubkey_address || 'unknown';

    return {
      txHash: tx.txid,
      from: fromAddress,
      to: toAddress,
      amount: amountSatoshis.toString(),
      amountDecimal: amountBtc,
      confirmations,
      blockNumber: tx.status.block_height || null,
      blockTime: tx.status.block_time || null,
      isConfirmed: confirmations >= this.getRequiredConfirmations(),
      status: tx.status.confirmed ? 'confirmed' : 'pending',
      isRbfEnabled,
    };
  }

  /**
   * Check if error is a 404 Not Found.
   */
  private isNotFoundError(error: unknown): boolean {
    return (
      axios.isAxiosError(error) &&
      (error as AxiosError).response?.status === 404
    );
  }

  /**
   * Handle API errors with context.
   */
  private handleApiError(operation: string, error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const message = axiosError.message;

      if (status === 429) {
        return this.wrapError(operation, 'Rate limited by Blockstream API');
      }

      return this.wrapError(operation, `HTTP ${status}: ${message}`);
    }

    return this.wrapError(operation, error);
  }
}
