/**
 * Sweeper Service
 *
 * Orchestrates fund sweeping from derived addresses to hot wallets.
 * Triggered after deposit confirmation.
 */

import { getHDWalletService } from '../hd-wallet';
import { HDChain } from '../hd-wallet/types';
import { Network, CryptoCurrency } from '../types';
import {
  SweepRequest,
  SweepResult,
  SweepRecord,
  SweepStatus,
  SweeperConfig,
  ChainSweeper,
  SWEEP_TOKEN_CONTRACTS,
} from './types';
import {
  BitcoinSweeper,
  EVMSweeper,
  EVMTokenSweeper,
  TronSweeper,
  createEthereumSweeper,
  createBscSweeper,
  createEthereumTokenSweeper,
  createBscTokenSweeper,
  createTronSweeper,
} from './chains';

// =============================================================================
// ERROR CLASSES
// =============================================================================

export class SweeperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SweeperError';
  }
}

export class SweeperNotInitializedError extends SweeperError {
  constructor() {
    super('Sweeper not initialized. Check SWEEPER_ENABLED and configuration.');
  }
}

// =============================================================================
// SERVICE
// =============================================================================

export class SweeperService {
  private config: SweeperConfig;
  private sweepers: Map<string, ChainSweeper> = new Map();
  private isInitialized: boolean = false;

  constructor(config: SweeperConfig) {
    this.config = config;
  }

  /**
   * Initialize the sweeper service.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn('[Sweeper] Already initialized');
      return;
    }

    // Initialize chain sweepers
    if (this.config.rpc.ethereum) {
      this.sweepers.set('ethereum', createEthereumSweeper(this.config.rpc.ethereum));
      this.sweepers.set('ethereum-token', createEthereumTokenSweeper(this.config.rpc.ethereum));
    }

    if (this.config.rpc.bsc) {
      this.sweepers.set('bsc', createBscSweeper(this.config.rpc.bsc));
      this.sweepers.set('bsc-token', createBscTokenSweeper(this.config.rpc.bsc));
    }

    this.sweepers.set('bitcoin', new BitcoinSweeper());
    this.sweepers.set('tron', createTronSweeper('https://api.trongrid.io'));

    this.isInitialized = true;
    console.log('[Sweeper] Initialized with chains:', Array.from(this.sweepers.keys()).join(', '));
  }

  /**
   * Sweep funds from a derived address to hot wallet.
   *
   * @param request - Sweep request from watcher
   * @returns Sweep result
   */
  async sweep(request: SweepRequest): Promise<SweepResult> {
    this.ensureInitialized();

    const hdWallet = getHDWalletService();
    if (!hdWallet?.isEnabled()) {
      return {
        success: false,
        error: 'HD Wallet not enabled',
      };
    }

    // Get private key for signing
    const privateKey = hdWallet.getPrivateKey(request.chain, request.derivationIndex);
    const toAddress = hdWallet.getHotWalletAddress(request.chain);

    // Check minimum threshold
    if (!this.meetsThreshold(request.amount, request.cryptoCurrency)) {
      console.log(`[Sweeper] Amount ${request.amount} ${request.cryptoCurrency} below threshold, skipping`);
      return {
        success: false,
        error: 'Below minimum sweep threshold',
      };
    }

    // Record sweep attempt
    const sweepId = await this.createSweepRecord(request, toAddress);

    // Get appropriate sweeper
    const sweeper = this.getSweeper(request.chain, request.network, request.cryptoCurrency);
    if (!sweeper) {
      await this.updateSweepRecord(sweepId, {
        success: false,
        error: `No sweeper for ${request.chain}/${request.network}`,
      });
      return {
        success: false,
        error: `No sweeper available for ${request.chain}/${request.network}`,
      };
    }

    // Get token contract if needed
    const tokenContract = this.getTokenContract(request.network, request.cryptoCurrency);

    // Execute sweep
    const result = await sweeper.sweep({
      fromAddress: request.fromAddress,
      toAddress,
      amount: request.amount,
      privateKey,
      tokenContract,
    });

    // Update record
    await this.updateSweepRecord(sweepId, result);

    // Mark address as swept if successful
    if (result.success && result.txHash) {
      await hdWallet.markAddressSwept(request.fromAddress, result.txHash);
    }

    return result;
  }

