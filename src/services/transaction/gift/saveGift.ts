import pool from '../../../lib/mysql';
import {
  getOrCreatePayer,
  GiftRow,
  insertGift,
  insertSummary,
} from '../transaction.service';

export const saveGiftTransaction = async (giftObj: GiftRow) => {
  const { payer, summary } = giftObj;

  if (!payer) {
    throw new Error('Payer is required');
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const payerId = await getOrCreatePayer(connection, payer);

    if (!payerId) {
      throw new Error('Invalid payer details');
    }

    const giftId = await insertGift(connection, giftObj, payerId);

    await insertSummary(connection, summary!, parseInt(giftObj.gift_id!), 'gift');

    await connection.commit();
    return giftId;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};
