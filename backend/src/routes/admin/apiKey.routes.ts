import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  createApiKey,
  getApiKeyByKeyId,
  listApiKeysByMerchant,
  updateApiKey,
  updateParentWallets,
  revokeApiKey,
} from '../../security/services/apiKey.service';
import { settlementService } from '../../services/payment-engine/settlement/settlement.service';
import { pool } from '../../lib/mysql';
import { RowDataPacket } from 'mysql2';
import { RateLimitTier } from '../../security/types';

const router = Router();

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const confirmationThresholdsSchema = z
  .record(z.number().int().positive())
  .refine(
    (val) => Object.keys(val).every((k) => ['bitcoin', 'ethereum', 'bsc', 'tron'].includes(k)),
    { message: 'confirmationThresholds keys must be: bitcoin, ethereum, bsc, or tron' }
  )
  .nullable()
  .optional();

const createApiKeySchema = z.object({
  merchantId: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).optional(),
  rateLimitTier: z.enum(['standard', 'premium', 'unlimited']).optional(),
  ipWhitelist: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined),
  settlementMode: z.enum(['mongoro', 'paystack', 'self']).optional(),
  confirmationThresholds: confirmationThresholdsSchema,
});

const updateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  permissions: z.array(z.string()).optional(),
  rateLimitTier: z.enum(['standard', 'premium', 'unlimited']).optional(),
  ipWhitelist: z.array(z.string()).nullable().optional(),
  webhookUrl: z.string().url().nullable().optional(),
  sweepAddress: z.string().nullable().optional(),
  settlementMode: z.enum(['mongoro', 'paystack', 'self']).optional(),
  confirmationThresholds: confirmationThresholdsSchema,
});

// =============================================================================
// ROUTES
// =============================================================================

/**
 * POST /admin/api-keys
 * Create a new API key
 *
 * Body:
 * {
 *   "merchantId": "merchant_001",
 *   "name": "Production Key",
 *   "permissions": ["transfer.*", "gift.*"],  // optional
 *   "rateLimitTier": "standard",              // optional
 *   "ipWhitelist": ["192.168.1.0/24"],        // optional
 *   "expiresAt": "2027-01-01T00:00:00Z"       // optional
 * }
 *
 * Response:
 * {
 *   "apiKey": { keyId, merchantId, name, ... },
 *   "secretKey": "sk_..."  // ONLY RETURNED ONCE
 * }
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createApiKeySchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid input',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      });
    }

    const result = await createApiKey({
      ...parsed.data,
      confirmationThresholds: parsed.data.confirmationThresholds ?? undefined,
    });

    return res.status(201).json({
      status: true,
      message: 'API key created successfully. Save the secretKey - it will not be shown again.',
      data: {
        apiKey: result.apiKey,
        secretKey: result.secretKey,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/api-keys?merchantId=xxx
 * List API keys for a merchant
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const merchantId = req.query.merchantId as string | undefined;

    let keys;
    if (merchantId) {
      keys = await listApiKeysByMerchant(merchantId);
    } else {
      // List all keys across all merchants
      const [rows] = await pool.execute<RowDataPacket[]>(
        'SELECT * FROM api_keys ORDER BY created_at DESC'
      );
      const { listApiKeysByMerchant: _, ...svc } = await import('../../security/services/apiKey.service');
      // Re-use rowToApiKey via full fetch - just map the rows
      keys = rows.map((row) => {
        let permissions: string[] = [];
        if (row.permissions) {
          permissions = typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions;
        }
        let ipWhitelist: string[] | null = null;
        if (row.ip_whitelist) {
          ipWhitelist = typeof row.ip_whitelist === 'string' ? JSON.parse(row.ip_whitelist) : row.ip_whitelist;
        }
        return {
          id: row.id, keyId: row.key_id, merchantId: row.merchant_id, name: row.name,
          permissions, rateLimitTier: row.rate_limit_tier, ipWhitelist,
          isActive: Boolean(row.is_active), expiresAt: row.expires_at,
          createdAt: row.created_at, lastUsedAt: row.last_used_at,
          webhookUrl: row.webhook_url, sweepAddress: row.sweep_address,
          settlementMode: row.settlement_mode ?? 'self',
          fundingWalletIndex: row.funding_wallet_index ?? null,
          fundingWalletBitcoin: row.funding_wallet_bitcoin ?? null,
          fundingWalletEthereum: row.funding_wallet_ethereum ?? null,
          fundingWalletTron: row.funding_wallet_tron ?? null,
          parentWalletBitcoin: row.parent_wallet_bitcoin ?? null,
          parentWalletEthereum: row.parent_wallet_ethereum ?? null,
          parentWalletTron: row.parent_wallet_tron ?? null,
        };
      });
    }

    return res.status(200).json({
      status: true,
      data: { keys, count: keys.length },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/api-keys/:keyId
 * Get a specific API key's details
 */
