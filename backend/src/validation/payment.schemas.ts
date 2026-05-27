/**
 * Payment Schemas
 *
 * Zod validation schemas for the unified payment routes.
 * These map directly to PaymentEngine's CreatePaymentInput.
 */

import { z } from 'zod';

// =============================================================================
// CONSTANTS
// =============================================================================

const PAYMENT_TYPES = ['transfer', 'gift', 'request', 'merchant', 'bank_confirmation'] as const;
const FIAT_CURRENCIES = ['NGN', 'GHS', 'KES', 'ZAR'] as const;
const CRYPTO_CURRENCIES = ['BTC', 'ETH', 'BNB', 'TRX', 'USDT', 'USDC'] as const;
const NETWORKS = [
  'bitcoin',
  'ethereum',
  'bsc',
  'tron',
  'polygon',
  'base',
  'erc20',
  'bep20',
  'trc20',
] as const;

// =============================================================================
// PARTICIPANT SCHEMAS
// =============================================================================

/**
 * Payer input schema.
 *
 * payer.chatId is also used internally as the session-owner identity for
 * reusable payment-session deposit wallets when a payer is present.
 */
export const payerInputSchema = z.object({
  chatId: z.string().min(1, 'Chat ID is required'),
  phone: z.string().optional(),
  walletAddress: z.string().optional(),
});

/**
 * Receiver input schema.
 * Client provides bankCode (from GET /banks/list or POST /payments/verify-receiver)
 * and accountNumber. accountName and bankName are resolved internally via NUBAN.
 */
export const receiverInputSchema = z.object({
  bankCode: z.string().min(1, 'Bank code is required'),
  accountNumber: z.string().min(1, 'Account number is required'),
  phone: z.string().optional(),
  walletAddress: z.string().optional(),
});

// =============================================================================
// CREATE PAYMENT SCHEMA
// =============================================================================

/** Base payment input (before type-specific validation) */
const basePaymentSchema = z.object({
  type: z.enum(PAYMENT_TYPES),
  fiatAmount: z.number().positive('Fiat amount must be positive').optional(),
  cryptoAmount: z.number().positive('Crypto amount must be positive').optional(),
  fiatCurrency: z.enum(FIAT_CURRENCIES),
  crypto: z.enum(CRYPTO_CURRENCIES).optional(), // Optional for request type (set at fulfillment)
  network: z.enum(NETWORKS).optional(), // Optional for request type (set at fulfillment)
  payer: payerInputSchema.optional(),
  receiver: receiverInputSchema.optional(),
  merchantId: z.string().optional(),
  merchantReference: z.string().optional(),
  callbackUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
  /** Bank's own internal transaction reference (bank_confirmation type only) */
  bankRef: z.string().max(100).optional(),
  /**
   * Required for transfer and gift. Controls which side bears the platform fee.
   * 'fiat'   — charge deducted from fiat payout; receiver gets fiatAmount - charge.
   * 'crypto' — charge added to crypto; receiver gets full fiatAmount (payer sends more).
   * Requests always charge from crypto (set at fulfillment) — do not send for requests.
   */
  chargeFrom: z.enum(['fiat', 'crypto']).optional(),
  /**
   * When true, the payment is recorded as settled immediately.
   * - Sandbox keys: simulates the full lifecycle (pending → … → settled).
   * - Live keys: directly inserts as settled — use this to record manual/external transfers.
   */
  autoSettle: z.boolean().optional(),
  /** Real blockchain tx hash — recorded when autoSettle is true on a live key. */
  txHash: z.string().max(100).optional(),
  /** Your internal settlement/disbursement reference — recorded when autoSettle is true on a live key. */
  settlementReference: z.string().max(100).optional(),
});

