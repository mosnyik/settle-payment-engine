/**
 * Payment Engine
 *
 * The main facade for the payment engine.
 *
 * This is the PUBLIC API that external code uses.
 * It wraps the SessionManager and provides a clean, simple interface.
 *
 * Why a facade?
 * -------------
 * 1. Simplicity: External code only imports PaymentEngine, not all the internals
 * 2. Stability: We can change internals without breaking external code
 * 3. Discoverability: All capabilities are in one place
 *
 * Usage:
 * ```typescript
 * import { PaymentEngine } from '@/services/payment-engine';
 *
 * const engine = new PaymentEngine();
 *
 * // Create a payment
 * const session = await engine.createPayment({
 *   type: 'transfer',
 *   fiatAmount: 50000,
 *   fiatCurrency: 'NGN',
 *   crypto: 'USDT',
 *   network: 'bep20',
 *   payer: { chatId: 'user123' },
 *   receiver: { bankCode: '058', accountNumber: '1234567890', accountName: 'John' }
 * });
 *
 * console.log(`Send ${session.cryptoAmount} USDT to ${session.depositAddress}`);
 * console.log(`Reference: ${session.reference}`);
 *
 * // Check status
 * const status = await engine.getPayment(session.id);
 *
 * // When deposit is detected (by monitoring service)
 * await engine.recordDeposit(session.id, '0xabc...', 32.5);
 *
 * // When enough confirmations
 * await engine.confirmPayment(session.id, 15);
 *
 * // When fiat is sent
 * await engine.settlePayment(session.id);
 * ```
 */

import {
  CreatePaymentInput,
  PaymentSession,
  PaymentEngineConfig,
  DEFAULT_CONFIG,
} from './types';
import { SessionManager, sessionManager } from './session';
import { getPoolStatus, releaseExpiredWallets } from './wallet';
import { clearRateCache } from './rate';

/**
 * PaymentEngine - the main entry point for payment processing.
 *
 * This class provides all the methods needed to:
 * - Create payments
 * - Track payment status
 * - Record deposits
 * - Confirm payments
 * - Settle payments
 * - Handle expiry
 */
export class PaymentEngine {
  private manager: SessionManager;
  private config: PaymentEngineConfig;

  /**
   * Create a new PaymentEngine instance.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config: Partial<PaymentEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.manager = new SessionManager(undefined, this.config);
  }

  // ===========================================================================
  // PAYMENT LIFECYCLE
  // ===========================================================================

  /**
   * Create a new payment session.
   *
   * This locks the exchange rate, calculates fees, assigns a deposit wallet,
   * and returns a session with all the details the user needs to complete payment.
   *
   * @param input - Payment details
   * @returns The payment session with deposit address and amounts
   *
   * @example
   * ```typescript
   * const session = await engine.createPayment({
   *   type: 'transfer',
   *   fiatAmount: 50000,
   *   fiatCurrency: 'NGN',
   *   crypto: 'USDT',
   *   network: 'bep20',
   *   payer: { chatId: 'user123', phone: '08012345678' },
   *   receiver: {
   *     bankCode: '058',
   *     accountNumber: '1234567890',
   *     accountName: 'John Doe'
   *   }
   * });
   *
   * // Show the user:
   * // - session.depositAddress (where to send)
   * // - session.cryptoAmount (how much to send)
   * // - session.expiresAt (deadline)
   * ```
   */
  async createPayment(input: CreatePaymentInput): Promise<PaymentSession> {
    return this.manager.createSession(input);
  }

  /**
   * Get a payment by its ID.
   *
   * @param id - The payment ID (e.g., 'pay_abc123...')
   * @returns The payment session
   * @throws SessionNotFoundError if not found
   */
  async getPayment(id: string): Promise<PaymentSession> {
    return this.manager.getSession(id);
  }

  /**
   * Get a payment by its reference.
   *
   * @param reference - The human-readable reference (e.g., '2S-A1B2C3')
   * @returns The payment session
   * @throws SessionNotFoundError if not found
   */
  async getPaymentByReference(reference: string): Promise<PaymentSession> {
    return this.manager.getSessionByReference(reference);
  }

  /**
   * Record a deposit detected on-chain.
   *
   * Called by the deposit monitoring service when it detects
   * an incoming transaction to a payment's deposit address.
   *
   * @param id - The payment ID
   * @param txHash - The blockchain transaction hash
   * @param receivedAmount - The amount received (in crypto)
   * @returns The updated payment session
   */
  async recordDeposit(
    id: string,
    txHash: string,
    receivedAmount: number
  ): Promise<PaymentSession> {
    return this.manager.markDeposit(id, txHash, receivedAmount);
  }

