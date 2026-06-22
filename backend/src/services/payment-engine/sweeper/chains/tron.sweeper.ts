/**
 * Tron Sweeper
 *
 * Sweeps TRX and TRC20 tokens from derived addresses to hot wallet.
 * Uses TronWeb for transaction building.
 */

import { ChainSweeper, ChainSweepParams, SweepResult, TOKEN_DECIMALS } from '../types';
import { config } from '../../../../config';

// TronWeb will be dynamically imported to avoid issues if not installed
let TronWeb: any = null;

async function getTronWeb(): Promise<any> {
  if (!TronWeb) {
    const tronWebModule = await import('tronweb');
    TronWeb =
      (tronWebModule as any).TronWeb ??
      (tronWebModule as any).default?.TronWeb ??
      (tronWebModule as any).default;
  }
  return TronWeb;
}

const TRONGRID_API = 'https://api.trongrid.io';
const SUN_PER_TRX = 1_000_000;

/**
 * Tron sweeper for TRX and TRC20 tokens.
 */
export class TronSweeper implements ChainSweeper {
  private apiUrl: string;
  private apiKey?: string;

  constructor(apiUrl: string = TRONGRID_API, apiKey?: string) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  /**
   * Sweep TRX or TRC20 from address to hot wallet.
   */
  async sweep(params: ChainSweepParams): Promise<SweepResult> {
    try {
      const TronWebClass = await getTronWeb();

      const tronWeb = new TronWebClass({
        fullHost: this.apiUrl,
        headers: this.apiKey ? { 'TRON-PRO-API-KEY': this.apiKey } : undefined,
        privateKey: params.privateKey,
      });

      if (params.tokenContract) {
        // TRC20 token transfer
        return await this.sweepTRC20(tronWeb, params);
      } else {
        // Native TRX transfer
        return await this.sweepTRX(tronWeb, params);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[TronSweeper] Sweep failed:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Sweep native TRX.
   */
  private async sweepTRX(tronWeb: any, params: ChainSweepParams): Promise<SweepResult> {
    // Get balance
    const balance = await tronWeb.trx.getBalance(params.fromAddress);

    if (balance <= 0) {
      return {
        success: false,
        error: 'No TRX balance to sweep',
      };
    }

    // Reserve some TRX for bandwidth (1 TRX should be enough)
    const reserveAmount = 1 * SUN_PER_TRX;
    const sendAmount = balance - reserveAmount;

    if (sendAmount <= 0) {
      return {
        success: false,
        error: `Insufficient TRX: balance ${balance / SUN_PER_TRX} TRX`,
      };
    }

    // Build and send transaction
    const tx = await tronWeb.transactionBuilder.sendTrx(
      params.toAddress,
      sendAmount,
      params.fromAddress
    );

    const signedTx = await tronWeb.trx.sign(tx);
    const result = await tronWeb.trx.sendRawTransaction(signedTx);

    if (result.result) {
      return {
        success: true,
        txHash: result.txid,
        gasUsed: reserveAmount.toString(),
      };
    } else {
      return {
        success: false,
        error: result.message || 'Transaction failed',
      };
    }
  }

  /**
   * Sweep TRC20 tokens.
   */
  private async sweepTRC20(tronWeb: any, params: ChainSweepParams): Promise<SweepResult> {
    if (!params.tokenContract) {
      return {
        success: false,
        error: 'Token contract address required',
      };
    }

    // Get token balance
    const contract = await tronWeb.contract().at(params.tokenContract);
    const balance = await contract.balanceOf(params.fromAddress).call();

    if (balance.toString() === '0') {
      return {
        success: false,
        error: 'No token balance to sweep',
      };
    }

    // Check TRX balance for energy/bandwidth (skip when energy rental is active —
    // the child has delegated energy and does not need to own TRX)
    const energyRentalActive = !!config.sweeper.energyRental?.enabled;
    if (!energyRentalActive) {
      const trxBalance = await tronWeb.trx.getBalance(params.fromAddress);
      const minTrxForGas = 5 * SUN_PER_TRX; // 5 TRX for energy

      if (trxBalance < minTrxForGas) {
        return {
          success: false,
          error: `Insufficient TRX for energy: need ${minTrxForGas / SUN_PER_TRX} TRX, have ${trxBalance / SUN_PER_TRX} TRX`,
        };
      }
    }

    // Transfer tokens
    const tx = await contract.transfer(params.toAddress, balance.toString()).send({
      feeLimit: 100_000_000, // 100 TRX max fee
      callValue: 0,
      shouldPollResponse: true,
    });

    return {
      success: true,
      txHash: tx,
      gasUsed: energyRentalActive ? '0' : (5 * SUN_PER_TRX).toString(),
    };
  }

  /**
   * Estimate fee for sweep.
   */
  async estimateFee(params: ChainSweepParams): Promise<string> {
    if (params.tokenContract) {
      // TRC20 transfer typically costs 5-15 TRX in energy
      return '10';
    } else {
      // TRX transfer uses bandwidth, typically free or 1 TRX
      return '1';
    }
  }

  /**
   * Check if sweep is economical.
   */
  isEconomical(amount: string, estimatedFee: string): boolean {
    const amountNum = parseFloat(amount);
    const feeNum = parseFloat(estimatedFee);

    // For TRX, require 2x fee
    // For tokens (USDT), require 10x fee (in TRX equivalent)
    return amountNum > feeNum * 2;
  }
}

export const tronSweeper = new TronSweeper();

export function createTronSweeper(apiUrl: string, apiKey?: string): TronSweeper {
  return new TronSweeper(apiUrl, apiKey);
}
