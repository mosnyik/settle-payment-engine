/**
 * TronEnergyRent Provider
 *
 * API docs: https://tronenergyrent.com/en/overview-api
 * - Estimate: GET /calculate-energy-price
 * - Buy:      GET /place-energy-order (requires apiKey param)
 *
 * Payment is deducted from prepaid balance on TronEnergyRent account.
 * Period values: "1h", "1d", "3d", "30d"
 * Minimum energy: 15,000 units.
 */

import {
  EnergyRentalProvider,
  EnergyEstimate,
  EnergyRentalResult,
  TronEnergyRentConfig,
} from '../types';

const SUN_PER_TRX = 1_000_000;
const MIN_ENERGY = 15_000;

/** Map duration in seconds to the nearest supported period string */
function durationToPeriod(durationSec: number): string {
  if (durationSec <= 3600) return '1h';
  if (durationSec <= 86400) return '1d';
  if (durationSec <= 259200) return '3d';
  return '30d';
}

/** Map period string back to seconds */
function periodToSeconds(period: string): number {
  switch (period) {
    case '1h': return 3600;
    case '1d': return 86400;
    case '3d': return 259200;
    case '30d': return 2592000;
    default: return 3600;
  }
}

export class TronEnergyRentProvider implements EnergyRentalProvider {
  readonly name = 'TronEnergyRent';
  private config: TronEnergyRentConfig;

  constructor(config: TronEnergyRentConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return !!this.config.apiKey;
  }

  async estimate(
    receiverAddress: string,
    energyAmount: number,
    durationSec: number,
  ): Promise<EnergyEstimate> {
    const amount = Math.max(energyAmount, MIN_ENERGY);
    const period = durationToPeriod(durationSec);

    const params = new URLSearchParams({
      period,
      energyAmount: amount.toString(),
    });

    const res = await fetch(
      `${this.config.apiUrl}/calculate-energy-price?${params}`,
    );

    const json = await res.json() as any;

    if (json.code === 'ERROR' || json.status === 'ERROR') {
      throw new Error(`TronEnergyRent estimate failed: ${json.message || JSON.stringify(json)}`);
    }

    const costSun = json.totalPriceSun ?? json.priceSun ?? 0;
    return {
      energyAmount: amount,
      durationSec: periodToSeconds(period),
      costSun,
      costTrx: costSun / SUN_PER_TRX,
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
      const period = durationToPeriod(durationSec);

      const params = new URLSearchParams({
        apiKey: this.config.apiKey,
        period,
        energyAmount: amount.toString(),
        destinationAddress: receiverAddress,
      });

      const res = await fetch(
        `${this.config.apiUrl}/place-energy-order?${params}`,
      );

      const json = await res.json() as any;

      if (json.code === 'ERROR' || json.status === 'ERROR') {
        return {
          success: false,
          provider: this.name,
          error: json.message || `TronEnergyRent order failed: ${JSON.stringify(json)}`,
        };
      }

      const costSun = json.totalPriceSun ?? json.priceSun ?? 0;
      return {
        success: true,
        orderId: json.orderId?.toString(),
        provider: this.name,
        energyAmount: amount,
        durationSec: periodToSeconds(period),
        costTrx: costSun / SUN_PER_TRX,
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
