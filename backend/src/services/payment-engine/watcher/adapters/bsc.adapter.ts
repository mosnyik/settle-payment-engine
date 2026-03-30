/**
 * BSC (Binance Smart Chain) Adapter
 *
 * Uses BscScan API which has the same interface as Etherscan.
 * Requires API key (free tier available).
 *
 * API Docs: https://docs.bscscan.com/
 */

import { EthereumAdapter } from './ethereum.adapter';
import { ChainWatcherConfig, REQUIRED_CONFIRMATIONS } from '../types';

/**
 * BSC adapter using BscScan API.
 * Extends EthereumAdapter since BscScan uses the same API format.
 */
export class BscAdapter extends EthereumAdapter {
  constructor(config: ChainWatcherConfig) {
    // Use BSC-specific defaults
    const bscConfig: ChainWatcherConfig = {
      ...config,
      apiUrl: config.apiUrl || "https://api.etherscan.io/v2/api",
    };

    super(bscConfig, 'bsc');
  }

  /**
   * Override to return BSC confirmation requirements.
   */
  getRequiredConfirmations(): number {
    return REQUIRED_CONFIRMATIONS.bsc;
  }

  /**
   * Get verified token address for BSC.
   */
  static getTokenAddress(symbol: string): string | undefined {
    return EthereumAdapter.getTokenAddress(symbol, 'bsc');
  }
}
