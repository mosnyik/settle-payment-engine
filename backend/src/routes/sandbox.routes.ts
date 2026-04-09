/**
 * Sandbox Routes
 *
 * Only available to API keys created with isSandbox: true.
 * Allows developers to simulate the full payment lifecycle without real crypto.
 */

import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { sessionManager } from '../services/payment-engine/session/session-manager';
import { settlementService } from '../services/payment-engine/settlement/settlement.service';
import { sendPaymentWebhook } from '../services/payment-engine/payment-webhook.service';

const router = Router();

/**
 * POST /v1/sandbox/payments/:reference/simulate-deposit
 *
 * Simulates a crypto deposit for a sandbox payment, running it through the full
 * status lifecycle: pending → confirming → confirmed → settling → settled.
 *
 * Body (all optional):
 *   amount  - Override the received crypto amount (default: session.cryptoAmount).
 *             Useful for testing underpayment scenarios.
 *   steps   - Stop at a specific status instead of running to settled.
 *             Values: "confirming" | "confirmed" | "settled" (default: "settled")
 *
 * Requires HMAC auth with a sandbox API key (pk_test_...).
 */
router.post(
  '/payments/:reference/simulate-deposit',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const apiKey = req.apiKey!;

      // Only sandbox keys may use this endpoint
      if (!apiKey.isSandbox) {
        return res.status(403).json({
          error: 'This endpoint is only available to sandbox API keys',
          code: 'SANDBOX_ONLY',
        });
      }

      const { reference } = req.params;
      const { amount, steps = 'settled' } = req.body as {
        amount?: number;
        steps?: 'confirming' | 'confirmed' | 'settled';
      };

      // Load session
      const session = await sessionManager.getSessionByReference(reference);

      // Belt-and-suspenders: session must also be sandbox
      if (!session.isSandbox) {
        return res.status(403).json({
          error: 'This payment is not a sandbox session',
          code: 'NOT_SANDBOX_SESSION',
        });
      }

      if (session.status !== 'pending') {
        return res.status(409).json({
          error: 'Payment must be in pending status to simulate a deposit',
          code: 'INVALID_STATUS',
          currentStatus: session.status,
        });
      }

      if (!session.cryptoAmount) {
        return res.status(400).json({
          error: 'Session has no crypto amount — cannot simulate deposit',
          code: 'NO_CRYPTO_AMOUNT',
        });
      }

      const receivedAmount = amount ?? session.cryptoAmount;
      const fakeTxHash = `sandbox_${crypto.randomBytes(16).toString('hex')}`;

      // Step 1: pending → confirming
      await sessionManager.markDeposit(session.id, fakeTxHash, receivedAmount);
      sendPaymentWebhook(session.id, 'payment.confirming').catch(() => {});

      if (steps === 'confirming') {
        const updated = await sessionManager.getSession(session.id);
        return res.json({
          status: true,
          message: 'Deposit simulated — stopped at confirming',
          data: { reference, status: updated.status, txHash: fakeTxHash, receivedAmount },
        });
      }

      // Step 2: confirming → confirmed
      await sessionManager.confirmDeposit(session.id, 1);
      sendPaymentWebhook(session.id, 'payment.confirmed').catch(() => {});

      if (steps === 'confirmed') {
        const updated = await sessionManager.getSession(session.id);
        return res.json({
          status: true,
          message: 'Deposit simulated — stopped at confirmed',
          data: { reference, status: updated.status, txHash: fakeTxHash, receivedAmount },
        });
      }

      // Step 3: confirmed → settling → settled (sandbox short-circuit in settlement service)
      await settlementService.settleSession(session.id);

      const final = await sessionManager.getSession(session.id);
      return res.json({
        status: true,
        message: 'Deposit simulated — payment settled',
        data: { reference, status: final.status, txHash: fakeTxHash, receivedAmount },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
