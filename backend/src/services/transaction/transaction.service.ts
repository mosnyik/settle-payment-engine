import mysql from 'mysql2/promise';

export type PayerRow = {
  chat_id?: string;
  customer_phoneNumber?: string;
};

export type ReceiverRow = {
  acct_number?: string;
  bank_name?: string;
  receiver_name?: string;
  receiver_phoneNumber?: string;
  is_vendor?: boolean;
};

export type TransferRow = {
  crypto?: string;
  network?: string;
  estimate_asset?: string;
  amount_payable?: string;
  crypto_amount?: string;
  estimate_amount?: string;
  charges?: string;
  date?: string | Date;
  transfer_id?: string;
  receiver_id?: string;
  payer_id?: string;
  current_rate?: string;
  merchant_rate?: string;
  profit_rate?: string;
  wallet_address?: string;
  status?: string;
  payer?: {
    chat_id?: string;
    customer_phoneNumber?: string;
  };
  receiver?: {
    acct_number?: string;
    bank_name?: string;
    receiver_name?: string;
    receiver_phoneNumber?: string;
    is_vendor?: boolean;
  };
  summary?: {
    transaction_type?: string;
    total_dollar?: string;
    total_naira?: string;
    effort?: string;
    merchant_id?: string;
    ref_code?: string;
    asset_price?: string;
    status?: string;
  };
};

export type GiftRow = {
  gift_id?: string;
  gift_status?: string;
  crypto?: string;
  network?: string;
  estimate_asset?: string;
  estimate_amount?: string;
  amount_payable?: string;
  charges?: string;
  crypto_amount?: string;
  date?: string | Date;
  receiver_id?: number;
  payer_id?: number;
  current_rate?: string;
  merchant_rate?: string;
  profit_rate?: string;
  wallet_address?: string;
  status?: string;
  payer?: {
    chat_id?: string;
    customer_phoneNumber?: string;
  };
  summary?: {
    transaction_type?: string;
    total_dollar?: string;
    total_naira?: string;
    effort?: string;
    merchant_id?: string;
    ref_code?: string;
    asset_price?: string;
    status?: string;
  };
};

export type RequestRow = {
  request_id?: string;
  request_status?: string;
  crypto?: string;
  network?: string;
  estimate_asset?: string;
  estimate_amount?: string;
  amount_payable?: string;
  charges?: string;
  crypto_amount?: string;
  date?: string | Date;
  current_rate?: string;
  merchant_rate?: string;
  profit_rate?: string;
  wallet_address?: string;
  status?: string;
  receiver?: {
    acct_number?: string;
    bank_name?: string;
    receiver_name?: string;
    receiver_phoneNumber?: string;
    is_vendor?: boolean;
  };
  summary?: {
    transaction_type?: string;
    total_dollar?: string;
    total_naira?: string;
    effort?: string;
    merchant_id?: string;
    ref_code?: string;
    asset_price?: string;
    status?: string;
  };
};

export type SummaryRow = {
  total_dollar?: string;
  total_naira?: string;
  effort?: string;
  merchant_id?: string;
  transaction_id?: string;
  ref_code?: string;
  asset_price?: string;
  status?: string;
};

export async function getOrCreatePayer(
  conn: mysql.Connection,
  payerRow: PayerRow
): Promise<number> {
  const [results]: any = await conn.query(
    'SELECT id FROM payers WHERE chat_id = ? OR phone = ? LIMIT 1',
    [payerRow.chat_id, payerRow.customer_phoneNumber]
  );

  if (results.length > 0) {
    return results[0].id;
  }

  const user = {
    chat_id: payerRow.chat_id,
    phone: payerRow.customer_phoneNumber,
  };

  const [insertResult]: any = await conn.query('INSERT INTO payers SET ?', user);

  return insertResult.insertId;
}

export async function getOrCreateReceiver(
  conn: mysql.Connection,
  receiverRow: ReceiverRow
): Promise<number | null> {
  if (!receiverRow.acct_number || !receiverRow.bank_name) return null;

  const [results]: any = await conn.query(
    'SELECT id FROM receivers WHERE bank_account = ? AND bank_name = ? LIMIT 1',
    [receiverRow.acct_number, receiverRow.bank_name]
  );

  if (results.length > 0) {
    return results[0].id;
  }

  const user = {
    bank_name: receiverRow.bank_name,
    bank_account: receiverRow.acct_number,
    account_name: receiverRow.receiver_name ?? null,
    phone: receiverRow.receiver_phoneNumber ?? null,
    is_vendor: receiverRow.is_vendor ?? false,
  };

  const [insertResult]: any = await conn.query('INSERT INTO receivers SET ?', user);

  return insertResult.insertId;
}

