/**
 * Settlement Provider Interface
 *
 * Same shape as RateProvider (rate/providers/types.ts) and EnergyRentalProvider
 * (sweeper/energy-rental/types.ts) — implement this to add a new payout rail.
 * Balance tracking and provider selection live outside this interface, in
 * SettlementRouter; a provider only needs to know how to move money.
 */

import { SettlementRequest } from '../types';

export interface SettlementTransferResult {
  success: boolean;
  /**
   * The provider could not confirm whether the transfer was submitted. Treated
   * as in flight (never retried elsewhere) and flagged for a human to check.
   */
  uncertain?: boolean;
  reference?: string;
  message: string;
  raw?: Record<string, unknown>;
}

export interface SettlementProvider {
  readonly name: string;
  isEnabled(): boolean;
  transfer(request: SettlementRequest): Promise<SettlementTransferResult>;
}
