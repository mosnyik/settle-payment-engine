/**
 * Tron Adapter
 *
 * Uses TronGrid API for TRON blockchain data.
 * API key recommended for higher rate limits.
 *
 * API Docs: https://developers.tron.network/reference/api-overview
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { ChainAdapter, GetTransactionOptions, GetTransactionsOptions } from './chain-adapter';
import { ChainTransaction, ChainWatcherConfig, VERIFIED_TOKENS } from '../types';

// =============================================================================
// TRONGRID API TYPES
// =============================================================================

interface TronGridTxResponse {
  success: boolean;
  meta: {
    at: number;
    page_size: number;
  };
  data: TronGridTx[];
}

interface TronGridTx {
  txID: string;
  blockNumber: number;
  block_timestamp: number;
  raw_data: {
    contract: Array<{
      parameter: {
        value: {
          owner_address: string;
          to_address: string;
          amount?: number;
          contract_address?: string;
          data?: string;
        };
      };
      type: string;
    }>;
  };
  ret?: Array<{
    contractRet: string;
  }>;
}

interface TronGridTrc20Response {
  success: boolean;
  meta: {
    at: number;
    page_size: number;
  };
  data: TronGridTrc20Tx[];
}

interface TronGridTrc20Tx {
  transaction_id: string;
  block_timestamp: number;
  from: string;
  to: string;
  value: string;
  token_info: {
    symbol: string;
    address: string;
    decimals: number;
    name: string;
  };
}

interface TronGridBlockResponse {
  blockID: string;
  block_header: {
    raw_data: {
      number: number;
      timestamp: number;
    };
  };
}

interface TronGridTxInfo {
  id?: string;
  blockNumber?: number;
  blockTimeStamp?: number;
  receipt?: {
    result?: string;
  };
  log?: Array<{
    address?: string;
    topics?: string[];
    data?: string;
  }>;
}

// =============================================================================
// TRON ADAPTER
// =============================================================================

/**
 * Tron adapter using TronGrid API.
 * Supports native TRX and TRC20 token transfers.
 */
export class TronAdapter extends ChainAdapter {
  private readonly client: AxiosInstance;
  private cachedBlockNumber: number = 0;
  private blockNumberCacheTime: number = 0;
  private readonly BLOCK_CACHE_TTL_MS = 3000; // 3 seconds (Tron has ~3s blocks)

  constructor(config: ChainWatcherConfig) {
    super('tron', config);

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (config.apiKey) {
      headers['TRON-PRO-API-KEY'] = config.apiKey;
    }

    this.client = axios.create({
      baseURL: config.apiUrl || 'https://api.trongrid.io',
      timeout: 30000,
      headers,
    });
  }

  /**
   * Get recent transactions for a Tron address.
   */
  async getTransactions(
    address: string,
    options?: GetTransactionsOptions
  ): Promise<ChainTransaction[]> {
    await this.enforceRateLimit();

    const currentBlock = await this.getCurrentBlockNumber();

    try {
      if (options?.tokenAddress) {
        // TRC20 token transfers
        return this.getTrc20Transactions(
          address,
          options.tokenAddress,
          currentBlock,
          options.limit
        );
      } else {
        // Native TRX transfers
        return this.getNativeTransactions(address, currentBlock, options?.limit);
      }
    } catch (error) {
      throw this.handleApiError('getTransactions', error);
    }
  }

  /**
   * Get native TRX transactions.
   */
  private async getNativeTransactions(
    address: string,
    currentBlock: number,
    limit?: number
  ): Promise<ChainTransaction[]> {
    const response = await this.client.get<TronGridTxResponse>(
      `/v1/accounts/${address}/transactions`,
      {
        params: {
          limit: limit || 25,
          only_to: true, // Only incoming transactions
        },
      }
    );

    if (!response.data.success) {
      throw new Error('TronGrid API returned error');
    }

    return response.data.data
      .filter((tx) => this.isSuccessfulTx(tx))
      .filter((tx) => this.isTransferTx(tx))
      .map((tx) => this.mapNativeTx(tx, address, currentBlock));
  }