export async function insertTransfer(
  conn: mysql.Connection,
  transferDetails: TransferRow,
  receiverId: number,
  payerId: number
): Promise<number> {
  const clean = (val: string) => Number(val?.replace(/[^0-9.]/g, '') || 0);

  const date = new Date(transferDetails.date!);

  const amountMatch = transferDetails.charges?.match(/\d+(\.\d+)?/);
  const chargeAmount = amountMatch ? Number(amountMatch[0]) : 0;

  if (!receiverId || !payerId) {
    throw new Error('Receiver/payer details missing or invalid');
  }

  const transfer = {
    crypto: transferDetails.crypto,
    network: transferDetails.network,
    estimate_asset: transferDetails.estimate_asset!,
    estimate_amount: clean(transferDetails.estimate_amount!),
    amount_payable: clean(transferDetails.amount_payable!),
    charges: chargeAmount,
    crypto_amount: clean(transferDetails.crypto_amount!),
    date,
    receiver_id: receiverId,
    transfer_id: transferDetails.transfer_id!,
    payer_id: payerId,
    current_rate: clean(transferDetails.current_rate!),
    merchant_rate: clean(transferDetails.merchant_rate!),
    profit_rate: clean(transferDetails.profit_rate!),
    wallet_address: transferDetails.wallet_address!,
    status: transferDetails.status,
  };

  const [insertResult]: any = await conn.query('INSERT INTO transfers SET ?', transfer);

  return insertResult.insertId;
}

export async function insertSummary(
  conn: mysql.Connection,
  row: SummaryRow,
  transactionId: number,
  transaction_type: string
): Promise<void> {
  const clean = (val: string) => Number(val?.replace(/[^0-9.]/g, '') || 0);

  const naira = clean(row.total_naira!);
  const dollarAmount = clean(row.total_dollar!);

  const summary = {
    status: row.status,
    transaction_type,
    total_dollar: dollarAmount,
    total_naira: naira,
    transaction_id: transactionId,
    asset_price: row.asset_price ? clean(row.asset_price) : null,
    effort: row.effort ? clean(row.effort) : 0,
    merchant_id: row.merchant_id ? Number(row.merchant_id) : null,
    ref_code: row.ref_code ?? null,
  };

  await conn.query('INSERT INTO summaries SET ?', summary);
}

export async function insertGift(
  conn: mysql.Connection,
  giftDetails: GiftRow,
  payerId: number
): Promise<number> {
  const clean = (val?: string) => Number(val?.replace(/[^0-9.]/g, '') || 0);

  const date = new Date(giftDetails.date!);

  const gift = {
    gift_id: giftDetails.gift_id,
    gift_status: giftDetails.gift_status,
    crypto: giftDetails.crypto,
    network: giftDetails.network,
    estimate_asset: giftDetails.estimate_asset,
    estimate_amount: clean(giftDetails.estimate_amount),
    amount_payable: clean(giftDetails.amount_payable),
    charges: clean(giftDetails.charges),
    crypto_amount: clean(giftDetails.crypto_amount),
    date,
    payer_id: payerId,
    current_rate: clean(giftDetails.current_rate),
    merchant_rate: clean(giftDetails.merchant_rate),
    profit_rate: clean(giftDetails.profit_rate),
    wallet_address: giftDetails.wallet_address,
    status: giftDetails.status,
  };

  const [result]: any = await conn.query('INSERT INTO gifts SET ?', gift);

  return result.insertId;
}

export async function insertRequest(
  conn: mysql.Connection,
  requestDetails: RequestRow,
  receiverId: number | null
): Promise<number> {
  const clean = (val?: string) => Number(val?.replace(/[^0-9.]/g, '') || 0);

  const request = {
    request_id: requestDetails.request_id,
    request_status: requestDetails.request_status,
    crypto: requestDetails.crypto,
    network: requestDetails.network,
    estimate_asset: requestDetails.estimate_asset,
    estimate_amount: clean(requestDetails.estimate_amount),
    amount_payable: clean(requestDetails.amount_payable),
    charges: clean(requestDetails.charges),
    crypto_amount: clean(requestDetails.crypto_amount),
    date: requestDetails.date ? new Date(requestDetails.date) : null,
    receiver_id: receiverId,
    current_rate: clean(requestDetails.current_rate),
    merchant_rate: clean(requestDetails.merchant_rate),
    profit_rate: clean(requestDetails.profit_rate),
    wallet_address: requestDetails.wallet_address,
    status: requestDetails.status,
  };

  const [result]: any = await conn.query('INSERT INTO requests SET ?', request);

  return result.insertId;
}
