import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import pool from '../lib/mysql';
import { RowDataPacket } from 'mysql2/promise';
import config from '../config';

const router = Router();

interface BankName extends RowDataPacket {
  name: string;
  code: string;
}

interface BankDetails {
  bank_name: string;
  account_name: string;
  account_number: string;
  bank_code: string;
}

// POST /banks/resolve - Resolve bank account details via Nuban API
router.post('/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bank_code, account_number } = req.body;

    if (!bank_code || !account_number) {
      return res.status(400).json({ message: 'bank_code and account_number are required' });
    }

    const response = await axios.get<BankDetails[]>(
      `https://app.nuban.com.ng/api/${config.nubanApiKey}?bank_code=${bank_code}&acc_no=${account_number}`
    );

    if (response.data && response.data.length > 0) {
      return res.status(200).json({ data: response.data[0] });
    } else {
      return res.status(404).json({ message: 'Account not found' });
    }
  } catch (err: any) {
    if (axios.isAxiosError(err)) {
      console.error('NUBAN API ERROR:', {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
      });
      return res.status(err.response?.status || 500).json({
        message: 'Failed to resolve bank account'
      });
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

    const [results] = await pool.query<BankName[]>(
      'SELECT * FROM banks WHERE name LIKE ?',
      [`${name}%`]
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

export default router;