  /**
   * Get TRC20 token transactions.
   */
  private async getTrc20Transactions(
    address: string,
    tokenAddress: string,
    currentBlock: number,
    limit?: number
  ): Promise<ChainTransaction[]> {
    const response = await this.client.get<TronGridTrc20Response>(
      `/v1/accounts/${address}/transactions/trc20`,
      {
        params: {
          limit: limit || 25,
          contract_address: tokenAddress,
          only_to: true,
        },
      }
    );

    if (!response.data.success) {
      throw new Error('TronGrid API returned error');
    }

    return response.data.data.map((tx) =>
      this.mapTrc20Tx(tx, address, currentBlock)
    );
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
      const response = await this.client.get<TronGridTx | { Error?: string }>(
        `/wallet/gettransactionbyid`,
        {
          params: {
            value: txHash,
          },
        }
      );

      // Check if transaction exists
      if (!response.data || 'Error' in response.data || !('txID' in response.data)) {
        return null;
      }

      const tx = response.data as TronGridTx;
      await this.enforceRateLimit();

      const infoResponse = await this.client.get<TronGridTxInfo | { Error?: string }>(
        `/wallet/gettransactioninfobyid`,
        {
          params: {
            value: txHash,
          },
        }
      );

      const txInfo =
        infoResponse.data && !('Error' in infoResponse.data)
          ? infoResponse.data as TronGridTxInfo
          : null;
      const currentBlock = await this.getCurrentBlockNumber();

      if (options?.address) {
        const addressTxs = options.tokenAddress
          ? await this.getTrc20Transactions(options.address, options.tokenAddress, currentBlock, 25)
          : await this.getNativeTransactions(options.address, currentBlock, 25);
        const matchedTx = addressTxs.find((candidate) => candidate.txHash === txHash);
        if (matchedTx) return matchedTx;
        return null;
      }

      const contract = tx.raw_data.contract[0];
      const contractType = contract?.type;

      if (contractType === 'TriggerSmartContract') {
        return this.mapTrc20ConfirmedTx(tx, txInfo, currentBlock);
      }

      // Get recipient from contract data
      const toAddress = this.hexToBase58(contract?.parameter?.value?.to_address || '');

      return this.mapNativeTx(
        tx,
        toAddress,
        currentBlock,
        txInfo?.blockNumber
      );
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return null;
      }
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
      const response = await this.client.get<TronGridBlockResponse>(
        '/wallet/getnowblock'
      );

      this.cachedBlockNumber = response.data.block_header.raw_data.number;
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
   * Get verified token address for Tron.
   */
  static getTokenAddress(symbol: string): string | undefined {
    return VERIFIED_TOKENS.tron[symbol];
  }

  /**
   * Check if transaction was successful.
   */
  private isSuccessfulTx(tx: TronGridTx): boolean {
    return tx.ret?.[0]?.contractRet === 'SUCCESS';
  }

  /**
   * Check if transaction is a transfer.
   */
  private isTransferTx(tx: TronGridTx): boolean {
    const contractType = tx.raw_data.contract[0]?.type;
    return contractType === 'TransferContract';
  }

  /**
   * Map native TRX transaction to ChainTransaction.
   */
  private mapNativeTx(
    tx: TronGridTx,
    toAddress: string,
    currentBlock: number,
    confirmedBlockNumber?: number
  ): ChainTransaction {
    const contract = tx.raw_data.contract[0];
    const amountSun = contract?.parameter?.value?.amount || 0;
    const amountTrx = amountSun / 1_000_000;

    const blockNumber = confirmedBlockNumber ?? tx.blockNumber;
    const confirmations = currentBlock - blockNumber + 1;

    // Convert hex addresses to base58 for display
    const fromHex = contract?.parameter?.value?.owner_address || '';
    const fromAddress = this.hexToBase58(fromHex);

    return {
      txHash: tx.txID,
      from: fromAddress,
      to: toAddress,
      amount: amountSun.toString(),
      amountDecimal: amountTrx,
      confirmations,
      blockNumber,
      blockTime: Math.floor(tx.block_timestamp / 1000),
      isConfirmed: confirmations >= this.getRequiredConfirmations(),
      status: this.isSuccessfulTx(tx) ? 'confirmed' : 'failed',
    };
  }

