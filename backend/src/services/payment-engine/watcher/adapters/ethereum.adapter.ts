/**
 * Ethereum Adapter
 *
 * Uses Etherscan API V2 for Ethereum blockchain data.
 * Requires API key (free tier: 5 calls/sec).
 *
 * API Docs: https://docs.etherscan.io/v2-migration
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { ChainAdapter, GetTransactionOptions, GetTransactionsOptions } from './chain-adapter';
import {
  ChainTransaction,
  ChainWatcherConfig,
  WatchableChain,
  VERIFIED_TOKENS,
} from '../types';

// Chain IDs for Etherscan V2 API
const CHAIN_IDS: Record<WatchableChain, number> = {
  ethereum: 1,
  bsc: 56,
  bitcoin: 0, // Not used for Etherscan
  tron: 0, // Not used for Etherscan
};

// =============================================================================
// ETHERSCAN API TYPES
// =============================================================================

interface EtherscanResponse<T> {
  status: string;
  message: string;
  result: T;
}

interface EtherscanNormalTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  blockNumber: string;
  timeStamp: string;
  isError: string;
  confirmations: string;
}

interface EtherscanTokenTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  blockNumber: string;
  timeStamp: string;
  contractAddress: string;
  tokenSymbol: string;
  tokenDecimal: string;
}

interface EtherscanInternalTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  blockNumber: string;
  timeStamp: string;
  isError: string;
}

// =============================================================================
// ETHEREUM ADAPTER
// =============================================================================

/**
 * Ethereum adapter using Etherscan API.
 * Supports native ETH and ERC20 token transfers.
 */
export class EthereumAdapter extends ChainAdapter {
  private readonly client: AxiosInstance;
  private readonly apiKey: string;
  private readonly chainId: number;
  private cachedBlockNumber: number = 0;
  private blockNumberCacheTime: number = 0;
  private readonly BLOCK_CACHE_TTL_MS = 12000; // 12 seconds (~1 block)

  constructor(config: ChainWatcherConfig, chain: WatchableChain = 'ethereum') {
    super(chain, config);

    this.apiKey = config.apiKey || '';
    this.chainId = CHAIN_IDS[chain] || 1;

    // Use V2 API endpoint
    const baseURL = config.apiUrl || 'https://api.etherscan.io/v2/api';
    this.client = axios.create({
      baseURL,
      timeout: 30000,
    });
  }

  /**
   * Get recent transactions for an address.
   * Fetches both native ETH and token transfers based on options.
   */
  async getTransactions(
    address: string,
    options?: GetTransactionsOptions
  ): Promise<ChainTransaction[]> {
    await this.enforceRateLimit();

    const currentBlock = await this.getCurrentBlockNumber();

    try {
      if (options?.tokenAddress) {
        // ERC20 token transfers
        return this.getTokenTransactions(
          address,
          options.tokenAddress,
          currentBlock,
          options.limit
        );
      } else {
        // Native ETH transfers (normal + internal)
        const [normalTxs, internalTxs] = await Promise.all([
          this.getNormalTransactions(address, currentBlock, options?.limit),
          this.getInternalTransactions(address, currentBlock, options?.limit),
        ]);

        // Mark internal transactions
        internalTxs.forEach((tx) => (tx.isInternalTx = true));

        // Merge and sort by block number descending
        return [...normalTxs, ...internalTxs].sort(
          (a, b) => (b.blockNumber || 0) - (a.blockNumber || 0)
        );
      }
    } catch (error) {
      throw this.handleApiError('getTransactions', error);
    }
  }

  /**
   * Get normal (external) ETH transactions.
   */
  private async getNormalTransactions(
    address: string,
    currentBlock: number,
    limit?: number
  ): Promise<ChainTransaction[]> {
    const response = await this.client.get<EtherscanResponse<EtherscanNormalTx[]>>('', {
      params: {
        chainid: this.chainId,
        module: 'account',
        action: 'txlist',
        address,
        startblock: 0,
        endblock: 99999999,
        page: 1,
        offset: limit || 25,
        sort: 'desc',
        apikey: this.apiKey,
      },
    });

    this.checkResponse(response.data);

    const txs = response.data.result || [];
    return txs
      .filter((tx) => tx.to.toLowerCase() === address.toLowerCase())
      .filter((tx) => tx.isError === '0')
      .map((tx) => this.mapNormalTx(tx, currentBlock));
  }

