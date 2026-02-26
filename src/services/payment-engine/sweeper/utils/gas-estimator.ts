/**
 * Gas Estimator Utilities
 *
 * Helper functions for estimating transaction fees across chains.
 */

import axios from 'axios';

// =============================================================================
// BITCOIN
// =============================================================================

interface BitcoinFeeEstimate {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

/**
 * Get Bitcoin fee estimates from mempool.space API.
 */
export async function getBitcoinFeeRate(): Promise<BitcoinFeeEstimate> {
  try {
    const response = await axios.get<BitcoinFeeEstimate>(
      'https://mempool.space/api/v1/fees/recommended'
    );
    return response.data;
  } catch {
    // Fallback to reasonable defaults
    return {
      fastestFee: 20,
      halfHourFee: 15,
      hourFee: 10,
      economyFee: 5,
      minimumFee: 1,
    };
  }
}

/**
 * Estimate Bitcoin transaction size for sweep.
 *
 * @param inputCount - Number of UTXOs to spend
 * @param outputCount - Number of outputs (usually 1 for sweep)
 * @returns Estimated vbytes
 */
export function estimateBitcoinTxSize(inputCount: number, outputCount: number = 1): number {
  // P2WPKH (native segwit) transaction sizes
  const overhead = 10.5; // version (4) + marker (0.25) + flag (0.25) + locktime (4) + input count (1) + output count (1)
  const inputSize = 68; // outpoint (36) + scriptSig (1) + sequence (4) + witness (27)
  const outputSize = 31; // value (8) + scriptPubKey (23)

  return Math.ceil(overhead + inputCount * inputSize + outputCount * outputSize);
}

// =============================================================================
// EVM
// =============================================================================

/**
 * Get current gas price from Etherscan API.
 */
export async function getEthereumGasPrice(apiKey: string): Promise<{
  low: number;
  average: number;
  high: number;
}> {
  try {
    const response = await axios.get(
      `https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${apiKey}`
    );

    if (response.data.status === '1') {
      const result = response.data.result;
      return {
        low: parseInt(result.SafeGasPrice),
        average: parseInt(result.ProposeGasPrice),
        high: parseInt(result.FastGasPrice),
      };
    }
  } catch {
    // Ignore errors
  }

  // Fallback defaults
  return {
    low: 20,
    average: 30,
    high: 50,
  };
}

/**
 * Get BSC gas price (typically much lower than Ethereum).
 */
export async function getBscGasPrice(apiKey: string): Promise<{
  low: number;
  average: number;
  high: number;
}> {
  try {
    const response = await axios.get(
      `https://api.bscscan.com/api?module=gastracker&action=gasoracle&apikey=${apiKey}`
    );

    if (response.data.status === '1') {
      const result = response.data.result;
      return {
        low: parseInt(result.SafeGasPrice),
        average: parseInt(result.ProposeGasPrice),
        high: parseInt(result.FastGasPrice),
      };
    }
  } catch {
    // Ignore errors
  }

  // BSC default (usually 3-5 gwei)
  return {
    low: 3,
    average: 5,
    high: 7,
  };
}

// =============================================================================
// GAS LIMITS
// =============================================================================

/** Standard gas limits for common operations */
export const GAS_LIMITS = {
  /** Native ETH/BNB transfer */
  nativeTransfer: 21000,

  /** ERC20 token transfer */
  tokenTransfer: 65000,

  /** ERC20 token approval */
  tokenApproval: 46000,
};

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Check if a sweep is economically viable.
 *
 * @param amountWei - Amount to sweep in wei
 * @param gasCostWei - Estimated gas cost in wei
 * @param minProfitRatio - Minimum ratio of amount to gas cost (default: 2)
 * @returns True if sweep is economical
 */
export function isSweepEconomical(
  amountWei: bigint,
  gasCostWei: bigint,
  minProfitRatio: number = 2
): boolean {
  return amountWei > gasCostWei * BigInt(minProfitRatio);
}

/**
 * Calculate the net amount after gas for native sweeps.
 *
 * @param balanceWei - Balance in wei
 * @param gasPriceGwei - Gas price in gwei
 * @param gasLimit - Gas limit
 * @returns Net amount in wei, or 0 if not economical
 */
export function calculateNetSweepAmount(
  balanceWei: bigint,
  gasPriceGwei: number,
  gasLimit: number
): bigint {
  const gasCostWei = BigInt(gasLimit) * BigInt(Math.ceil(gasPriceGwei * 1e9));

  if (balanceWei <= gasCostWei) {
    return 0n;
  }

  return balanceWei - gasCostWei;
}
