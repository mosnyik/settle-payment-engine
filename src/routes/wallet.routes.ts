/**
 * Wallet-as-a-Service Routes
 *
 * API endpoints for external developers to generate and manage
 * HD wallet addresses with deposit monitoring.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { walletService, WalletServiceError } from '../services/wallet-api';
import {
  createWalletSchema,
  listWalletsSchema,
  walletIdSchema,
} from '../validation/wallet.schemas';
import { requirePermission } from '../security/middleware/authenticate';

const router = Router();

// =============================================================================
// CREATE WALLET
// =============================================================================

/**
 * POST /wallets
 *
 * Generate a new HD wallet address for monitoring deposits.
 * Requires 'wallet:create' permission.
 */
router.post(
  '/',
  requirePermission('wallet:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate input
      const parsed = createWalletSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: parsed.error.flatten(),
        });
      }

      // Create wallet
      const wallet = await walletService.createWallet(req.apiKey!.id, {
        network: parsed.data.network,
        crypto: parsed.data.crypto,
        metadata: parsed.data.metadata,
        expiresInMinutes: parsed.data.expiresInMinutes,
      });

      return res.status(201).json({
        success: true,
        wallet: {
          id: wallet.id,
          address: wallet.address,
          network: wallet.network,
          crypto: wallet.crypto,
          status: wallet.status,
          createdAt: wallet.createdAt,
          expiresAt: wallet.expiresAt,
          metadata: wallet.metadata,
        },
      });
    } catch (err) {
      if (err instanceof WalletServiceError) {
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
// GET WALLET
// =============================================================================

/**
 * GET /wallets/:id
 *
 * Get wallet details by ID.
 * Requires 'wallet:read' permission.
 */
router.get(
  '/:id',
  requirePermission('wallet:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate ID
      const paramsParsed = walletIdSchema.safeParse(req.params);
      if (!paramsParsed.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid wallet ID',
          details: paramsParsed.error.flatten(),
        });
      }

      // Get wallet
      const wallet = await walletService.getWallet(
        paramsParsed.data.id,
        req.apiKey!.id
      );

      return res.json({
        success: true,
        wallet: {
          id: wallet.id,
          address: wallet.address,
          network: wallet.network,
          crypto: wallet.crypto,
          status: wallet.status,
          txHash: wallet.txHash,
          amount: wallet.amount,
          confirmations: wallet.confirmations,
          detectedAt: wallet.detectedAt,
          confirmedAt: wallet.confirmedAt,
          sweepTxHash: wallet.sweepTxHash,
          sweptAt: wallet.sweptAt,
          createdAt: wallet.createdAt,
          expiresAt: wallet.expiresAt,
          metadata: wallet.metadata,
        },
      });
    } catch (err) {
      if (err instanceof WalletServiceError) {
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
// LIST WALLETS
// =============================================================================

/**
 * GET /wallets
 *
 * List wallets for the authenticated API key.
 * Requires 'wallet:read' permission.
 */
router.get(
  '/',
  requirePermission('wallet:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate query params
      const queryParsed = listWalletsSchema.safeParse(req.query);
      if (!queryParsed.success) {
        return res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: queryParsed.error.flatten(),
        });
      }

      // List wallets
      const wallets = await walletService.listWallets(req.apiKey!.id, {
        status: queryParsed.data.status,
        limit: queryParsed.data.limit,
        offset: queryParsed.data.offset,
      });

      return res.json({
        success: true,
        wallets: wallets.map((w) => ({
          id: w.id,
          address: w.address,
          network: w.network,
          crypto: w.crypto,
          status: w.status,
          amount: w.amount,
          confirmations: w.confirmations,
          createdAt: w.createdAt,
          expiresAt: w.expiresAt,
        })),
        pagination: {
          limit: queryParsed.data.limit,
          offset: queryParsed.data.offset,
          returned: wallets.length,
        },
      });
    } catch (err) {
      if (err instanceof WalletServiceError) {
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