  /**
   * Retry a failed sweep.
   *
   * @param sweepId - Sweep record ID
   * @returns Sweep result
   */
  async retrySweep(sweepId: number): Promise<SweepResult> {
    const record = await this.getSweepRecord(sweepId);
    if (!record) {
      return {
        success: false,
        error: 'Sweep record not found',
      };
    }

    if (record.status === 'confirmed') {
      return {
        success: false,
        error: 'Sweep already confirmed',
      };
    }

    if (record.retryCount >= this.config.maxRetries) {
      return {
        success: false,
        error: `Max retries (${this.config.maxRetries}) exceeded`,
      };
    }

    // Increment retry count
    await this.incrementRetryCount(sweepId);

    // Get HD wallet info
    const hdWallet = getHDWalletService();
    if (!hdWallet?.isEnabled()) {
      return {
        success: false,
        error: 'HD Wallet not enabled',
      };
    }

    // Get address info to find derivation index
    const addressInfo = await hdWallet.getAddressInfo(record.fromAddress);
    if (!addressInfo) {
      return {
        success: false,
        error: 'Address not found in derived addresses',
      };
    }

    // Get private key
    const privateKey = hdWallet.getPrivateKey(record.chain, addressInfo.derivationIndex);

    // Get sweeper
    const sweeper = this.getSweeper(record.chain, record.network as Network, this.getCryptoFromAsset(record));
    if (!sweeper) {
      return {
        success: false,
        error: `No sweeper for ${record.chain}/${record.network}`,
      };
    }

    // Execute sweep
    const result = await sweeper.sweep({
      fromAddress: record.fromAddress,
      toAddress: record.toAddress,
      amount: record.amountDecimal.toString(),
      privateKey,
      tokenContract: record.tokenContract || undefined,
    });

    // Update record
    await this.updateSweepRecord(sweepId, result);

    return result;
  }

  /**
   * Get sweep records by status.
   */
  async getSweepsByStatus(status: SweepStatus, limit: number = 100): Promise<SweepRecord[]> {
    const pool = (await import('../../../lib/mysql')).default;

    const [rows] = await pool.query(
      `SELECT * FROM sweep_transactions WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
      [status, limit]
    ) as [any[], any];

    return (rows || []).map(this.rowToSweepRecord);
  }

  /**
   * Get failed sweeps that can be retried.
   */
  async getRetryableSweeps(): Promise<SweepRecord[]> {
    const pool = (await import('../../../lib/mysql')).default;

    const [rows] = await pool.query(
      `SELECT * FROM sweep_transactions
       WHERE status = 'failed'
         AND retry_count < ?
       ORDER BY created_at ASC
       LIMIT 100`,
      [this.config.maxRetries]
    ) as [any[], any];

    return (rows || []).map(this.rowToSweepRecord);
  }

  /**
   * Check if service is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled && this.isInitialized;
  }

  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new SweeperNotInitializedError();
    }
  }

  /**
   * Get the appropriate sweeper for the chain/network/crypto combination.
   */
  private getSweeper(chain: HDChain, network: Network, crypto: CryptoCurrency): ChainSweeper | null {
    // Bitcoin
    if (chain === 'bitcoin') {
      return this.sweepers.get('bitcoin') || null;
    }

    // Tron
    if (chain === 'tron') {
      return this.sweepers.get('tron') || null;
    }

    // EVM chains
    if (chain === 'ethereum') {
      // Check if it's a token
      if (crypto === 'USDT' || crypto === 'USDC' || network === 'erc20' || network === 'bep20') {
        if (network === 'bsc' || network === 'bep20') {
          return this.sweepers.get('bsc-token') || null;
        }
        return this.sweepers.get('ethereum-token') || null;
      }

      // Native asset
      if (network === 'bsc') {
        return this.sweepers.get('bsc') || null;
      }
      return this.sweepers.get('ethereum') || null;
    }

    return null;
  }

  /**
   * Get token contract address for a network/crypto combination.
   */
  private getTokenContract(network: Network, crypto: CryptoCurrency): string | undefined {
    const contracts = SWEEP_TOKEN_CONTRACTS[network];
    return contracts?.[crypto];
  }

  /**
   * Check if amount meets minimum threshold.
   */
  private meetsThreshold(amount: string, crypto: CryptoCurrency): boolean {
    const amountNum = parseFloat(amount);
    const threshold = this.config.thresholds[crypto as keyof typeof this.config.thresholds];

    if (threshold === undefined) {
      return true; // No threshold configured, allow sweep
    }

    return amountNum >= threshold;
  }

  /**
   * Create sweep record in database.
   */
  private async createSweepRecord(request: SweepRequest, toAddress: string): Promise<number> {
    const pool = (await import('../../../lib/mysql')).default;

    const isToken = request.tokenContract !== undefined;

    const [result] = await pool.query(
      `INSERT INTO sweep_transactions
       (session_id, chain, network, from_address, to_address, asset_type, token_contract, amount_raw, amount_decimal, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        request.sessionId,
        request.chain,
        request.network,
        request.fromAddress,
        toAddress,
        isToken ? 'token' : 'native',
        request.tokenContract || null,
        request.amount,
        parseFloat(request.amount),
      ]
    ) as [any, any];

    return result.insertId;
  }

