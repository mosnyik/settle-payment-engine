import { Router } from 'express';
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
router.use('/payments', paymentRoutes);

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

// Admin routes (uses separate admin auth, not HMAC)
router.use('/admin', adminRoutes);

export default router;
