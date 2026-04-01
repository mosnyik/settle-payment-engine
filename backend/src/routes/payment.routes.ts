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
  verifyReceiverSchema,
  claimGiftSchema,
  fulfillRequestSchema,
} from '../validation/payment.schemas';
import { PaymentEngineError } from '../services/payment-engine/errors';
import { requirePermission } from '../security/middleware/authenticate';
import { settlementService } from '../services/payment-engine/settlement/settlement.service';
import { bankService } from '../services/bank/bank.service';

const router = Router();

// =============================================================================
// CREATE PAYMENT
// =============================================================================

/**
 * POST /payments
 *
 * Create a new payment of any type (transfer, gift, request, merchant).
 * Uses PaymentEngine facade for unified handling.
 * Requires 'payment:create' permission.
 */
router.post(
  '/',
  requirePermission('payment:create'),
  async (req: Request, res: Response, next: NextFunction) => {
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

    // Resolve parent wallet from API key for the requested chain
    const apiKey = req.apiKey;
    let parentWallet: string | undefined;
    if (apiKey && input.network) {
      const chain = input.network === 'bitcoin' ? 'bitcoin'
        : (input.network === 'tron' || input.network === 'trc20') ? 'tron'
        : 'ethereum';
      parentWallet = (chain === 'bitcoin' ? apiKey.parentWalletBitcoin
        : chain === 'tron' ? apiKey.parentWalletTron
        : apiKey.parentWalletEthereum) ?? undefined;
    }

    // Resolve receiver via NUBAN before creating session (if provided).
    // bankCode comes from the client (via GET /banks/list or POST /verify-receiver).
    // bankName and accountName are always resolved server-side — never trusted from client.
    let resolvedReceiver: { bankCode: string; accountNumber: string; accountName: string; bankName: string } | undefined;
    if (input.receiver) {
      resolvedReceiver = await bankService.resolveAccount(
        input.receiver.bankCode,
        input.receiver.accountNumber
      );
    }

    // Create payment session via PaymentEngine
    const session = await paymentEngine.createPayment({
      type: input.type,
      fiatAmount: input.fiatAmount,
      cryptoAmount: input.cryptoAmount,
      fiatCurrency: input.fiatCurrency,
      crypto: input.crypto as any,
      network: input.network as any,
      payer: input.payer ? {
        chatId: input.payer.chatId,
        phone: input.payer.phone,
        walletAddress: input.payer.walletAddress,
      } : undefined,
      receiver: resolvedReceiver ? {
        bankCode: resolvedReceiver.bankCode,
        accountNumber: resolvedReceiver.accountNumber,
        accountName: resolvedReceiver.accountName,
        bankName: resolvedReceiver.bankName,
      } : undefined,
      merchantId: input.merchantId,
      merchantReference: input.merchantReference,
      callbackUrl: input.callbackUrl,
      metadata: input.metadata,
      apiKeyId: apiKey?.id,
      fundingWalletIndex: apiKey?.fundingWalletIndex ?? undefined,
      parentWallet,
    });

    // Link participants if provided
    if (input.payer) {
      const payerId = await participantService.getOrCreatePayer(input.payer);
      await paymentEngine.setPayerId(session.id, payerId);
    }

    if (resolvedReceiver) {
      const receiverId = await participantService.getOrCreateReceiver({
        bankCode: resolvedReceiver.bankCode,
        accountNumber: resolvedReceiver.accountNumber,
        accountName: resolvedReceiver.accountName,
        bankName: resolvedReceiver.bankName,
      } as any);
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
  } catch (err: any) {
    if (err instanceof PaymentEngineError) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message,
        code: err.code,
      });
    }
    if (err.message === 'NUBAN_SERVICE_UNAVAILABLE') {
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
    if (err.message?.includes('Could not verify account details')) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

// =============================================================================
// VERIFY RECEIVER
// =============================================================================

/**
 * POST /payments/verify-receiver
 *
 * Resolves a bank account via NUBAN and returns verified details for the
 * client to show the user before creating a payment. No session is created.
 *
 * Requires bankCode (from GET /banks/list) + accountNumber.
 * bankName is auto-looked up from our banks table — NUBAN doesn't return it.
 *
 * Used before:
 *  - POST /payments (type: transfer)  — confirm who you're sending to
 *  - POST /payments (type: request)   — requester confirms their own payout account
 *  - POST /payments/gifts/:ref/claim/confirm — recipient confirms before claiming gift
 */
router.post(
  '/verify-receiver',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = verifyReceiverSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: parsed.error.flatten(),
        });
      }

      const { bankCode, accountNumber } = parsed.data;

      const resolved = await bankService.resolveAccount(bankCode, accountNumber);

      return res.json({
        success: true,
        receiver: {
          accountName: resolved.accountName,
          accountNumber: resolved.accountNumber,
          bankName: resolved.bankName,
          bankCode: resolved.bankCode,
        },
      });
    } catch (err: any) {
      if (err.message === 'NUBAN_SERVICE_UNAVAILABLE') {
        return res.status(500).json({ success: false, error: 'Internal server error' });
      }
      if (err.message?.includes('Could not verify account details')) {
        return res.status(400).json({ success: false, error: err.message });
      }
      next(err);
    }
  }
);

