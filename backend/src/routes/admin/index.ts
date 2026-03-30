import { Router } from 'express';
import { adminAuth } from '../../security/middleware/adminAuth';
import apiKeyRoutes from './apiKey.routes';
import paymentRoutes from './payments.routes';
import auditLogRoutes from './auditLog.routes';

const router = Router();

// All admin routes require admin authentication
router.use(adminAuth);

// Mount admin routes
router.use('/api-keys', apiKeyRoutes);
router.use('/payments', paymentRoutes);
router.use('/audit-logs', auditLogRoutes);

export default router;
