import { Router, Request, Response, NextFunction } from 'express';
import pool from '../lib/mysql';
import { RowDataPacket } from 'mysql2/promise';

const router = Router();

interface ExchangeRate extends RowDataPacket {
  current_rate: string | number;
  merchant_rate: string | number;
  profit_rate?: string | number;
}

// GET /rate
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [results] = await pool.execute<ExchangeRate[]>('SELECT * FROM rates');

    if (!results || results.length === 0) {
      return res.status(404).json({ error: 'No rates found' });
    }

    const result = results[0];
    const raw = result.current_rate;
    const array_rate = raw.toString();
    const numRate = Number(array_rate);
    const percentage = 0.8;
    const increase = (percentage / 100) * numRate;
    const rate = numRate - increase;
    const data = rate.toLocaleString();

    return res.status(200).json({ rate: data });
  } catch (err: any) {
    console.error('Error querying the rate from rates:', err);
    next(err);
  }
});

// GET /rate/merchant
router.get('/merchant', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [results] = await pool.query<ExchangeRate[]>('SELECT * FROM rates');

    if (!results || results.length === 0) {
      return res.status(404).json({ error: 'No rates found' });
    }

    const result = results[0];
    const merchantRate = result.merchant_rate;

    return res.status(200).json({ merchantRate });
  } catch (err: any) {
    console.error('Error querying the merchant rate from rates:', err);
    next(err);
  }
});

// GET /rate/all
router.get('/all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [results] = await pool.query<ExchangeRate[]>('SELECT * FROM rates');

    if (!results || results.length === 0) {
      return res.status(404).json({ error: 'No rates found' });
    }

    const result = results[0];

    const parseRate = (value: string | number): number => {
      if (typeof value === 'number') return value;
      return parseFloat(value.toString().replace(/,/g, ''));
    };

    const currentRate = parseRate(result.current_rate);
    const merchantRate = parseRate(result.merchant_rate);
    const profitRate = result.profit_rate ? parseRate(result.profit_rate) : 0;

    // Apply 0.8% adjustment to current rate
    const percentage = 0.8;
    const adjustment = (percentage / 100) * currentRate;
    const adjustedRate = currentRate - adjustment;

    return res.status(200).json({
      rate: adjustedRate.toLocaleString(),
      rateNumeric: adjustedRate,
      merchantRate,
      profitRate,
    });
  } catch (err: any) {
    console.error('Error querying rates:', err);
    next(err);
  }
});

export default router;