router.get('/:keyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { keyId } = req.params;

    const apiKey = await getApiKeyByKeyId(keyId);

    if (!apiKey) {
      return res.status(404).json({
        error: 'API key not found',
        code: 'API_KEY_NOT_FOUND',
      });
    }

    // Remove sensitive hash from response
    const { keyHash, ...safeKey } = apiKey;

    return res.status(200).json({
      status: true,
      data: safeKey,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/api-keys/:keyId
 * Update API key settings
 *
 * Body:
 * {
 *   "name": "New Name",                     // optional
 *   "permissions": ["transfer.*"],          // optional
 *   "rateLimitTier": "premium",             // optional
 *   "ipWhitelist": ["10.0.0.0/8"] | null    // optional, null removes whitelist
 * }
 */
router.patch('/:keyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { keyId } = req.params;

    const parsed = updateApiKeySchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid input',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      });
    }

    // Check if key exists
    const existing = await getApiKeyByKeyId(keyId);
    if (!existing) {
      return res.status(404).json({
        error: 'API key not found',
        code: 'API_KEY_NOT_FOUND',
      });
    }

    const updated = await updateApiKey(keyId, {
      name: parsed.data.name,
      permissions: parsed.data.permissions,
      rateLimitTier: parsed.data.rateLimitTier as RateLimitTier | undefined,
      ipWhitelist: parsed.data.ipWhitelist,
      webhookUrl: parsed.data.webhookUrl,
      sweepAddress: parsed.data.sweepAddress,
      settlementMode: parsed.data.settlementMode,
      confirmationThresholds: parsed.data.confirmationThresholds,
    });

    if (!updated) {
      return res.status(404).json({
        error: 'API key not found',
        code: 'API_KEY_NOT_FOUND',
      });
    }

    // Remove sensitive hash from response
    const { keyHash, ...safeKey } = updated;

    return res.status(200).json({
      status: true,
      message: 'API key updated successfully',
      data: safeKey,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /admin/api-keys/:keyId
 * Revoke (deactivate) an API key
 */
router.delete('/:keyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { keyId } = req.params;

    const success = await revokeApiKey(keyId);

    if (!success) {
      return res.status(404).json({
        error: 'API key not found',
        code: 'API_KEY_NOT_FOUND',
      });
    }

    return res.status(200).json({
      status: true,
      message: 'API key revoked successfully',
    });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// WALLET MANAGEMENT
// =============================================================================

const updateParentWalletsSchema = z.object({
  bitcoin: z.string().min(1).optional().nullable(),
  ethereum: z.string().min(1).optional().nullable(),
  tron: z.string().min(1).optional().nullable(),
});

/**
 * GET /admin/api-keys/:keyId/wallets
 * View funding (system-derived) and parent (user-provided) wallets for a key
 */
router.get('/:keyId/wallets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKey = await getApiKeyByKeyId(req.params.keyId);
    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found', code: 'API_KEY_NOT_FOUND' });
    }

    return res.status(200).json({
      status: true,
      data: {
        funding: {
          index: apiKey.fundingWalletIndex,
          bitcoin: apiKey.fundingWalletBitcoin,
          ethereum: apiKey.fundingWalletEthereum,
          tron: apiKey.fundingWalletTron,
          note: 'System-derived wallets. Top these up with native coin (ETH/BNB/TRX) so they can pre-fund gas for token sweeps.',
        },
        parent: {
          bitcoin: apiKey.parentWalletBitcoin,
          ethereum: apiKey.parentWalletEthereum,
          tron: apiKey.parentWalletTron,
          note: 'Your provided destination wallets. Swept funds are sent here.',
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /admin/api-keys/:keyId/wallets
 * Set parent wallet addresses (sweep destinations)
 *
 * Body: { "bitcoin": "bc1q...", "ethereum": "0x...", "tron": "T..." }
 */
router.put('/:keyId/wallets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { keyId } = req.params;

    const parsed = updateParentWalletsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid input',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      });
    }

    const existing = await getApiKeyByKeyId(keyId);
    if (!existing) {
      return res.status(404).json({ error: 'API key not found', code: 'API_KEY_NOT_FOUND' });
    }

    const updated = await updateParentWallets(keyId, {
      bitcoin: parsed.data.bitcoin,
      ethereum: parsed.data.ethereum,
      tron: parsed.data.tron,
    });

    return res.status(200).json({
      status: true,
      message: 'Parent wallets updated successfully',
      data: {
        parentWalletBitcoin: updated?.parentWalletBitcoin,
        parentWalletEthereum: updated?.parentWalletEthereum,
        parentWalletTron: updated?.parentWalletTron,
      },
    });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// MANUAL SETTLEMENT
// =============================================================================

/**
 * POST /admin/sessions/:reference/settle
 * Manually mark a session as settled (for stuck or self-settlement-mode payments).
 */
router.post('/sessions/:reference/settle', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reference } = req.params;
    const { settlementReference } = req.body as { settlementReference?: string };

    const result = await settlementService.manualSettle(reference);

    if (!result.success) {
      return res.status(400).json({ error: result.message, code: 'SETTLE_FAILED' });
    }

    return res.json({ status: true, message: result.message });
  } catch (err) {
    next(err);
  }
});

export default router;