  /**
   * Confirm a payment after enough blockchain confirmations.
   *
   * Called when the deposit has reached the required number
   * of confirmations for its blockchain.
   *
   * @param id - The payment ID
   * @param confirmations - Number of blockchain confirmations
   * @returns The updated payment session
   */
  async confirmPayment(id: string, confirmations: number): Promise<PaymentSession> {
    return this.manager.confirmDeposit(id, confirmations);
  }

  /**
   * Mark a payment as settling (fiat payout in progress).
   *
   * @param id - The payment ID
   * @returns The updated payment session
   */
  async startSettlement(id: string): Promise<PaymentSession> {
    return this.manager.markSettling(id);
  }

  /**
   * Mark a payment as settled (complete).
   *
   * Called when the fiat has been successfully sent
   * to the recipient's bank account.
   *
   * @param id - The payment ID
   * @returns The updated payment session
   */
  async settlePayment(id: string): Promise<PaymentSession> {
    return this.manager.markSettled(id);
  }

  /**
   * Expire a pending payment.
   *
   * Called when a payment times out without receiving a deposit.
   * Releases the wallet back to the pool.
   *
   * @param id - The payment ID
   * @returns The updated payment session
   */
  async expirePayment(id: string): Promise<PaymentSession> {
    return this.manager.expireSession(id);
  }

  /**
   * Mark a payment as failed.
   *
   * Called when something goes wrong that can't be recovered.
   * Releases the wallet if it was assigned.
   *
   * @param id - The payment ID
   * @returns The updated payment session
   */
  async failPayment(id: string): Promise<PaymentSession> {
    return this.manager.failSession(id);
  }

  // ===========================================================================
  // BATCH OPERATIONS
  // ===========================================================================

  /**
   * Expire all stale pending payments.
   *
   * Should be called periodically (e.g., every minute via cron)
   * to clean up payments that have timed out.
   *
   * @returns Number of payments expired
   */
  async expireStalePayments(): Promise<number> {
    return this.manager.expireStale();
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Get the current status of the wallet pool.
   *
   * Useful for monitoring and alerting.
   *
   * @returns Available and in-use counts per network
   */
  async getWalletPoolStatus(): Promise<Record<string, { available: number; inUse: number }>> {
    return getPoolStatus();
  }

  /**
   * Release wallets that were assigned but never released.
   *
   * Safety mechanism for wallets stuck due to bugs or crashes.
   * Should be called periodically.
   *
   * @returns Number of wallets released
   */
  async releaseStuckWallets(): Promise<number> {
    return releaseExpiredWallets();
  }

  /**
   * Clear the rate cache.
   *
   * Forces fresh rate fetches on next request.
   * Useful after rate updates or for testing.
   */
  clearRateCache(): void {
    clearRateCache();
  }

  // ===========================================================================
  // PAYER/RECEIVER MANAGEMENT
  // ===========================================================================

  /**
   * Set the payer ID for a payment.
   *
   * Called after creating/finding the payer in the payers table.
   *
   * @param paymentId - The payment ID
   * @param payerId - The payer's database ID
   */
  async setPayerId(paymentId: string, payerId: number): Promise<PaymentSession> {
    return this.manager.setPayerId(paymentId, payerId);
  }

  /**
   * Set the receiver ID for a payment.
   *
   * Called after creating/finding the receiver in the receivers table.
   *
   * @param paymentId - The payment ID
   * @param receiverId - The receiver's database ID
   */
  async setReceiverId(paymentId: string, receiverId: number): Promise<PaymentSession> {
    return this.manager.setReceiverId(paymentId, receiverId);
  }

  // ===========================================================================
  // CASHBACK
  // ===========================================================================

  /**
   * Set the cashback amount for a payment.
   *
   * Called after calculating cashback eligibility.
   *
   * @param paymentId - The payment ID
   * @param amount - The cashback amount in fiat
   */
  async setCashback(paymentId: string, amount: number): Promise<PaymentSession> {
    return this.manager.setCashback(paymentId, amount);
  }

  /**
   * Mark cashback as credited for a payment.
   *
   * Called after adding cashback to user's balance.
   *
   * @param paymentId - The payment ID
   */
  async creditCashback(paymentId: string): Promise<PaymentSession> {
    return this.manager.creditCashback(paymentId);
  }
}

// Export a default instance for convenience
export const paymentEngine = new PaymentEngine();
