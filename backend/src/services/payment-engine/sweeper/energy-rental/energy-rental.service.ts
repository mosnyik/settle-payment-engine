/**
 * Energy Rental Service
 *
 * Orchestrates energy rental across multiple providers with automatic failover.
 * Providers are tried in priority order (TronSave → TronZap → TronEnergyRent).
 * If one fails, the next is attempted. Only fails if all configured providers fail.
 */

import {
  EnergyRentalProvider,
  EnergyRentalResult,
  EnergyEstimate,
  EnergyRentalConfig,
} from './types';
import { TronSaveProvider } from './providers/tronsave.provider';
import { TronZapProvider } from './providers/tronzap.provider';
import { TronEnergyRentProvider } from './providers/tronenergyrent.provider';

export class EnergyRentalService {
  private providers: EnergyRentalProvider[];

  constructor(rentalConfig: EnergyRentalConfig) {
    // Initialize all providers, keep only configured ones
    this.providers = [
      new TronSaveProvider(rentalConfig.tronsave),
      new TronZapProvider(rentalConfig.tronzap),
      new TronEnergyRentProvider(rentalConfig.tronenergyrent),
    ].filter((p) => p.isConfigured());

    if (this.providers.length === 0) {
      console.warn(
        '[EnergyRental] No providers configured. Set at least one of: TRONSAVE_API_KEY, TRONZAP_API_KEY, TRONENERGYRENT_API_KEY',
      );
    } else {
      console.log(
        `[EnergyRental] Initialized with providers: ${this.providers.map((p) => p.name).join(', ')}`,
      );
    }
  }

  /**
   * Rent energy with automatic failover.
   * Tries each configured provider in order until one succeeds.
   */
  async rentEnergy(
    receiverAddress: string,
    energyAmount: number,
    durationSec: number,
  ): Promise<EnergyRentalResult> {
    if (this.providers.length === 0) {
      return {
        success: false,
        provider: 'none',
        error: 'No energy rental providers configured',
      };
    }

    const errors: string[] = [];

    for (const provider of this.providers) {
      try {
        console.log(
          `[EnergyRental] Trying ${provider.name} for ${receiverAddress} (${energyAmount} energy, ${durationSec}s)`,
        );

        const result = await provider.rent(receiverAddress, energyAmount, durationSec);

        if (result.success) {
          console.log(
            `[EnergyRental] ${provider.name} succeeded: order=${result.orderId}, cost=${result.costTrx} TRX`,
          );
          return result;
        }

        console.warn(`[EnergyRental] ${provider.name} returned error: ${result.error}`);
        errors.push(`${provider.name}: ${result.error}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[EnergyRental] ${provider.name} threw: ${msg}`);
        errors.push(`${provider.name}: ${msg}`);
      }
    }

    return {
      success: false,
      provider: 'none',
      error: `All providers failed: ${errors.join('; ')}`,
    };
  }

  /**
   * Estimate energy rental cost from the first available provider.
   * Useful for cost projections and monitoring.
   */
  async estimateCost(
    receiverAddress: string,
    energyAmount: number,
    durationSec: number,
  ): Promise<EnergyEstimate | null> {
    for (const provider of this.providers) {
      try {
        return await provider.estimate(receiverAddress, energyAmount, durationSec);
      } catch {
        continue;
      }
    }
    return null;
  }

  /** Check if any provider is available */
  hasProviders(): boolean {
    return this.providers.length > 0;
  }
}
