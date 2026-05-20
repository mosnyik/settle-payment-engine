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
import { telegramService } from '../services/payment-engine/settlement/telegram.service';
import { MongoroWebhookPayload, PaystackWebhookPayload } from '../services/payment-engine/settlement/types';
import { getClientIp, isIpAllowed } from '../security/middleware/ipWhitelist';
import config from '../config';

const router = Router();

function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

// =============================================================================
// POST /v1/webhooks/telegram
// =============================================================================
router.post('/telegram', async (req: Request, res: Response) => {
  if (!config.settlement.telegram.enabled) {
    console.warn('[Webhook] Telegram request rejected because Telegram alerts are disabled');
    return res.status(503).json({ success: false });
  }

  const webhookSecret = config.settlement.telegram.webhookSecret;
  if (!webhookSecret) {
    console.warn('[Webhook] Telegram request rejected because TELEGRAM_WEBHOOK_SECRET is not configured');
    return res.status(503).json({ success: false });
  }

  const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (receivedSecret !== webhookSecret) {
    console.warn('[Webhook] Telegram request rejected due to invalid secret token');
    return res.status(401).json({ success: false });
  }

  try {
    const callbackQuery = req.body?.callback_query;
    if (!callbackQuery) {
      return res.json({ success: true });
    }

    const callbackQueryId = callbackQuery.id as string | undefined;
    const callbackData = callbackQuery.data as string | undefined;
    const message = callbackQuery.message;
    const chatId = message?.chat?.id;
    const messageId = message?.message_id as number | undefined;

    if (!callbackQueryId || !callbackData) {
      return res.json({ success: true });
    }

    if (chatId === undefined || String(chatId) !== String(config.settlement.telegram.chatId)) {
      await telegramService.answerCallbackQuery(callbackQueryId, 'This settlement action is not allowed here.', true);
      return res.json({ success: true });
    }

    const settleMatch = callbackData.match(/^settle:(.+)$/);
    if (settleMatch) {
      const reference = settleMatch[1];
      const escapedReference = escapeTelegramHtml(reference);
      const result = await settlementService.manualSettle(reference);

      if (result.success) {
        await telegramService.answerCallbackQuery(callbackQueryId, 'Settlement marked as completed.');
        if (messageId !== undefined) {
          await telegramService.editMessageReplyMarkup(chatId, messageId);
        }
        await telegramService.sendMessage(`<b>Manual settlement completed</b>\n\n<b>Session:</b> ${escapedReference}`);
      } else {
        await telegramService.answerCallbackQuery(callbackQueryId, result.message, true);
      }

      return res.json({ success: true });
    }

    await telegramService.answerCallbackQuery(callbackQueryId, 'Unknown settlement action.', true);
    return res.json({ success: true });
  } catch (error) {
    console.error('[Webhook] Telegram error:', error);
    return res.status(500).json({ success: false });
  }
});

export default router;
