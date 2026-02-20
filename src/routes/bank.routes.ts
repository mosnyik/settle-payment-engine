import { Router, Request, Response, NextFunction } from 'express';
import pool from '../lib/mysql';
import { RowDataPacket } from 'mysql2/promise';

const router = Router();

interface BankName extends RowDataPacket {
  name: string;
  code: string;
}

// POST /banks/resolve
router.post('/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message: extracted } = req.body;

    if (!extracted) {
      return res.status(400).json({ message: 'Bank search word not provided' });
    }

    const [results] = await pool.query<BankName[]>(
      'SELECT * FROM banks WHERE name LIKE ?',
      [`${extracted}%`]
    );

    if (results.length > 0) {
      const bank_names = results.map(
        (row, index) => `${index + 1}. ${row.name} ${row.code}`
      );
      return res.status(200).json({ message: bank_names });
    } else {
      return res.status(404).json({ message: 'Bank not found. Try again' });
    }
  } catch (err: any) {
    console.error('Error querying banks:', err);
    next(err);
  }
});

// GET /banks/list
router.get('/list', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [results] = await pool.query<BankName[]>('SELECT * FROM banks ORDER BY name');

    return res.status(200).json({ banks: results });
  } catch (err: any) {
    console.error('Error querying banks:', err);
    next(err);
  }
});

export default router;
