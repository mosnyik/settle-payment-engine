/**
 * Quidax public market data (no auth).
 *
 * GET {baseUrl}/markets/tickers/{market}  e.g. usdtngn, btcusdt
 * -> { status: "success", data: { at, market, ticker: { buy, sell, last, ... } } }
 *
 * We price off the ticker's `buy` field.
 *
 * Thin books (e.g. ethusdt, quoted by a single market maker) can briefly have an
 * empty side while the maker refreshes its quotes, so the ticker answers "success"
 * with no usable price. We retry such a response once after a short delay before
 * giving up (and letting the caller fall back). Network/HTTP errors are not retried.
 */

import axios from "axios";
import config from "../../../config";

const REQUEST_TIMEOUT_MS = 8000;
const EMPTY_TICKER_RETRY_DELAY_MS = 500;
const RAW_SNIPPET_MAX = 300;

interface QuidaxTickerResponse {
  status?: string;
  data?: {
    ticker?: { buy?: string; sell?: string; last?: string };
  };
}

/** Thrown when Quidax answered but the body has no usable price (retryable once). */
class QuidaxBadTickerError extends Error {}

function rawSnippet(value: unknown): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = "[unreadable body]";
  }
  if (text === undefined) text = String(value);
  return text.length > RAW_SNIPPET_MAX ? `${text.slice(0, RAW_SNIPPET_MAX)}…` : text;
}

async function fetchBuyPriceOnce(market: string): Promise<number> {
  const url = `${config.quidax.baseUrl}/markets/tickers/${market}`;
  const response = await axios.get<QuidaxTickerResponse>(url, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { Accept: "application/json" },
  });

  const body = response.data;
  if (body?.status !== "success") {
    throw new QuidaxBadTickerError(
      `Quidax ${market} ticker returned status "${body?.status}" (body: ${rawSnippet(body)})`,
    );
  }

  const ticker = body.data?.ticker;
  const price = parseFloat(String(ticker?.buy ?? ""));
  if (!Number.isFinite(price) || price <= 0) {
    throw new QuidaxBadTickerError(
      `Quidax ${market} ticker has no valid buy price (ticker: ${rawSnippet(ticker)})`,
    );
  }

  return price;
}

/** Returns the `buy` price for a Quidax market (e.g. "usdtngn", "btcusdt"). */
export async function fetchQuidaxBuyPrice(
  market: string,
  options: { retryDelayMs?: number } = {},
): Promise<number> {
  const normalized = market.toLowerCase();
  try {
    return await fetchBuyPriceOnce(normalized);
  } catch (error) {
    if (!(error instanceof QuidaxBadTickerError)) throw error;
    const delay = options.retryDelayMs ?? EMPTY_TICKER_RETRY_DELAY_MS;
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await fetchBuyPriceOnce(normalized);
    } catch (retryError) {
      if (retryError instanceof QuidaxBadTickerError) {
        throw new Error(`${retryError.message}; retried once after ${delay}ms, first attempt: ${error.message}`);
      }
      throw retryError;
    }
  }
}
