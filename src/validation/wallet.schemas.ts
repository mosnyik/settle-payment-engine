/**
 * Wallet API Validation Schemas
 */

import { z } from 'zod';

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

/**
 * Create wallet request schema
 */
export const createWalletSchema = z
  .object({
    network: z.enum(NETWORKS),
    crypto: z.enum(CRYPTO_CURRENCIES),
    metadata: z.record(z.unknown()).optional(),
    expiresInMinutes: z.number().min(1).max(43200).optional(), // Max 30 days
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

/**
 * List wallets query schema
 */
export const listWalletsSchema = z.object({
  status: z
    .enum(['watching', 'deposit_detected', 'confirmed', 'swept', 'expired'])
    .optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

/**
 * Wallet ID parameter schema
 */
export const walletIdSchema = z.object({
  id: z.string().startsWith('wal_', 'Invalid wallet ID format'),
});

// Type exports
export type CreateWalletInput = z.infer<typeof createWalletSchema>;
export type ListWalletsQuery = z.infer<typeof listWalletsSchema>;
