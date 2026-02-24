import { Router } from 'express';
import { adminAuth } from '../../security/middleware/adminAuth';
import apiKeyRoutes from './apiKey.routes';

const router = Router();

// All admin routes require admin authentication
router.use(adminAuth);

// Mount admin routes
router.use('/api-keys', apiKeyRoutes);

export default router;