  /**
   * Update sweep record with result.
   */
  private async updateSweepRecord(sweepId: number, result: SweepResult): Promise<void> {
    const pool = (await import('../../../lib/mysql')).default;

    const status: SweepStatus = result.success ? 'submitted' : 'failed';

    await pool.query(
      `UPDATE sweep_transactions
       SET status = ?,
           tx_hash = ?,
           error_message = ?,
           gas_used = ?,
           gas_price = ?,
           submitted_at = ?
       WHERE id = ?`,
      [
        status,
        result.txHash || null,
        result.error || null,
        result.gasUsed || null,
        result.gasPrice || null,
        result.success ? new Date() : null,
        sweepId,
      ]
    );
  }

  /**
   * Get sweep record by ID.
   */
  private async getSweepRecord(sweepId: number): Promise<SweepRecord | null> {
    const pool = (await import('../../../lib/mysql')).default;

    const [rows] = await pool.query(
      `SELECT * FROM sweep_transactions WHERE id = ?`,
      [sweepId]
    ) as [any[], any];

    if (!rows || rows.length === 0) {
      return null;
    }

    return this.rowToSweepRecord(rows[0]);
  }

  /**
   * Increment retry count for a sweep.
   */
  private async incrementRetryCount(sweepId: number): Promise<void> {
    const pool = (await import('../../../lib/mysql')).default;

    await pool.query(
      `UPDATE sweep_transactions SET retry_count = retry_count + 1 WHERE id = ?`,
      [sweepId]
    );
  }

  /**
   * Convert database row to SweepRecord.
   */
  private rowToSweepRecord(row: any): SweepRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      chain: row.chain as HDChain,
      network: row.network,
      fromAddress: row.from_address,
      toAddress: row.to_address,
      assetType: row.asset_type,
      tokenContract: row.token_contract,
      amountRaw: row.amount_raw,
      amountDecimal: Number(row.amount_decimal),
      txHash: row.tx_hash,
      status: row.status as SweepStatus,
      errorMessage: row.error_message,
      retryCount: row.retry_count,
      gasUsed: row.gas_used,
      gasPrice: row.gas_price,
      createdAt: new Date(row.created_at),
      submittedAt: row.submitted_at ? new Date(row.submitted_at) : null,
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null,
    };
  }

  /**
   * Get crypto currency from sweep record.
   */
  private getCryptoFromAsset(record: SweepRecord): CryptoCurrency {
    if (record.assetType === 'token') {
      // Infer from token contract
      if (record.tokenContract?.toLowerCase().includes('usdt') ||
          record.tokenContract === '0xdAC17F958D2ee523a2206206994597C13D831ec7' ||
          record.tokenContract === '0x55d398326f99059fF775485246999027B3197955' ||
          record.tokenContract === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t') {
        return 'USDT';
      }
      return 'USDT'; // Default for unknown tokens
    }

    // Native assets
    switch (record.chain) {
      case 'bitcoin':
        return 'BTC';
      case 'ethereum':
        return record.network === 'bsc' ? 'BNB' : 'ETH';
      case 'tron':
        return 'TRX';
      default:
        return 'ETH';
    }
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let sweeperInstance: SweeperService | null = null;

/**
 * Get the sweeper service instance.
 */
export function getSweeperService(): SweeperService | null {
  return sweeperInstance;
}

/**
 * Create and initialize the sweeper service.
 */
export async function createSweeperService(config: SweeperConfig): Promise<SweeperService> {
  if (sweeperInstance) {
    return sweeperInstance;
  }

  sweeperInstance = new SweeperService(config);
  await sweeperInstance.initialize();

  return sweeperInstance;
}

/**
 * Destroy the sweeper service instance.
 */
export function destroySweeperService(): void {
  sweeperInstance = null;
}
