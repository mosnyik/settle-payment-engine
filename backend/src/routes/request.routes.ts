import { Router, Request, Response, NextFunction } from 'express';
import pool from '../lib/mysql';
import { saveRequestTransaction } from '../services/transaction';
import { requestSchema, requestUpdateSchema } from '../validation';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const router = Router();

const normalize = (obj: any) =>
  JSON.parse(JSON.stringify(obj, (_, v) => (v === '' ? undefined : v)));

// POST /requests/save
router.post('/save', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = requestSchema.safeParse(normalize(req.body));

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request input',
        details: parsed.error.flatten(),
      });
    }

    const requestId = await saveRequestTransaction(parsed.data);
    return res.status(200).json({ requestId });
  } catch (err: any) {
    next(err);
  }
});

// GET /requests/check
router.get('/check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { request_id } = req.query;

    if (!request_id) {
      return res.status(400).json({ message: 'request_id is required' });
    }

    if (String(request_id).length !== 6) {
      return res.status(400).json({ message: 'request_id must be 6 characters' });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM requests WHERE request_id = ?',
      [request_id]
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

// POST /requests/update (also PATCH, PUT)
router.post('/update', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = requestUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid update input',
        details: parsed.error.flatten(),
      });
    }

    const { request_id, ...fieldsToUpdate } = parsed.data;

    if (Object.keys(fieldsToUpdate).length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    const setClause = Object.keys(fieldsToUpdate)
      .map((field) => `${field} = ?`)
      .join(', ');
    const values = Object.values(fieldsToUpdate);

    const query = `UPDATE requests SET ${setClause} WHERE request_id = ?`;
    const params = [...values, request_id] as (string | number | null)[];

    const [result] = await pool.execute<ResultSetHeader>(query, params);

    if (result.affectedRows > 0) {
      return res.status(200).json({ success: true, message: 'Request updated successfully' });
    } else {
      return res.status(404).json({ message: 'Request not found' });
    }
  } catch (err: any) {
    next(err);
  }
});

router.put('/update', router.stack.find((r) => r.route?.path === '/update')?.route?.stack[0].handle!);
router.patch('/update', router.stack.find((r) => r.route?.path === '/update')?.route?.stack[0].handle!);

export default router;
