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

const PAYMENT_TYPES = ['transfer', 'gift', 'request', 'merchant'] as const;
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

/** Payer input schema */
export const payerInputSchema = z.object({
  chatId: z.string().min(1, 'Chat ID is required'),
  phone: z.string().optional(),
  walletAddress: z.string().optional(),
});

/** Receiver input schema */
export const receiverInputSchema = z.object({
  bankCode: z.string().min(1, 'Bank code is required'),
  accountNumber: z.string().min(1, 'Account number is required'),
  accountName: z.string().min(1, 'Account name is required'),
  phone: z.string().optional(),
});

// =============================================================================
// CREATE PAYMENT SCHEMA
// =============================================================================

/** Base payment input (before type-specific validation) */
const basePaymentSchema = z.object({
  type: z.enum(PAYMENT_TYPES),
  fiatAmount: z.number().positive('Fiat amount must be positive'),
  fiatCurrency: z.enum(FIAT_CURRENCIES),
  crypto: z.enum(CRYPTO_CURRENCIES).optional(), // Optional for request type (set at fulfillment)
  network: z.enum(NETWORKS).optional(), // Optional for request type (set at fulfillment)
  payer: payerInputSchema.optional(),
  receiver: receiverInputSchema.optional(),
  merchantId: z.string().optional(),
  merchantReference: z.string().optional(),
  callbackUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/** Create payment schema with type-specific validation */
export const createPaymentSchema = basePaymentSchema.superRefine((data, ctx) => {
  // Validate crypto-network compatibility (only if both are provided)
  const validNetworks: Record<string, string[]> = {
    BTC: ['bitcoin'],
    ETH: ['ethereum'],
    BNB: ['bsc'],
    TRX: ['tron'],
    USDT: ['ethereum', 'erc20', 'bsc', 'bep20', 'tron', 'trc20'],
    USDC: ['ethereum', 'erc20', 'bsc', 'bep20'],
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
      // No validation needed here
      break;

    case 'merchant':
      // Merchant payments may have different requirements
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

  // Type-specific participant validation
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
      break;

    case 'gift':
      if (!data.payer) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Payer (gift sender) is required',
          path: ['payer'],
        });
      }
      // Receiver is optional - set when gift is claimed
      break;

    case 'request':
      if (!data.receiver) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Receiver (requester) is required',
          path: ['receiver'],
        });
      }
      // Payer is optional - set when request is fulfilled
      // Crypto/network optional - set when request is fulfilled
      break;

    case 'merchant':
      // Merchant payments may have different requirements
      break;
  }
});

// =============================================================================
// GIFT CLAIM SCHEMA
// =============================================================================

/** Schema for claiming a gift (setting receiver) */
export const claimGiftSchema = z.object({
  receiver: receiverInputSchema,
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
export type ClaimGiftInput = z.infer<typeof claimGiftSchema>;
export type FulfillRequestInput = z.infer<typeof fulfillRequestSchema>;
