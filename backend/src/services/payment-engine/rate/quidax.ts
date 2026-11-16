/**
 * Quidax public market data (no auth).
 *
 * GET {baseUrl}/markets/tickers/{market}  e.g. usdtngn, btcusdt
 * -> { status: "success", data: { at, market, ticker: { buy, sell, last, ... } } }
 *
 * We price off the ticker's `sell` field.
 */

import axios from "axios";
import config from "../../../config";

const REQUEST_TIMEOUT_MS = 8000;

interface QuidaxTickerResponse {
  status?: string;
  data?: {
    ticker?: { buy?: string; sell?: string; last?: string };
  };
}

/** Returns the `sell` price for a Quidax market (e.g. "usdtngn", "btcusdt"). */
export async function fetchQuidaxSellPrice(market: string): Promise<number> {
  const url = `${config.quidax.baseUrl}/markets/tickers/${market.toLowerCase()}`;
  const response = await axios.get<QuidaxTickerResponse>(url, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { Accept: "application/json" },
  });

  const body = response.data;
  if (body?.status !== "success") {
    throw new Error(`Quidax ${market} ticker returned status "${body?.status}"`);
  }

  const price = parseFloat(String(body.data?.ticker?.sell ?? ""));
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Quidax ${market} ticker has no valid sell price`);
  }

  return price;
}
