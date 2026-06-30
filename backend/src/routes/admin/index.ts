import { Router } from 'express';
import { adminAuth } from '../../security/middleware/adminAuth';
import apiKeyRoutes from './apiKey.routes';
import paymentRoutes from './payments.routes';
import auditLogRoutes from './auditLog.routes';
import reportsRoutes from './reports.routes';
import configRoutes from './config.routes';

const router = Router();

// All admin routes require admin authentication
router.use(adminAuth);

// Mount admin routes
router.use('/api-keys', apiKeyRoutes);
router.use('/payments', paymentRoutes);
router.use('/audit-logs', auditLogRoutes);
router.use('/reports', reportsRoutes);
router.use('/config', configRoutes);

export default router;
