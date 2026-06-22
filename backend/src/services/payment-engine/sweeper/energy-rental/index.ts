/**
 * Energy Rental Module
 *
 * Provides a singleton EnergyRentalService that rents Tron energy
 * from third-party providers with automatic failover.
 */

export { EnergyRentalService } from './energy-rental.service';
export type {
  EnergyRentalProvider,
  EnergyRentalResult,
  EnergyEstimate,
  EnergyRentalConfig,
  TronSaveConfig,
  TronZapConfig,
  TronEnergyRentConfig,
} from './types';

import { EnergyRentalService } from './energy-rental.service';
import { config } from '../../../../config';

let instance: EnergyRentalService | null = null;

export function getEnergyRentalService(): EnergyRentalService {
  if (!instance) {
    instance = new EnergyRentalService(config.sweeper.energyRental);
  }
  return instance;
}
