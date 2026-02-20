import { Router, Request, Response, NextFunction } from 'express';
import pool from '../lib/mysql';
import { saveGiftTransaction, getOrCreateReceiver } from '../services/transaction';
import { giftSchema, giftUpdateSchema } from '../validation';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import axios from 'axios';
import config from '../config';

const router = Router();

// POST /gifts/save
router.post('/save', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = giftSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid gift input',
        details: parsed.error.flatten(),
      });
    }

    const giftId = await saveGiftTransaction(parsed.data);
    return res.status(200).json({ giftId });
  } catch (err: any) {
    next(err);
  }
});

// GET /gifts/check
router.get('/check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gift_id } = req.query;

    if (!gift_id) {
      return res.status(400).json({ message: 'gift_id is required' });
    }

    if (String(gift_id).length !== 6) {
      return res.status(400).json({ message: 'gift_id must be 6 characters' });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM gifts WHERE gift_id = ?',
      [gift_id]
    );

    if (rows.length > 0) {
      return res.status(200).json({ exists: true, user: rows[0] });
    } else {
      return res.status(200).json({ exists: false });
    }
  } catch (err: any) {
    next(err);
  }
});

// POST /gifts/update
router.post('/update', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = giftUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid update input',
        details: parsed.error.flatten(),
      });
    }

    const { gift_id, receiver, giftUpdates } = parsed.data;

    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const updates: Record<string, unknown> = { ...(giftUpdates as object) };

      if (receiver) {
        const receiverId = await getOrCreateReceiver(conn, receiver);

        if (receiverId === null) {
          throw new Error('Invalid receiver details');
        }

        updates.receiver_id = receiverId;
      }

      const setClause = Object.keys(updates)
        .map((field) => `${field} = ?`)
        .join(', ');

      const values = Object.values(updates);

      const query = `UPDATE gifts SET ${setClause} WHERE gift_id = ?`;
      const params = [...values, gift_id] as (string | number | null)[];

      const [result] = await conn.execute<ResultSetHeader>(query, params);

      if (result.affectedRows === 0) {
        throw new Error('Gift not found');
      }

      await conn.commit();

      return res.status(200).json({ message: 'Gift updated successfully' });
    } catch (err: any) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    next(err);
  }
});

// GET /gifts/confirm
router.get('/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gift_id } = req.query;

    if (!gift_id) {
      return res.status(400).json({ message: 'gift_id is required' });
    }

    const query = `
      SELECT *
      FROM gifts
      WHERE gift_id = ?
        AND status IN ('Successful', 'Processing', 'UnSuccessful', 'Uncompleted', 'cancel')
        AND gift_status IN ('pending', 'Not claimed', 'Claimed')
    `;

    const [rows] = await pool.query<RowDataPacket[]>(query, [gift_id]);

    if (rows.length > 0) {
      const result = rows.map((row) => ({
        status: row.status,
        gift_status: row.gift_status,
        transaction: row,
      }));

      return res.status(200).json({ exists: true, transactions: result });
    } else {
      return res.status(200).json({ exists: false });
    }
  } catch (err: any) {
    next(err);
  }
});

// POST /gifts/payout
router.post('/payout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      accountNumber,
      accountBank,
      bankName,
      accountName,
      amount,
      narration,
    } = req.body;

    if (!accountNumber || !accountBank || !bankName || !accountName || !narration) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const mongoroTransferUrl = 'https://api-biz-dev.mongoro.com/api/v1/openapi/transfer';

    const user = {
      accountNumber,
      accountBank,
      bankName,
      amount,
      saveBeneficiary: false,
      accountName,
      narration,
      currency: 'NGN',
      callbackUrl: 'http://localhost:3000/payment/success',
      debitCurrency: 'NGN',
      pin: config.mongoro.transferPin,
    };

    const response = await axios.post(mongoroTransferUrl, user, {
      headers: {
        'Content-Type': 'application/json',
        token: config.mongoro.token,
      },
    });

    return res.status(200).json({ message: 'Transaction successful', data: response.data });
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        return res.status(error.response.status).json({
          message: error.response.data.message || 'Error',
          error: error.response.data,
        });
      } else {
        return res.status(500).json({ message: 'Internal Server Error', error: error.message });
      }
    }
    next(error);
  }
});

export default router;