  /**
   * Get internal (contract) ETH transactions.
   */
  private async getInternalTransactions(
    address: string,
    currentBlock: number,
    limit?: number
  ): Promise<ChainTransaction[]> {
    await this.enforceRateLimit();

    const response = await this.client.get<EtherscanResponse<EtherscanInternalTx[]>>('', {
      params: {
        chainid: this.chainId,
        module: 'account',
        action: 'txlistinternal',
        address,
        startblock: 0,
        endblock: 99999999,
        page: 1,
        offset: limit || 25,
        sort: 'desc',
        apikey: this.apiKey,
      },
    });

    this.checkResponse(response.data);

    const txs = response.data.result || [];
    return txs
      .filter((tx) => tx.to.toLowerCase() === address.toLowerCase())
      .filter((tx) => tx.isError === '0')
      .map((tx) => this.mapInternalTx(tx, currentBlock));
  }

  /**
   * Get ERC20 token transactions.
   */
  protected async getTokenTransactions(
    address: string,
    tokenAddress: string,
    currentBlock: number,
    limit?: number
  ): Promise<ChainTransaction[]> {
    const response = await this.client.get<EtherscanResponse<EtherscanTokenTx[]>>('', {
      params: {
        chainid: this.chainId,
        module: 'account',
        action: 'tokentx',
        contractaddress: tokenAddress,
        address,
        page: 1,
        offset: limit || 25,
        sort: 'desc',
        apikey: this.apiKey,
      },
    });

    this.checkResponse(response.data);

    const txs = response.data.result || [];
    return txs
      .filter((tx) => tx.to.toLowerCase() === address.toLowerCase())
      .map((tx) => this.mapTokenTx(tx, currentBlock));
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
      // Get transaction receipt for status
      const receiptResponse = await this.client.get<EtherscanResponse<{
        status: string;
        blockNumber: string;
      } | null>>('', {
        params: {
          chainid: this.chainId,
          module: 'proxy',
          action: 'eth_getTransactionReceipt',
          txhash: txHash,
          apikey: this.apiKey,
        },
      });

      const receipt = receiptResponse.data.result;
      if (!receipt) return null;

      await this.enforceRateLimit();

      // Get transaction details
      const txResponse = await this.client.get<EtherscanResponse<{
        hash: string;
        from: string;
        to: string;
        value: string;
        blockNumber: string;
      } | null>>('', {
        params: {
          chainid: this.chainId,
          module: 'proxy',
          action: 'eth_getTransactionByHash',
          txhash: txHash,
          apikey: this.apiKey,
        },
      });

      const tx = txResponse.data.result;
      if (!tx) return null;

      const currentBlock = await this.getCurrentBlockNumber();

      if (options?.address) {
        const addressTxs = options.tokenAddress
          ? await this.getTokenTransactions(
              options.address,
              options.tokenAddress,
              currentBlock,
              25
            )
          : [
              ...(await this.getNormalTransactions(options.address, currentBlock, 25)),
              ...(await this.getInternalTransactions(options.address, currentBlock, 25)),
            ];

        const matchedTx = addressTxs.find(
          (candidate) => candidate.txHash.toLowerCase() === txHash.toLowerCase()
        );
        if (matchedTx) return matchedTx;
        return null;
      }

      const blockNumber = parseInt(tx.blockNumber, 16);
      const confirmations = currentBlock - blockNumber + 1;
      const amountWei = BigInt(tx.value);
      const amountEth = Number(amountWei) / 1e18;

      return {
        txHash: tx.hash,
        from: tx.from,
        to: tx.to || '',
        amount: amountWei.toString(),
        amountDecimal: amountEth,
        confirmations,
        blockNumber,
        blockTime: null,
        isConfirmed: confirmations >= this.getRequiredConfirmations(),
        status: receipt.status === '0x1' ? 'confirmed' : 'failed',
      };
    } catch (error) {
      throw this.handleApiError('getTransaction', error);
    }
  }

  /**
   * Get current block number.
   */
  async getCurrentBlockNumber(): Promise<number> {
    const now = Date.now();

    // Return cached value if fresh
    if (
      this.cachedBlockNumber > 0 &&
      now - this.blockNumberCacheTime < this.BLOCK_CACHE_TTL_MS
    ) {
      return this.cachedBlockNumber;
    }

    await this.enforceRateLimit();

    try {
      const response = await this.client.get<EtherscanResponse<string>>('', {
        params: {
          chainid: this.chainId,
          module: 'proxy',
          action: 'eth_blockNumber',
          apikey: this.apiKey,
        },
      });

      this.cachedBlockNumber = parseInt(response.data.result, 16);
      this.blockNumberCacheTime = now;
      return this.cachedBlockNumber;
    } catch (error) {
      if (this.cachedBlockNumber > 0) {
        return this.cachedBlockNumber;
      }
      throw this.handleApiError('getCurrentBlockNumber', error);
    }
  }

  /**
   * Get verified token address for a symbol.
   */
  static getTokenAddress(symbol: string, chain: WatchableChain = 'ethereum'): string | undefined {
    return VERIFIED_TOKENS[chain]?.[symbol];
  }

  /**
   * Map normal transaction to ChainTransaction.
   */
  private mapNormalTx(tx: EtherscanNormalTx, currentBlock: number): ChainTransaction {
    const blockNumber = parseInt(tx.blockNumber, 10);
    const confirmations = currentBlock - blockNumber + 1;
    const amountWei = BigInt(tx.value);
    const amountEth = Number(amountWei) / 1e18;

    return {
      txHash: tx.hash,
      from: tx.from,
      to: tx.to,
      amount: tx.value,
      amountDecimal: amountEth,
      confirmations,
      blockNumber,
      blockTime: parseInt(tx.timeStamp, 10),
      isConfirmed: confirmations >= this.getRequiredConfirmations(),
      status: tx.isError === '0' ? 'confirmed' : 'failed',
    };
  }

  /**
   * Map internal transaction to ChainTransaction.
   */
  private mapInternalTx(tx: EtherscanInternalTx, currentBlock: number): ChainTransaction {
    const blockNumber = parseInt(tx.blockNumber, 10);
    const confirmations = currentBlock - blockNumber + 1;
    const amountWei = BigInt(tx.value);
    const amountEth = Number(amountWei) / 1e18;

    return {
      txHash: tx.hash,
      from: tx.from,
      to: tx.to,
      amount: tx.value,
      amountDecimal: amountEth,
      confirmations,
      blockNumber,
      blockTime: parseInt(tx.timeStamp, 10),
      isConfirmed: confirmations >= this.getRequiredConfirmations(),
      status: tx.isError === '0' ? 'confirmed' : 'failed',
      isInternalTx: true,
    };
  }

  /**
   * Map token transaction to ChainTransaction.
   */
  private mapTokenTx(tx: EtherscanTokenTx, currentBlock: number): ChainTransaction {
    const blockNumber = parseInt(tx.blockNumber, 10);
    const confirmations = currentBlock - blockNumber + 1;
    const decimals = parseInt(tx.tokenDecimal, 10);
    const amountRaw = BigInt(tx.value);
    const amountDecimal = Number(amountRaw) / Math.pow(10, decimals);

    return {
      txHash: tx.hash,
      from: tx.from,
      to: tx.to,
      amount: tx.value,
      amountDecimal,
      confirmations,
      blockNumber,
      blockTime: parseInt(tx.timeStamp, 10),
      tokenAddress: tx.contractAddress,
      tokenSymbol: tx.tokenSymbol,
      tokenDecimals: decimals,
      isConfirmed: confirmations >= this.getRequiredConfirmations(),
      status: 'confirmed', // Token transfers don't have isError field
    };
  }

  /**
   * Check API response for errors.
   */
  private checkResponse<T>(response: EtherscanResponse<T>): void {
    if (response.status === '1' || this.isNoTransactionsResponse(response)) {
      return;
    }

    const details =
      typeof response.result === 'string' && response.result
        ? `: ${response.result}`
        : '';

    throw new Error(`${response.message || 'API error'}${details}`);
  }

  /**
   * Etherscan sometimes reports empty account/token lists as status=0 with
   * message=NOTOK and the real reason in result.
   */
  private isNoTransactionsResponse<T>(response: EtherscanResponse<T>): boolean {
    const result = typeof response.result === 'string' ? response.result : '';
    return (
      response.message === 'No transactions found' ||
      result.toLowerCase().includes('no transactions found')
    );
  }

  /**
   * Handle API errors with context.
   */
  private handleApiError(operation: string, error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;

      if (status === 429) {
        return this.wrapError(operation, 'Rate limited by Etherscan API');
      }

      return this.wrapError(operation, `HTTP ${status}: ${axiosError.message}`);
    }

    return this.wrapError(operation, error);
  }
}
