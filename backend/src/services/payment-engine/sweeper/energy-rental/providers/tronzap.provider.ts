/**
 * TronZap Energy Rental Provider
 *
 * API docs: https://docs.tronzap.com
 * - Calculate: POST /v1/calculate
 * - Buy:       POST /v1/transaction/new
 * - Auth:      Bearer token + SHA256(body + secret) signature
 *
 * Payment is deducted from prepaid TRX balance on TronZap account.
 * Duration is in hours (currently only 1 hour is supported).
 * Minimum energy: 50,000 units.
 */

import crypto from 'crypto';
import {
  EnergyRentalProvider,
  EnergyEstimate,
  EnergyRentalResult,
  TronZapConfig,
} from '../types';

const SUN_PER_TRX = 1_000_000;
const MIN_ENERGY = 50_000;

export class TronZapProvider implements EnergyRentalProvider {
  readonly name = 'TronZap';
  private config: TronZapConfig;

  constructor(config: TronZapConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return !!this.config.apiKey && !!this.config.apiSecret;
  }

  /**
   * Generate SHA256 signature: SHA256(requestBody + apiSecret)
   */
  private sign(body: string): string {
    return crypto
      .createHash('sha256')
      .update(body + this.config.apiSecret)
      .digest('hex');
  }

  /**
   * Convert duration in seconds to hours (TronZap uses hours, minimum 1).
   */
  private durationToHours(durationSec: number): number {
    return Math.max(1, Math.ceil(durationSec / 3600));
  }

  async estimate(
    receiverAddress: string,
    energyAmount: number,
    durationSec: number,
  ): Promise<EnergyEstimate> {
    const amount = Math.max(energyAmount, MIN_ENERGY);
    const body = JSON.stringify({
      address: receiverAddress,
      amount,
      duration: this.durationToHours(durationSec),
      type: 'energy',
    });

    const res = await fetch(`${this.config.apiUrl}/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        'X-Signature': this.sign(body),
      },
      body,
    });

    const json = await res.json() as any;

    if (json.code !== 0) {
      throw new Error(`TronZap estimate failed: ${JSON.stringify(json)}`);
    }

    const costTrx = json.result?.total ?? json.result?.price ?? 0;
    return {
      energyAmount: amount,
      durationSec,
      costTrx,
      costSun: Math.round(costTrx * SUN_PER_TRX),
      provider: this.name,
    };
  }

  async rent(
    receiverAddress: string,
    energyAmount: number,
    durationSec: number,
  ): Promise<EnergyRentalResult> {
    try {
      const amount = Math.max(energyAmount, MIN_ENERGY);
      const body = JSON.stringify({
        service: 'energy',
        params: {
          address: receiverAddress,
          amount,
          duration: this.durationToHours(durationSec),
        },
      });

      const res = await fetch(`${this.config.apiUrl}/transaction/new`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          'X-Signature': this.sign(body),
        },
        body,
      });

      const json = await res.json() as any;

      if (json.code !== 0) {
        return {
          success: false,
          provider: this.name,
          error: `TronZap order failed: code=${json.code}, ${JSON.stringify(json)}`,
        };
      }

      const result = json.result;
      return {
        success: true,
        orderId: result?.id,
        provider: this.name,
        energyAmount: amount,
        durationSec,
        costTrx: result?.amount,
        txHash: result?.hash,
      };
    } catch (err) {
      return {
        success: false,
        provider: this.name,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