  /**
   * Map a confirmed TRC20 transaction to ChainTransaction.
   */
  private mapTrc20ConfirmedTx(
    tx: TronGridTx,
    txInfo: TronGridTxInfo | null,
    currentBlock: number
  ): ChainTransaction {
    const contract = tx.raw_data.contract[0];
    const ownerAddress = this.hexToBase58(contract?.parameter?.value?.owner_address || '');
    const tokenAddress = this.hexToBase58(contract?.parameter?.value?.contract_address || '');
    const callData = this.stripHexPrefix(contract?.parameter?.value?.data || '');
    const transferLog = txInfo?.log?.find((log) => {
      if (!log.address) return false;
      return this.hexToBase58(log.address).toLowerCase() === tokenAddress.toLowerCase();
    });

    const parsedCall = this.parseTrc20TransferData(callData);
    const toAddress = transferLog?.topics?.[2]
      ? this.topicToBase58Address(transferLog.topics[2])
      : parsedCall?.toAddress || '';
    const amountRaw = transferLog?.data
      ? BigInt(`0x${this.stripHexPrefix(transferLog.data) || '0'}`)
      : parsedCall?.amountRaw ?? 0n;
    const tokenSymbol = tokenAddress === VERIFIED_TOKENS.tron.USDT ? 'USDT' : undefined;
    const tokenDecimals = tokenAddress === VERIFIED_TOKENS.tron.USDT ? 6 : undefined;
    const amountDecimal = tokenDecimals !== undefined
      ? Number(amountRaw) / Math.pow(10, tokenDecimals)
      : 0;
    const blockNumber = txInfo?.blockNumber ?? currentBlock;
    const confirmations = currentBlock - blockNumber + 1;
    const status = txInfo?.receipt?.result === 'SUCCESS' ? 'confirmed' : 'failed';

    return {
      txHash: tx.txID,
      from: ownerAddress,
      to: toAddress,
      amount: amountRaw.toString(),
      amountDecimal,
      confirmations,
      blockNumber,
      blockTime: Math.floor((txInfo?.blockTimeStamp ?? tx.block_timestamp) / 1000),
      tokenAddress,
      tokenSymbol,
      tokenDecimals,
      isConfirmed: confirmations >= this.getRequiredConfirmations(),
      status,
    };
  }

  /**
   * Map TRC20 token transaction to ChainTransaction.
   */
  private mapTrc20Tx(
    tx: TronGridTrc20Tx,
    toAddress: string,
    currentBlock: number
  ): ChainTransaction {
    const decimals = tx.token_info.decimals;
    const amountRaw = BigInt(tx.value);
    const amountDecimal = Number(amountRaw) / Math.pow(10, decimals);

    // Estimate block number from timestamp (Tron has ~3 second blocks)
    // This is approximate since TRC20 response doesn't include block number
    const blockTime = Math.floor(tx.block_timestamp / 1000);
    const estimatedBlockNumber = currentBlock; // Will be updated when checking confirmations
    const confirmations = 1; // Assume at least 1 confirmation if we can see it

    return {
      txHash: tx.transaction_id,
      from: tx.from,
      to: tx.to,
      amount: tx.value,
      amountDecimal,
      confirmations,
      blockNumber: estimatedBlockNumber,
      blockTime,
      tokenAddress: tx.token_info.address,
      tokenSymbol: tx.token_info.symbol,
      tokenDecimals: decimals,
      isConfirmed: confirmations >= this.getRequiredConfirmations(),
      status: 'confirmed',
    };
  }

  /**
   * Convert hex address to base58 format.
   * This is a simplified conversion - in production use a proper library.
   */
  private hexToBase58(hexAddress: string): string {
    // If already in base58 format (starts with T), return as-is
    if (hexAddress.startsWith('T')) {
      return hexAddress;
    }

    const normalized = this.stripHexPrefix(hexAddress).toLowerCase();
    if (!normalized) return '';

    const withPrefix = normalized.startsWith('41')
      ? normalized
      : `41${normalized.slice(-40)}`;
    const payload = Buffer.from(withPrefix, 'hex');
    const checksum = this.doubleSha256(payload).subarray(0, 4);
    const full = Buffer.concat([payload, checksum]);

    let num = BigInt(`0x${full.toString('hex')}`);
    let result = '';
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    while (num > 0n) {
      result = alphabet[Number(num % 58n)] + result;
      num /= 58n;
    }

    for (const byte of full) {
      if (byte !== 0) break;
      result = '1' + result;
    }

    return result;
  }

  private topicToBase58Address(topic: string): string {
    const normalized = this.stripHexPrefix(topic);
    return this.hexToBase58(`41${normalized.slice(-40)}`);
  }

  private parseTrc20TransferData(data: string): { toAddress: string; amountRaw: bigint } | null {
    // transfer(address,uint256)
    if (!data || data.length < 8 + 64 + 64 || !data.startsWith('a9059cbb')) {
      return null;
    }

    const toWord = data.slice(8, 72);
    const amountWord = data.slice(72, 136);

    return {
      toAddress: this.hexToBase58(`41${toWord.slice(-40)}`),
      amountRaw: BigInt(`0x${amountWord}`),
    };
  }

  private stripHexPrefix(value: string): string {
    return value.startsWith('0x') ? value.slice(2) : value;
  }

  private doubleSha256(data: Uint8Array): Buffer {
    const { createHash } = require('crypto');
    const hash1 = createHash('sha256').update(data).digest();
    return createHash('sha256').update(hash1).digest();
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

      if (status === 429) {
        return this.wrapError(operation, 'Rate limited by TronGrid API');
      }

      return this.wrapError(operation, `HTTP ${status}: ${axiosError.message}`);
    }

    return this.wrapError(operation, error);
  }
}
