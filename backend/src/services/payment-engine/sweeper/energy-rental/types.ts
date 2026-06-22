/**
 * Energy Rental Types
 *
 * Type definitions for the Tron energy rental system.
 * Energy is rented from third-party providers and delegated to child
 * addresses so they can execute TRC20 transfers without owning TRX.
 */

// =============================================================================
// RESULT TYPES
// =============================================================================

/** Result of an energy cost estimate */
export interface EnergyEstimate {
  /** Energy units to rent */
  energyAmount: number;
  /** Rental duration in seconds */
  durationSec: number;
  /** Estimated cost in TRX */
  costTrx: number;
  /** Estimated cost in SUN (1 TRX = 1,000,000 SUN) */
  costSun: number;
  /** Provider name that produced this estimate */
  provider: string;
}

/** Result of an energy rental order */
export interface EnergyRentalResult {
  success: boolean;
  /** Provider's order ID */
  orderId?: string;
  /** Which provider fulfilled the order */
  provider: string;
  /** Energy units rented */
  energyAmount?: number;
  /** Rental duration in seconds */
  durationSec?: number;
  /** Actual cost in TRX */
  costTrx?: number;
  /** Delegation transaction hash (if available) */
  txHash?: string;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// PROVIDER INTERFACE
// =============================================================================

/** All energy rental providers implement this interface */
export interface EnergyRentalProvider {
  readonly name: string;

  /** Check if this provider is configured (has API key, etc.) */
  isConfigured(): boolean;

  /** Estimate rental cost without placing an order */
  estimate(
    receiverAddress: string,
    energyAmount: number,
    durationSec: number,
  ): Promise<EnergyEstimate>;

  /** Place an energy rental order */
  rent(
    receiverAddress: string,
    energyAmount: number,
    durationSec: number,
  ): Promise<EnergyRentalResult>;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface TronSaveConfig {
  apiKey: string;
  apiUrl: string;
}

export interface TronZapConfig {
  apiKey: string;
  apiSecret: string;
  apiUrl: string;
}

export interface TronEnergyRentConfig {
  apiKey: string;
  apiUrl: string;
}

export interface EnergyRentalConfig {
  enabled: boolean;
  /** Energy units to rent per TRC20 sweep (default 65000) */
  energyAmount: number;
  /** Rental duration in seconds (default 600 = 10 minutes) */
  durationSec: number;
  tronsave: TronSaveConfig;
  tronzap: TronZapConfig;
  tronenergyrent: TronEnergyRentConfig;
}
