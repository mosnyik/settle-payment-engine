/**
 * TronSave Energy Rental Provider
 *
 * API docs: https://docs.tronsave.io
 * - Estimate: POST /v2/estimate-buy-resource
 * - Buy:      POST /v2/buy-resource (requires apikey header)
 * - Status:   GET  /v2/order/:orderId
 *
 * Payment is deducted from prepaid TRX balance on TronSave account.
 */

import {
  EnergyRentalProvider,
  EnergyEstimate,
  EnergyRentalResult,
  TronSaveConfig,
} from '../types';

const SUN_PER_TRX = 1_000_000;

export class TronSaveProvider implements EnergyRentalProvider {
  readonly name = 'TronSave';
  private config: TronSaveConfig;

  constructor(config: TronSaveConfig) {
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
    const res = await fetch(`${this.config.apiUrl}/estimate-buy-resource`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceType: 'ENERGY',
        receiver: receiverAddress,
        resourceAmount: energyAmount,
        durationSec,
        unitPrice: 'MEDIUM',
      }),
    });

    const json = await res.json() as any;

    if (json.error) {
      throw new Error(`TronSave estimate failed: ${json.message}`);
    }

    const costSun = json.data.estimateTrx; // TronSave returns SUN in this field
    return {
      energyAmount,
      durationSec,
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
      const res = await fetch(`${this.config.apiUrl}/buy-resource`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.config.apiKey,
        },
        body: JSON.stringify({
          resourceType: 'ENERGY',
          receiver: receiverAddress,
          resourceAmount: energyAmount,
          durationSec,
          unitPrice: 'MEDIUM',
          options: {
            onlyCreateWhenFulfilled: true,
          },
        }),
      });

      const json = await res.json() as any;

      if (json.error) {
        return {
          success: false,
          provider: this.name,
          error: json.message || 'TronSave order failed',
        };
      }

      const orderId = json.data?.orderId;

      // Poll for fulfillment (up to 15 seconds)
      const txHash = await this.waitForFulfillment(orderId);

      return {
        success: true,
        orderId,
        provider: this.name,
        energyAmount,
        durationSec,
        txHash,
      };
    } catch (err) {
      return {
        success: false,
        provider: this.name,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Poll TronSave order status until fulfilled or timeout.
   * Returns the delegation txHash if available.
   */
  private async waitForFulfillment(
    orderId: string,
    maxWaitMs: number = 15_000,
  ): Promise<string | undefined> {
    const start = Date.now();
    const pollInterval = 2_000;

    while (Date.now() - start < maxWaitMs) {
      try {
        const res = await fetch(`${this.config.apiUrl}/order/${orderId}`, {
          headers: { apikey: this.config.apiKey },
        });
        const json = await res.json() as any;

        if (!json.error && json.data?.fulfilledPercent === 100) {
          return json.data.delegates?.[0]?.txid;
        }
      } catch {
        // Ignore polling errors, keep trying
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    // Timed out waiting — the order was placed successfully but may still be filling
    return undefined;
  }
}
