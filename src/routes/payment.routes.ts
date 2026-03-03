/**
 * Unified Payment Routes
 *
 * New routes that use the PaymentEngine facade.
 * These will replace the legacy transfer/gift/request routes.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { paymentEngine } from '../services/payment-engine';
import { participantService } from '../services/payment-engine/participant';
import { legacySyncService } from '../services/payment-engine/sync';
import {
  createPaymentSchema,
  claimGiftSchema,
  fulfillRequestSchema,
} from '../validation/payment.schemas';
import { PaymentEngineError } from '../services/payment-engine/errors';

const router = Router();

// =============================================================================
// CREATE PAYMENT
// =============================================================================

/**
 * POST /payments
 *
 * Create a new payment of any type (transfer, gift, request, merchant).
 * Uses PaymentEngine facade for unified handling.
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate input
    const parsed = createPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: parsed.error.flatten(),
      });
    }

    const input = parsed.data;

    // Create payment session via PaymentEngine
    const session = await paymentEngine.createPayment({
      type: input.type,
      fiatAmount: input.fiatAmount,
      fiatCurrency: input.fiatCurrency,
      crypto: input.crypto as any, // Optional for request type
      network: input.network as any, // Optional for request type
      payer: input.payer ? {
        chatId: input.payer.chatId,
        phone: input.payer.phone,
        walletAddress: input.payer.walletAddress,
      } : undefined, // Type-specific validation happens in session manager
      receiver: input.receiver,
      merchantId: input.merchantId,
      merchantReference: input.merchantReference,
      callbackUrl: input.callbackUrl,
      metadata: input.metadata,
    });

    // Link participants if provided
    if (input.payer) {
      const payerId = await participantService.getOrCreatePayer(input.payer);
      await paymentEngine.setPayerId(session.id, payerId);
    }

    if (input.receiver) {
      const receiverId = await participantService.getOrCreateReceiver(input.receiver);
      await paymentEngine.setReceiverId(session.id, receiverId);
    }

    // Sync to legacy tables
    const updatedSession = await paymentEngine.getPayment(session.id);
    await legacySyncService.syncToLegacy(updatedSession);

    return res.status(201).json({
      success: true,
      payment: {
        id: updatedSession.id,
        reference: updatedSession.reference,
        type: updatedSession.type,
        status: updatedSession.status,
        depositAddress: updatedSession.depositAddress,
        cryptoAmount: updatedSession.cryptoAmount,
        crypto: updatedSession.crypto,
        network: updatedSession.network,
        fiatAmount: updatedSession.fiatAmount,
        fiatCurrency: updatedSession.fiatCurrency,
        rate: updatedSession.rate,
        chargeAmount: updatedSession.chargeAmount,
        expiresAt: updatedSession.expiresAt,
      },
    });
  } catch (err) {
    if (err instanceof PaymentEngineError) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message,
        code: err.code,
      });
    }
    next(err);
  }
});

// =============================================================================
// GET PAYMENT
// =============================================================================

/**
 * GET /payments/:reference
 *
 * Get payment by reference (e.g., 2S-XXXXXX).
 */
router.get('/:reference', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({
        success: false,
        error: 'Reference is required',
      });
    }

    const session = await paymentEngine.getPaymentByReference(reference);

    return res.json({
      success: true,
      payment: {
        id: session.id,
        reference: session.reference,
        type: session.type,
        status: session.status,
        depositAddress: session.depositAddress,
        cryptoAmount: session.cryptoAmount,
        crypto: session.crypto,
        network: session.network,
        fiatAmount: session.fiatAmount,
        fiatCurrency: session.fiatCurrency,
        rate: session.rate,
        chargeAmount: session.chargeAmount,
        txHash: session.txHash,
        confirmations: session.confirmations,
        receivedAmount: session.receivedAmount,
        expiresAt: session.expiresAt,
        confirmedAt: session.confirmedAt,
        settledAt: session.settledAt,
      },
    });
  } catch (err) {
    if (err instanceof PaymentEngineError) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message,
        code: err.code,
      });
    }
    next(err);
  }
});

// =============================================================================
// CLAIM GIFT
// =============================================================================

