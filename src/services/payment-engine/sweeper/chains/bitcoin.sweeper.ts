/**
 * Bitcoin Sweeper
 *
 * Sweeps BTC from derived addresses to hot wallet.
 * Uses Blockstream API for UTXO fetching and broadcast.
 */

import axios from 'axios';
import * as btc from '@scure/btc-signer';
import { ChainSweeper, ChainSweepParams, SweepResult } from '../types';

const BLOCKSTREAM_API = 'https://blockstream.info/api';
const SATS_PER_BTC = 100_000_000;

interface UTXO {
  txid: string;
  vout: number;
  value: number;
  status: {
    confirmed: boolean;
    block_height?: number;
  };
}

/**
 * Bitcoin sweeper using native SegWit (P2WPKH).
 */
export class BitcoinSweeper implements ChainSweeper {
  private apiUrl: string;

  constructor(apiUrl: string = BLOCKSTREAM_API) {
    this.apiUrl = apiUrl;
  }

  /**
   * Sweep all BTC from address to hot wallet.
   */
  async sweep(params: ChainSweepParams): Promise<SweepResult> {
    try {
      // Fetch UTXOs
      const utxos = await this.fetchUTXOs(params.fromAddress);

      if (utxos.length === 0) {
        return {
          success: false,
          error: 'No UTXOs found',
        };
      }

      // Calculate total and fees
      const totalSats = utxos.reduce((sum, u) => sum + u.value, 0);
      const feeRate = await this.getFeeRate();
      const estimatedSize = this.estimateTxSize(utxos.length, 1);
      const feeSats = Math.ceil(estimatedSize * feeRate);

      const sendSats = totalSats - feeSats;
      if (sendSats <= 0) {
        return {
          success: false,
          error: `Insufficient funds: ${totalSats} sats, fee: ${feeSats} sats`,
        };
      }

      // Build transaction
      const privateKey = Buffer.from(params.privateKey, 'hex');
      const tx = this.buildTransaction(utxos, params.toAddress, sendSats, privateKey);

      // Broadcast
      const txHash = await this.broadcastTransaction(tx);

      return {
        success: true,
        txHash,
        gasUsed: feeSats.toString(),
        gasPrice: feeRate.toString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[BitcoinSweeper] Sweep failed:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Estimate fee for sweep.
   */
  async estimateFee(params: ChainSweepParams): Promise<string> {
    const utxos = await this.fetchUTXOs(params.fromAddress);
    const feeRate = await this.getFeeRate();
    const estimatedSize = this.estimateTxSize(utxos.length, 1);
    const feeSats = Math.ceil(estimatedSize * feeRate);

    return (feeSats / SATS_PER_BTC).toFixed(8);
  }

  /**
   * Check if sweep is economical.
   */
  isEconomical(amount: string, estimatedFee: string): boolean {
    const amountSats = Math.floor(parseFloat(amount) * SATS_PER_BTC);
    const feeSats = Math.floor(parseFloat(estimatedFee) * SATS_PER_BTC);

    // Require at least 2x fee to make sweep worthwhile
    return amountSats > feeSats * 2;
  }

  /**
   * Fetch UTXOs for an address.
   */
  private async fetchUTXOs(address: string): Promise<UTXO[]> {
    const response = await axios.get<UTXO[]>(
      `${this.apiUrl}/address/${address}/utxo`
    );

    // Only use confirmed UTXOs
    return response.data.filter(u => u.status.confirmed);
  }

  /**
   * Get current fee rate (sat/vbyte).
   */
  private async getFeeRate(): Promise<number> {
    try {
      const response = await axios.get<Record<string, number>>(
        `${this.apiUrl}/fee-estimates`
      );
      // Use 3-block target
      return response.data['3'] || response.data['6'] || 10;
    } catch {
      // Default fallback
      return 10;
    }
  }

  /**
   * Estimate transaction size in vbytes.
   * P2WPKH input: ~68 vbytes, P2WPKH output: ~31 vbytes
   */
  private estimateTxSize(inputCount: number, outputCount: number): number {
    const overhead = 10.5; // version + locktime + witness marker
    const inputSize = 68;
    const outputSize = 31;

    return Math.ceil(overhead + inputCount * inputSize + outputCount * outputSize);
  }

  /**
   * Build and sign transaction.
   */
  private buildTransaction(
    utxos: UTXO[],
    toAddress: string,
    sendSats: number,
    privateKey: Uint8Array
  ): string {
    // Create transaction using @scure/btc-signer
    const inputs = utxos.map(utxo => ({
      txid: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: btc.p2wpkh(btc.utils.pubSchnorr(privateKey)).script,
        amount: BigInt(utxo.value),
      },
    }));

    const outputs = [
      {
        address: toAddress,
        amount: BigInt(sendSats),
      },
    ];

    const tx = new btc.Transaction();

    for (const input of inputs) {
      tx.addInput(input);
    }

    for (const output of outputs) {
      tx.addOutputAddress(output.address, output.amount);
    }

    // Sign all inputs
    tx.sign(privateKey);
    tx.finalize();

    return tx.hex;
  }

  /**
   * Broadcast transaction to network.
   */
  private async broadcastTransaction(txHex: string): Promise<string> {
    const response = await axios.post<string>(
      `${this.apiUrl}/tx`,
      txHex,
      {
        headers: { 'Content-Type': 'text/plain' },
      }
    );

    return response.data;
  }
}

export const bitcoinSweeper = new BitcoinSweeper();
