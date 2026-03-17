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
import { RateLimitTier } from '../../security/types';

const router = Router();

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const createApiKeySchema = z.object({
  merchantId: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).optional(),
  rateLimitTier: z.enum(['standard', 'premium', 'unlimited']).optional(),
  ipWhitelist: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional().transform(val => val ? new Date(val) : undefined),
});

const updateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  permissions: z.array(z.string()).optional(),
  rateLimitTier: z.enum(['standard', 'premium', 'unlimited']).optional(),
  ipWhitelist: z.array(z.string()).nullable().optional(),
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

    const result = await createApiKey(parsed.data);

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
    const merchantId = req.query.merchantId as string;

    if (!merchantId) {
      return res.status(400).json({
        error: 'merchantId query parameter is required',
        code: 'MISSING_MERCHANT_ID',
      });
    }

    const keys = await listApiKeysByMerchant(merchantId);

    return res.status(200).json({
      status: true,
      data: {
        keys,
        count: keys.length,
      },
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

export default router;
