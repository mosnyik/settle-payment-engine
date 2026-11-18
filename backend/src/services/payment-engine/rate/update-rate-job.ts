import axios from 'axios';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from '../../../lib/mysql';
import config from '../../../config';
import { fetchQuidaxBuyPrice } from './quidax';
import { describeQuidaxError, recordQuidaxFailure } from './quidax-failure-alerts';

const COINGECKO_USDT_NGN_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=ngn';
const REQUEST_TIMEOUT_MS = 10000;

interface RateRow extends RowDataPacket {
  id: number;
  profit_rate: string | number | null;
}

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

async function fetchFromCoinMarketCap(): Promise<number> {
  const response = await axios.get(
    'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest',
    {
      params: { symbol: 'USDT', convert: 'NGN' },
      headers: { 'X-CMC_PRO_API_KEY': config.coinmarketcap.apiKey },
      timeout: REQUEST_TIMEOUT_MS,
    }
  );

  const rate = response.data?.data?.USDT?.quote?.NGN?.price;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error('CoinMarketCap response did not contain a valid NGN rate');
  }
  return rate;
}

async function fetchFromCoinGecko(): Promise<number> {
  const response = await axios.get<CoinGeckoResponse>(COINGECKO_USDT_NGN_URL, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { Accept: 'application/json' },
  });

  const liveRate = response.data?.tether?.ngn;

  if (typeof liveRate !== 'number' || !Number.isFinite(liveRate) || liveRate <= 0) {
    throw new Error('CoinGecko response did not contain a valid NGN rate');
  }

  return liveRate;
}

/**
 * USDT/NGN rate: Quidax `usdtngn` buy price, falling back to CoinMarketCap,
 * then CoinGecko.
 */
async function fetchLiveRate(): Promise<number> {
  const sources: Array<[string, () => Promise<number>]> = [
    ['Quidax', () => fetchQuidaxBuyPrice('usdtngn')],
    ['CoinMarketCap', fetchFromCoinMarketCap],
    ['CoinGecko', fetchFromCoinGecko],
  ];

  const errors: string[] = [];
  let quidaxReason: string | undefined;
  const reportQuidax = (fallback: string) => {
    if (quidaxReason !== undefined) {
      recordQuidaxFailure({ market: 'usdtngn', source: 'USDT/NGN rate updater', reason: quidaxReason, fallback });
    }
  };

  for (const [name, fetchRate] of sources) {
    try {
      const rate = await fetchRate();
      if (errors.length) {
        console.warn(`[UpdateRateJob] Using ${name} rate after failures: ${errors.join('; ')}`);
      }
      reportQuidax(
        `${name} succeeded (${rate.toFixed(2)})` + (errors.length > 1 ? ` after: ${errors.slice(1).join('; ')}` : ''),
      );
      return Number(rate.toFixed(2));
    } catch (error) {
      const reason = describeQuidaxError(error);
      if (name === 'Quidax') quidaxReason = reason;
      errors.push(`${name}: ${reason}`);
    }
  }

  reportQuidax(`All fallbacks failed too: ${errors.slice(1).join('; ')} — rate NOT updated`);
  throw new Error(`All USDT/NGN rate sources failed — ${errors.join('; ')}`);
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
