import pool from '../../../lib/mysql';
import {
  getOrCreatePayer,
  getOrCreateReceiver,
  insertSummary,
  insertTransfer,
  TransferRow,
} from '../transaction.service';

export const saveTransferTransaction = async (transferObj: TransferRow) => {
  const connection = await pool.getConnection();

  const { payer, receiver, summary } = transferObj;

  if (!payer) {
    throw new Error('Payer is required');
  }

  if (!receiver) {
    throw new Error('Receiver is required');
  }

  try {
    await connection.beginTransaction();

    const payerId = await getOrCreatePayer(connection, payer);

    const receiverId = await getOrCreateReceiver(connection, receiver);

    if (!receiverId) {
      throw new Error('Invalid receiver details');
    }

    const transferId = await insertTransfer(
      connection,
      transferObj,
      receiverId,
      payerId
    );

    await insertSummary(connection, summary!, parseInt(transferObj.transfer_id!), 'transfer');

    await connection.commit();
    return transferId;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};
