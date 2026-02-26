/**
 * EVM Token Sweeper
 *
 * Sweeps ERC20/BEP20 tokens from derived addresses to hot wallet.
 */

import {
  JsonRpcProvider,
  Wallet,
  Contract,
  formatUnits,
  parseUnits,
  Interface,
} from 'ethers';
import { ChainSweeper, ChainSweepParams, SweepResult, TOKEN_DECIMALS } from '../types';

// ERC20 ABI (minimal)
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

/**
 * EVM token sweeper for ERC20/BEP20 tokens.
 */
export class EVMTokenSweeper implements ChainSweeper {
  private provider: JsonRpcProvider;
  private chainId: number;

  constructor(rpcUrl: string, chainId: number = 1) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.chainId = chainId;
  }

  /**
   * Sweep all token balance from address to hot wallet.
   */
  async sweep(params: ChainSweepParams): Promise<SweepResult> {
    if (!params.tokenContract) {
      return {
        success: false,
        error: 'Token contract address required',
      };
    }

    try {
      const wallet = new Wallet(params.privateKey, this.provider);
      const tokenContract = new Contract(params.tokenContract, ERC20_ABI, wallet);

      // Get token balance
      const balance: bigint = await tokenContract.balanceOf(params.fromAddress);
      if (balance === 0n) {
        return {
          success: false,
          error: 'No token balance to sweep',
        };
      }

      // Check native balance for gas
      const nativeBalance = await this.provider.getBalance(params.fromAddress);
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || 0n;

      // Estimate gas for transfer
      const iface = new Interface(ERC20_ABI);
      const data = iface.encodeFunctionData('transfer', [params.toAddress, balance]);

      const gasLimit = await this.provider.estimateGas({
        to: params.tokenContract,
        from: params.fromAddress,
        data,
      });

      const gasCost = gasLimit * gasPrice;

      if (nativeBalance < gasCost) {
        return {
          success: false,
          error: `Insufficient gas: need ${formatUnits(gasCost, 'ether')} ETH, have ${formatUnits(nativeBalance, 'ether')} ETH`,
        };
      }

      // Execute transfer
      const tx = await tokenContract.transfer(params.toAddress, balance, {
        gasLimit: gasLimit + gasLimit / 10n, // 10% buffer
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      });

      const receipt = await tx.wait();

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
      console.error('[EVMTokenSweeper] Sweep failed:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Estimate gas fee for token transfer.
   */
  async estimateFee(params: ChainSweepParams): Promise<string> {
    if (!params.tokenContract) {
      return '0';
    }

    try {
      const tokenContract = new Contract(params.tokenContract, ERC20_ABI, this.provider);
      const balance: bigint = await tokenContract.balanceOf(params.fromAddress);

      if (balance === 0n) {
        return '0';
      }

      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || 0n;

      // Estimate gas
      const iface = new Interface(ERC20_ABI);
      const data = iface.encodeFunctionData('transfer', [params.toAddress, balance]);

      const gasLimit = await this.provider.estimateGas({
        to: params.tokenContract,
        from: params.fromAddress,
        data,
      });

      const gasCost = gasLimit * gasPrice;
      return formatUnits(gasCost, 'ether');
    } catch {
      // Default estimate for token transfer
      const defaultGas = 65000n;
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || 0n;
      return formatUnits(defaultGas * gasPrice, 'ether');
    }
  }

  /**
   * Check if sweep is economical.
   * For tokens, check if token value > gas cost.
   */
  isEconomical(amount: string, estimatedFee: string): boolean {
    // For tokens, we need to compare token value vs gas cost
    // This is simplified - in production, use price oracles
    const amountNum = parseFloat(amount);
    const feeNum = parseFloat(estimatedFee);

    // For stablecoins, assume 1:1 with USD equivalent
    // This is a simplification - in production, fetch actual prices
    return amountNum > feeNum * 10; // Token value should be 10x gas cost
  }

  /**
   * Get token decimals.
   */
  async getTokenDecimals(tokenContract: string): Promise<number> {
    // Check cache first
    const cached = TOKEN_DECIMALS[tokenContract.toLowerCase()] ||
                   TOKEN_DECIMALS[tokenContract];
    if (cached) {
      return cached;
    }

    // Fetch from contract
    const contract = new Contract(tokenContract, ERC20_ABI, this.provider);
    const decimals: number = await contract.decimals();
    return decimals;
  }
}

// Factory functions
export function createEthereumTokenSweeper(rpcUrl: string): EVMTokenSweeper {
  return new EVMTokenSweeper(rpcUrl, 1);
}

export function createBscTokenSweeper(rpcUrl: string): EVMTokenSweeper {
  return new EVMTokenSweeper(rpcUrl, 56);
}
