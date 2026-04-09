import { Router } from 'express';
import timeout from 'connect-timeout';
import transferRoutes from './transfer.routes';
import giftRoutes from './gift.routes';
import requestRoutes from './request.routes';
import transactionRoutes from './transaction.routes';
import rateRoutes from './rate.routes';
import bankRoutes from './bank.routes';
import cryptoRoutes from './crypto.routes';
import adminRoutes from './admin';
import paymentRoutes from './payment.routes';
import walletRoutes from './wallet.routes';
import authRoutes from './auth.routes';
import meRoutes from './me.routes';
import historyRoutes from './history.routes';
import webhookRoutes from './webhook.routes';
import sandboxRoutes from './sandbox.routes';
import {
  deprecateTransferRoutes,
  deprecateGiftRoutes,
  deprecateRequestRoutes,
  deprecateTransactionRoutes,
} from '../middleware/deprecation';

const router = Router();

// =============================================================================
// NEW UNIFIED ROUTES (preferred)
// =============================================================================
// Payment routes — 30s timeout (creation involves rate fetch + wallet derivation + settlement)
router.use('/payments', timeout('30s'), paymentRoutes);

// =============================================================================
// WALLET-AS-A-SERVICE ROUTES
// =============================================================================
router.use('/wallets', walletRoutes);

// =============================================================================
// LEGACY ROUTES (deprecated - use /payments instead)
// =============================================================================
router.use('/transfer', deprecateTransferRoutes, transferRoutes);
router.use('/gifts', deprecateGiftRoutes, giftRoutes);
router.use('/requests', deprecateRequestRoutes, requestRoutes);
router.use('/transaction', deprecateTransactionRoutes, transactionRoutes);

// =============================================================================
// OTHER ROUTES
// =============================================================================
router.use('/rate', rateRoutes);
router.use('/banks', bankRoutes);
router.use('/crypto', cryptoRoutes);

// Webhook routes — 30s timeout (provider callbacks may include settlement processing)
router.use('/webhooks', timeout('30s'), webhookRoutes);

// Admin routes (uses separate admin auth, not HMAC)
router.use('/admin', adminRoutes);

// Auth routes (public - login with API key credentials)
router.use('/auth', authRoutes);

// Me routes (HMAC-authenticated, user-scoped)
router.use('/me', meRoutes);

// Unified transaction history (legacy + payment engine)
router.use('/history', historyRoutes);

// Sandbox routes — only usable by pk_test_ API keys
router.use('/sandbox', sandboxRoutes);

export default router;