/**
 * POST /payments/gifts/:reference/claim
 *
 * Claim a gift by providing receiver (bank) details.
 * Only works for gift-type payments that don't have a receiver yet.
 */
router.post(
  '/gifts/:reference/claim',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reference } = req.params;

      if (!reference) {
        return res.status(400).json({
          success: false,
          error: 'Reference is required',
        });
      }

      // Validate input
      const parsed = claimGiftSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: parsed.error.flatten(),
        });
      }

      // Get session
      const session = await paymentEngine.getPaymentByReference(reference);

      // Validate it's a gift
      if (session.type !== 'gift') {
        return res.status(400).json({
          success: false,
          error: 'Payment is not a gift',
        });
      }

      // Check if already claimed
      if (session.receiverId) {
        return res.status(400).json({
          success: false,
          error: 'Gift has already been claimed',
        });
      }

      // Create/get receiver and link to session
      const receiverId = await participantService.getOrCreateReceiver(parsed.data.receiver);
      await paymentEngine.setReceiverId(session.id, receiverId);

      // Sync to legacy
      const updatedSession = await paymentEngine.getPayment(session.id);
      await legacySyncService.syncToLegacy(updatedSession);

      return res.json({
        success: true,
        message: 'Gift claimed successfully',
        payment: {
          id: updatedSession.id,
          reference: updatedSession.reference,
          status: updatedSession.status,
          receiverId: updatedSession.receiverId,
        },
      });
    } catch (err) {
      if (err instanceof PaymentEngineError) {
        return res.status(err.statusCode).json({
          success: false,
          error: err.message,
          code: err.code,
        });
      }
      next(err);
    }
  }
);

// =============================================================================
// FULFILL REQUEST
// =============================================================================

/**
 * POST /payments/requests/:reference/fulfill
 *
 * Fulfill a payment request by providing payer details and crypto/network.
 * This locks the rate and calculates crypto amount at fulfillment time.
 * Only works for request-type payments that don't have a payer yet.
 */
router.post(
  '/requests/:reference/fulfill',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reference } = req.params;

      if (!reference) {
        return res.status(400).json({
          success: false,
          error: 'Reference is required',
        });
      }

      // Validate input
      const parsed = fulfillRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: parsed.error.flatten(),
        });
      }

      // Get session
      const session = await paymentEngine.getPaymentByReference(reference);

      // Validate it's a request
      if (session.type !== 'request') {
        return res.status(400).json({
          success: false,
          error: 'Payment is not a request',
        });
      }

      // Check if already fulfilled (has deposit address = already assigned crypto)
      if (session.depositAddress) {
        return res.status(400).json({
          success: false,
          error: 'Request has already been fulfilled',
        });
      }

      // Fulfill request - this locks rate, calculates crypto amount, assigns wallet
      const fulfilledSession = await paymentEngine.fulfillRequest(
        session.id,
        parsed.data.crypto,
        parsed.data.network
      );

      // Create/get payer and link to session
      const payerId = await participantService.getOrCreatePayer(parsed.data.payer);
      await paymentEngine.setPayerId(fulfilledSession.id, payerId);

      // Sync to legacy
      const updatedSession = await paymentEngine.getPayment(fulfilledSession.id);
      await legacySyncService.syncToLegacy(updatedSession);

      return res.json({
        success: true,
        message: 'Request fulfilled successfully',
        payment: {
          id: updatedSession.id,
          reference: updatedSession.reference,
          status: updatedSession.status,
          depositAddress: updatedSession.depositAddress,
          cryptoAmount: updatedSession.cryptoAmount,
          crypto: updatedSession.crypto,
          network: updatedSession.network,
          rate: updatedSession.rate,
          chargeAmount: updatedSession.chargeAmount,
          fiatAmount: updatedSession.fiatAmount,
          fiatCurrency: updatedSession.fiatCurrency,
          expiresAt: updatedSession.expiresAt,
          payerId: updatedSession.payerId,
        },
      });
    } catch (err) {
      if (err instanceof PaymentEngineError) {
        return res.status(err.statusCode).json({
          success: false,
          error: err.message,
          code: err.code,
        });
      }
      next(err);
    }
  }
);

export default router;
