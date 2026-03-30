import { Router, Request, Response } from 'express';
import { getApiKeyByKeyId } from '../security/services/apiKey.service';
import { sha256 } from '../security/utils/crypto';

const router = Router();

/**
 * POST /v1/auth/login
 *
 * Validate API key credentials and return key details.
 * Used by the dashboard to establish a session.
 *
 * Body: { publicKey: string, secretKey: string }
 */
router.post('/login', async (req: Request, res: Response) => {
  const { publicKey, secretKey } = req.body ?? {};

  if (!publicKey || typeof publicKey !== 'string' ||
      !secretKey || typeof secretKey !== 'string') {
    return res.status(400).json({ error: 'publicKey and secretKey are required' });
  }

  const apiKey = await getApiKeyByKeyId(publicKey).catch(() => null);

  // Use same error for both "not found" and "wrong secret" to prevent key enumeration
  if (!apiKey || !apiKey.isActive || sha256(secretKey) !== apiKey.keyHash) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Strip server-only fields before returning
  const { keyHash, webhookSecret, ...safe } = apiKey;

  return res.json({ success: true, data: { apiKey: safe } });
});

export default router;
