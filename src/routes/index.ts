import { Router } from 'express';
import transferRoutes from './transfer.routes';
import giftRoutes from './gift.routes';
import requestRoutes from './request.routes';
import transactionRoutes from './transaction.routes';
import rateRoutes from './rate.routes';
import bankRoutes from './bank.routes';
import cryptoRoutes from './crypto.routes';

const router = Router();

// Mount all routes
router.use('/transfer', transferRoutes);
router.use('/gifts', giftRoutes);
router.use('/requests', requestRoutes);
router.use('/transaction', transactionRoutes);
router.use('/rate', rateRoutes);
router.use('/banks', bankRoutes);
router.use('/crypto', cryptoRoutes);

export default router;