// =============================================================================
// GET PAYMENT
// =============================================================================

/**
 * GET /payments/:reference
 *
 * Get payment by reference (e.g., 2S-XXXXXX).
 * Requires 'payment:read' permission.
 */
router.get(
  '/:reference',
  async (req: Request, res: Response, next: NextFunction) => {
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
// CLAIM GIFT — STEP 1: VERIFY
// =============================================================================

// Removed: POST /payments/gifts/:reference/claim/verify
// Use POST /payments/verify-receiver instead — it serves the same purpose
// (NUBAN lookup + return account details for confirmation) without being
// scoped to a specific gift reference. The confirm step below re-validates
// the session state so nothing is lost.

// =============================================================================
// CLAIM GIFT — STEP 2: CONFIRM
// =============================================================================

/**
 * POST /payments/gifts/:reference/claim/confirm
 *
 * Step 2 of gift claim. Re-resolves bank details via NUBAN (source of truth),
 * creates the receiver record, links to the session, and triggers settlement.
 */
router.post(
  '/gifts/:reference/claim/confirm',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reference } = req.params;

      const parsed = claimGiftSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: parsed.error.flatten(),
        });
      }

      // Re-validate the gift (guard against race conditions)
      const session = await paymentEngine.getPaymentByReference(reference);

      if (session.type !== 'gift') {
        return res.status(400).json({ success: false, error: 'Payment is not a gift' });
      }

      if (session.status !== 'confirmed') {
        return res.status(400).json({ success: false, error: 'Gift has not been paid yet' });
      }

      if (session.receiverId) {
        return res.status(400).json({ success: false, error: 'Gift has already been claimed' });
      }

      // Re-resolve via NUBAN — accountName and bankName always come from server, never from client
      const resolved = await bankService.resolveAccount(
        parsed.data.bankCode,
        parsed.data.accountNumber
      );

      // Create/get receiver using NUBAN-verified details and link to session
      const receiverId = await participantService.getOrCreateReceiver({
        bankCode: resolved.bankCode,
        accountNumber: resolved.accountNumber,
        accountName: resolved.accountName,
        bankName: resolved.bankName,
      } as any);
      await paymentEngine.setReceiverId(session.id, receiverId);

      // Trigger settlement using the creator's API key settlement mode
      settlementService.settleSession(session.id).catch(err =>
        console.error(`[ClaimGift] Settlement error for ${reference}:`, err)
      );

      // Sync to legacy
      const updatedSession = await paymentEngine.getPayment(session.id);
      await legacySyncService.syncToLegacy(updatedSession);

      return res.json({
        success: true,
        message: 'Gift claimed successfully. Payout is being processed.',
        payment: {
          id: updatedSession.id,
          reference: updatedSession.reference,
          status: updatedSession.status,
          receiver: {
            accountName: resolved.accountName,
            accountNumber: resolved.accountNumber,
            bankName: resolved.bankName,
          },
        },
      });
    } catch (err: any) {
      if (err instanceof PaymentEngineError) {
        return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code });
      }
      if (err.message === 'NUBAN_SERVICE_UNAVAILABLE') {
        return res.status(500).json({ success: false, error: 'Internal server error' });
      }
      if (err.message?.includes('Bank not found') || err.message?.includes('Could not verify account details')) {
        return res.status(400).json({ success: false, error: err.message });
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

// =============================================================================
// CONFIRM SELF-SETTLEMENT
// =============================================================================

/**
 * POST /payments/:reference/settle
 *
 * For integrators using settlementMode='self'.
 * Call this after you have sent the fiat to the receiver to mark the payment settled.
 * Requires 'payment:create' permission (same API key that created the payment).
 */
router.post(
  '/:reference/settle',
  requirePermission('payment:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reference } = req.params;
      const { settlementToken, settlementReference } = req.body as {
        settlementToken?: string;
        settlementReference?: string;
      };

      if (!settlementToken) {
        return res.status(400).json({ success: false, error: 'settlementToken is required' });
      }

      const result = await settlementService.confirmSelfSettlement(reference, settlementToken, settlementReference);

      if (!result.success) {
        return res.status(400).json({ success: false, error: result.message });
      }

      return res.json({ success: true, message: result.message });
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
