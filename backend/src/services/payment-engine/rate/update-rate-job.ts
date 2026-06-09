import axios from 'axios';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from '../../../lib/mysql';

// const CRYPTOCOMPARE_USDT_NGN_URL =
//   'https://min-api.cryptocompare.com/data/price?fsym=USDT&tsyms=NGN';

const COINGECKO_USDT_NGN_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=ngn';
const REQUEST_TIMEOUT_MS = 10000;

interface RateRow extends RowDataPacket {
  id: number;
  profit_rate: string | number | null;
}

// interface CryptoCompareResponse {
//   NGN?: number;
// }

interface CoinGeckoResponse {
  tether?: { ngn?: number };
}

export interface RateUpdateResult {
  rateId: number;
  currentRate: number;
  merchantRate: number;
  profitRate: number;
}

function parseRate(value: string | number | null, fieldName: string): number {
  if (value === null) {
    return 0;
  }

  const parsed =
    typeof value === 'number'
      ? value
      : parseFloat(value.toString().replace(/,/g, ''));

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${fieldName} value: ${value}`);
  }

  return parsed;
}

async function fetchLiveRate(): Promise<number> {
  // --- CoinGecko (free, no API key required) ---
  const response = await axios.get<CoinGeckoResponse>(COINGECKO_USDT_NGN_URL, {
    timeout: REQUEST_TIMEOUT_MS,
  });

  const liveRate = response.data?.tether?.ngn;

  if (typeof liveRate !== 'number' || !Number.isFinite(liveRate)) {
    throw new Error('CoinGecko response did not contain a valid NGN rate');
  }

  return Number(liveRate.toFixed(2));

  // --- CryptoCompare / CoinDesk (commented out — requires paid plan as of mid-2025) ---
  // const response = await axios.get<CryptoCompareResponse>(CRYPTOCOMPARE_USDT_NGN_URL, {
  //   timeout: REQUEST_TIMEOUT_MS,
  // });
  // const liveRate = response.data?.NGN;
  // if (typeof liveRate !== 'number' || !Number.isFinite(liveRate)) {
  //   throw new Error('CryptoCompare response did not contain a valid NGN rate');
  // }
  // return Number(liveRate.toFixed(2));
}

export async function updateRateJob(rateId: number = 1): Promise<RateUpdateResult> {
  const currentRate = await fetchLiveRate();

  const [rows] = await pool.execute<RateRow[]>(
    'SELECT id, profit_rate FROM rates WHERE id = ? LIMIT 1',
    [rateId]
  );

  if (!rows.length) {
    throw new Error(`No rates row found for id=${rateId}`);
  }

  const profitRate = parseRate(rows[0].profit_rate, 'profit_rate');
  const merchantRate = Number((currentRate + profitRate).toFixed(2));

  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE rates
     SET current_rate = ?, merchant_rate = ?, update_at = UTC_TIMESTAMP() + INTERVAL 1 HOUR
     WHERE id = ?`,
    [currentRate, merchantRate, rateId]
  );

  if (result.affectedRows !== 1) {
    throw new Error(`Expected to update 1 row for id=${rateId}, updated ${result.affectedRows}`);
  }

  return {
    rateId,
    currentRate,
    merchantRate,
    profitRate,
  };
}
