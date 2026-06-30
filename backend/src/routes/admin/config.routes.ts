import { Router, Request, Response } from 'express';
import { platformConfigService } from '../../services/platform-config/platform-config.service';

const router = Router();

// GET /admin/config  — list all config entries
router.get('/', async (_req: Request, res: Response) => {
  try {
    const entries = await platformConfigService.list();
    return res.json({ success: true, config: entries });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /admin/config/:key  — update a single config value
router.put('/:key', async (req: Request, res: Response) => {
  const { key } = req.params;
  const { value, description } = req.body;

  if (value === undefined || value === null || String(value).trim() === '') {
    return res.status(400).json({ success: false, error: '`value` is required' });
  }

  try {
    await platformConfigService.set(key, String(value), description);
    return res.json({ success: true, key, value: String(value) });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
