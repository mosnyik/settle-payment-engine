import { Router, Request, Response, NextFunction } from 'express';
import { bankService } from '../services/bank/bank.service';

const router = Router();

// POST /banks/resolve - Resolve bank account details via NUBAN
router.post('/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bank_code, account_number } = req.body;


    if (!bank_code || !account_number) {
      return res.status(400).json({ message: 'bank_code and account_number are required' });
    }

    const result = await bankService.resolveAccount(bank_code, account_number, '');

    return res.status(200).json({ data: result });
  } catch (err: any) {
    if (err.message === 'Account not found') {
      return res.status(404).json({ message: 'Account not found' });
    }
    if (err.message?.includes('NUBAN_API_KEY')) {
      return res.status(500).json({ message: 'Bank resolution service not configured' });
    }
    console.error('Error resolving bank account:', err);
    next(err);
  }
});

// GET /banks/list - Search banks by name
router.get('/list', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.query;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'Bank name query parameter is required' });
    }

    const banks = await bankService.searchBanks(name);

    if (banks.length === 0) {
      return res.status(404).json({ message: 'Bank not found. Try again' });
    }

    const bank_names = banks.map((b, i) => `${i + 1}. ${b.name} ${b.code}`);
    return res.status(200).json({ message: bank_names });
  } catch (err: any) {
    console.error('Error querying banks:', err);
    next(err);
  }
});

export default router;