/** Create payment schema with type-specific validation */
export const createPaymentSchema = basePaymentSchema.superRefine((data, ctx) => {
  // ---- Amount field presence: at least one of fiatAmount / cryptoAmount required ----
  const hasFiat = data.fiatAmount !== undefined;
  const hasCrypto = data.cryptoAmount !== undefined;

  // Requests are fiat-only — cryptoAmount is never valid
  if ((data.type === 'request') && hasCrypto) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'cryptoAmount is not valid for request type — use fiatAmount instead',
      path: ['cryptoAmount'],
    });
  }

  if (!hasFiat && !hasCrypto) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either fiatAmount or cryptoAmount is required',
      path: ['fiatAmount'],
    });
  }

  // Crypto-first path: fiatAmount absent, cryptoAmount present (not applicable to requests)
  if (!hasFiat && hasCrypto && data.type !== 'request' && data.type !== 'bank_confirmation') {
    if (!data.crypto) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'crypto is required when cryptoAmount is provided',
        path: ['crypto'],
      });
    }
    if (!data.network) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'network is required when cryptoAmount is provided',
        path: ['network'],
      });
    }
  }

  // Validate crypto-network compatibility (only if both are provided)
  const validNetworks: Record<string, string[]> = {
    BTC: ['bitcoin'],
    ETH: ['ethereum'],
    BNB: ['bsc'],
    TRX: ['tron'],
    USDT: ['erc20', 'bep20', 'trc20'],
    USDC: ['erc20', 'bep20'],
  };

  // Type-specific validation
  switch (data.type) {
    case 'transfer':
    case 'gift':
      // Crypto and network are required for transfer and gift
      if (!data.crypto) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Crypto is required for transfers and gifts',
          path: ['crypto'],
        });
      }
      if (!data.network) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Network is required for transfers and gifts',
          path: ['network'],
        });
      }
      break;

    case 'request':
      // Crypto and network are optional for requests (set at fulfillment)
      break;

    case 'merchant':
      break;

    case 'bank_confirmation':
      // Crypto and network are required — bank knows what the customer is sending
      if (!data.crypto) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Crypto is required for bank confirmation payments',
          path: ['crypto'],
        });
      }
      if (!data.network) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Network is required for bank confirmation payments',
          path: ['network'],
        });
      }
      // Payer and receiver are not required — bank manages its own users and fiat disbursement
      break;
  }

  // Validate crypto-network compatibility if both are provided
  if (data.crypto && data.network) {
    if (!validNetworks[data.crypto]?.includes(data.network)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${data.crypto} is not supported on ${data.network}`,
        path: ['network'],
      });
    }
  }

  // Type-specific participant + chargeFrom validation
  switch (data.type) {
    case 'transfer':
      if (!data.payer) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Payer is required for transfers',
          path: ['payer'],
        });
      }
      if (!data.receiver) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Receiver is required for transfers',
          path: ['receiver'],
        });
      }
      if (!data.chargeFrom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "chargeFrom is required for transfers — specify 'fiat' or 'crypto'",
          path: ['chargeFrom'],
        });
      }
      break;

    case 'gift':
      if (!data.payer) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Payer (gift sender) is required',
          path: ['payer'],
        });
      }
      if (data.receiver) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Receiver cannot be set when creating a gift — it is provided when the gift is claimed',
          path: ['receiver'],
        });
      }
      if (!data.chargeFrom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "chargeFrom is required for gifts — specify 'fiat' (deduct fee from payout) or 'crypto' (payer sends extra)",
          path: ['chargeFrom'],
        });
      }
      break;

    case 'request':
      if (!data.receiver) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Receiver (requester) is required',
          path: ['receiver'],
        });
      }
      if (data.payer) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Payer cannot be set when creating a request — it is provided when the request is fulfilled',
          path: ['payer'],
        });
      }
      if (data.chargeFrom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'chargeFrom is not valid for requests — charge is always added to the crypto amount',
          path: ['chargeFrom'],
        });
      }
      break;

    case 'merchant':
      // payer is optional for backwards compatibility. When provided,
      // payer.chatId identifies the customer paying crypto for wallet reuse.
      break;

    case 'bank_confirmation':
      // payer is optional for backwards compatibility. When provided,
      // payer.chatId identifies the person paying crypto for wallet reuse.
      break;
  }
});

// =============================================================================
// VERIFY RECEIVER SCHEMA
// =============================================================================

/**
 * Verify a bank account before creating a payment.
 * NUBAN takes bank code + account number — bank name is looked up internally.
 */
export const verifyReceiverSchema = z.object({
  bankCode: z.string().min(1, 'Bank code is required'),
  accountNumber: z.string().min(1, 'Account number is required'),
});

export type VerifyReceiverInput = z.infer<typeof verifyReceiverSchema>;

// =============================================================================
// GIFT CLAIM SCHEMAS
// =============================================================================

/**
 * Verify step for gift claim is handled by POST /payments/verify-receiver.
 * This schema is kept for the confirm step only.
 *
 * @deprecated verifyGiftClaimSchema — verify step removed; use POST /payments/verify-receiver instead.
 */
// export const verifyGiftClaimSchema = z.object({
//   bankName: z.string().min(1, 'Bank name is required'),
//   accountNumber: z.string().min(1, 'Account number is required'),
// });

/** Confirm gift claim — triggers settlement. Client sends bankCode + accountNumber. */
export const claimGiftSchema = z.object({
  bankCode: z.string().min(1, 'Bank code is required'),
  accountNumber: z.string().min(1, 'Account number is required'),
});

// =============================================================================
// REQUEST FULFILL SCHEMA
// =============================================================================

/** Schema for fulfilling a request (setting payer and crypto details) */
export const fulfillRequestSchema = z
  .object({
    payer: payerInputSchema,
    crypto: z.enum(CRYPTO_CURRENCIES),
    network: z.enum(NETWORKS),
  })
  .superRefine((data, ctx) => {
    // Validate crypto-network compatibility
    const validNetworks: Record<string, string[]> = {
      BTC: ['bitcoin'],
      ETH: ['ethereum'],
      BNB: ['bsc'],
      TRX: ['tron'],
      USDT: ['ethereum', 'erc20', 'bsc', 'bep20', 'tron', 'trc20'],
      USDC: ['ethereum', 'erc20', 'bsc', 'bep20'],
    };

    if (!validNetworks[data.crypto]?.includes(data.network)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${data.crypto} is not supported on ${data.network}`,
        path: ['network'],
      });
    }
  });

// =============================================================================
// QUERY SCHEMAS
// =============================================================================

/** Schema for payment reference path parameter */
export const paymentReferenceSchema = z.object({
  reference: z.string().min(1, 'Reference is required'),
});

/** Schema for payment ID path parameter */
export const paymentIdSchema = z.object({
  id: z.string().min(1, 'Payment ID is required'),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type PayerInput = z.infer<typeof payerInputSchema>;
export type ReceiverInput = z.infer<typeof receiverInputSchema>;
// export type VerifyGiftClaimInput = z.infer<typeof verifyGiftClaimSchema>; // removed with verifyGiftClaimSchema
export type ClaimGiftInput = z.infer<typeof claimGiftSchema>;
export type FulfillRequestInput = z.infer<typeof fulfillRequestSchema>;
