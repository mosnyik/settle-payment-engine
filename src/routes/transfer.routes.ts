import { Router, Request, Response, NextFunction } from 'express';
import { saveTransferTransaction } from '../services/transaction';
import { transferSchema } from '../validation';

const router = Router();

// POST /transfer/save
router.post('/save', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = transferSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid input',
        details: parsed.error.flatten(),
      });
    }

    const transferId = await saveTransferTransaction(parsed.data);
    return res.status(200).json({ transferId });
  } catch (err: any) {
    next(err);
  }
});

export default router;
