/**
 * EVM Native Sweeper
 *
 * Sweeps native ETH/BNB from derived addresses to hot wallet.
 * Works for Ethereum, BSC, Polygon, Base, etc.
 */

import { JsonRpcProvider, Wallet, parseEther, formatEther, formatUnits } from 'ethers';
import { ChainSweeper, ChainSweepParams, SweepResult } from '../types';

/**
 * EVM native asset sweeper (ETH, BNB, MATIC, etc.).
 */
export class EVMSweeper implements ChainSweeper {
  private provider: JsonRpcProvider;
  private chainId: number;

  constructor(rpcUrl: string, chainId: number = 1) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.chainId = chainId;
  }

  /**
   * Sweep all native balance from address to hot wallet.
   */
  async sweep(params: ChainSweepParams): Promise<SweepResult> {
    try {
      const wallet = new Wallet(params.privateKey, this.provider);

      // Get balance
      const balance = await this.provider.getBalance(params.fromAddress);
      if (balance === 0n) {
        return {
          success: false,
          error: 'No balance to sweep',
        };
      }

      const feeData = await this.provider.getFeeData();

      let gasPrice: bigint;
      let maxFeePerGas: bigint | undefined;
      let maxPriorityFeePerGas: bigint | undefined;

      // Use EIP-1559 if available
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        maxFeePerGas = feeData.maxFeePerGas;
        maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
        gasPrice = maxFeePerGas;
      } else {
        gasPrice = feeData.gasPrice || 0n;
      }

      const estimatedGas = await this.provider.estimateGas({
        from: params.fromAddress,
        to: params.toAddress,
        value: balance > 1n ? 1n : 0n,
      });
      const gasLimit = estimatedGas + estimatedGas / 10n; // 10% buffer for contract recipients
      const gasCost = gasLimit * gasPrice;
      const sendAmount = balance - gasCost;

      if (sendAmount <= 0n) {
        return {
          success: false,
          error: `Insufficient funds: balance ${formatEther(balance)} ETH, gas cost ${formatEther(gasCost)} ETH`,
        };
      }

      // Build transaction
      const tx: any = {
        to: params.toAddress,
        value: sendAmount,
        gasLimit,
        chainId: this.chainId,
      };

      if (maxFeePerGas && maxPriorityFeePerGas) {
        tx.maxFeePerGas = maxFeePerGas;
        tx.maxPriorityFeePerGas = maxPriorityFeePerGas;
        tx.type = 2;
      } else {
        tx.gasPrice = gasPrice;
      }

      // Send transaction
      const txResponse = await wallet.sendTransaction(tx);
      const receipt = await txResponse.wait();

      if (!receipt) {
        return {
          success: false,
          error: 'Transaction receipt not received',
        };
      }

      return {
        success: true,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        gasPrice: formatUnits(gasPrice, 'gwei'),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[EVMSweeper] Sweep failed:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Estimate gas fee for sweep.
   */
  async estimateFee(params: ChainSweepParams): Promise<string> {
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || 0n;
    let gasLimit = 21000n;

    try {
      const balance = await this.provider.getBalance(params.fromAddress);
      if (balance > 0n) {
        const estimatedGas = await this.provider.estimateGas({
          from: params.fromAddress,
          to: params.toAddress,
          value: balance > 1n ? 1n : 0n,
        });
        gasLimit = estimatedGas + estimatedGas / 10n;
      }
    } catch {
      // Keep the standard native transfer estimate when RPC estimation is unavailable.
    }

    const gasCost = gasLimit * gasPrice;

    return formatEther(gasCost);
  }

  /**
   * Check if sweep is economical.
   */
  isEconomical(amount: string, estimatedFee: string): boolean {
    const amountWei = parseEther(amount);
    const feeWei = parseEther(estimatedFee);

    // Require at least 2x fee to make sweep worthwhile
    return amountWei > feeWei * 2n;
  }
}

// Factory functions for different EVM chains
export function createEthereumSweeper(rpcUrl: string): EVMSweeper {
  return new EVMSweeper(rpcUrl, 1);
}

export function createBscSweeper(rpcUrl: string): EVMSweeper {
  return new EVMSweeper(rpcUrl, 56);
}

export function createPolygonSweeper(rpcUrl: string): EVMSweeper {
  return new EVMSweeper(rpcUrl, 137);
}

export function createBaseSweeper(rpcUrl: string): EVMSweeper {
  return new EVMSweeper(rpcUrl, 8453);
}
