/**
 * Webhook Routes
 *
 * Handles inbound callbacks from settlement providers (Mongoro, Paystack).
 * These are public endpoints — no HMAC auth, but each provider has its own
 * signature verification.
 */

import { Router, Request, Response } from 'express';
import { settlementService } from '../services/payment-engine/settlement/settlement.service';
import { paystackService } from '../services/payment-engine/settlement/paystack.service';
import { MongoroWebhookPayload, PaystackWebhookPayload } from '../services/payment-engine/settlement/types';
import { getClientIp, isIpAllowed } from '../security/middleware/ipWhitelist';
import config from '../config';

const router = Router();

// =============================================================================
// POST /v1/webhooks/mongoro
// =============================================================================
router.post('/mongoro', async (req: Request, res: Response) => {
  // IP allowlist — only accept calls from known Mongoro server IPs.
  // If MONGORO_WEBHOOK_IPS is not configured, skip the check (open during initial setup).
  const allowedIps = config.settlement.mongoro.webhookIps;
  if (allowedIps.length > 0) {
    const clientIp = getClientIp(req);
    if (!isIpAllowed(clientIp, allowedIps)) {
      console.warn(`[Webhook] Mongoro request rejected from unauthorised IP: ${clientIp}`);
      return res.status(401).json({ success: false });
    }
  }

  try {
    const payload = req.body as MongoroWebhookPayload;
    await settlementService.handleWebhook(payload);
    return res.json({ success: true });
  } catch (error) {
    console.error('[Webhook] Mongoro error:', error);
    return res.status(500).json({ success: false });
  }
});

// =============================================================================
// POST /v1/webhooks/paystack
// =============================================================================
router.post('/paystack', async (req: Request, res: Response) => {
  // Verify signature
  const signature = req.headers['x-paystack-signature'] as string;
  const rawBody = JSON.stringify(req.body);

  if (!paystackService.verifyWebhookSignature(rawBody, signature)) {
    console.warn('[Webhook] Paystack signature verification failed');
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  try {
    const payload = req.body as PaystackWebhookPayload;

    // Only handle transfer events
    if (['transfer.success', 'transfer.failed', 'transfer.reversed'].includes(payload.event)) {
      await settlementService.handlePaystackWebhook(payload);
    }

    // Paystack requires a 200 response quickly
    return res.json({ success: true });
  } catch (error) {
    console.error('[Webhook] Paystack error:', error);
    return res.status(500).json({ success: false });
  }
});

export default router;
