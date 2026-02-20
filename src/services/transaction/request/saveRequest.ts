import pool from '../../../lib/mysql';
import {
  getOrCreateReceiver,
  insertRequest,
  insertSummary,
  RequestRow,
} from '../transaction.service';

export const saveRequestTransaction = async (requestObj: RequestRow) => {
  const { receiver, summary } = requestObj;

  if (!receiver) {
    throw new Error('Receiver is required');
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const receiverId = await getOrCreateReceiver(connection, receiver);

    const requestId = await insertRequest(connection, requestObj, receiverId);

    await insertSummary(
      connection,
      summary!,
      parseInt(requestObj.request_id!),
      'request'
    );

    await connection.commit();
    return requestId;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};
