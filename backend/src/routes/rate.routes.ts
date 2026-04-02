import { Router, Request, Response, NextFunction } from "express";
import pool from "../lib/mysql";
import { RowDataPacket } from "mysql2/promise";
import { getAssetPrice } from "../services/payment-engine/rate/rate-service";

const router = Router();

interface ExchangeRate extends RowDataPacket {
  current_rate: string | number;
  merchant_rate: string | number;
  profit_rate?: string | number;
}

// GET /rate
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [results] = await pool.execute<ExchangeRate[]>("SELECT * FROM rates");

    if (!results || results.length === 0) {
      return res.status(404).json({ error: "No rates found" });
    }

    const result = results[0];
    const raw = result.current_rate;
    const array_rate = raw.toString();
    const numRate = Number(array_rate);
    const percentage = 0.8;
    const increase = (percentage / 100) * numRate;
    const rate = numRate - increase;
    const data = rate.toLocaleString();

    return res.status(200).json({ rate: data });
  } catch (err: any) {
    console.error("Error querying the rate from rates:", err);
    next(err);
  }
});

// GET /rate/merchant
router.get(
  "/merchant",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [results] = await pool.query<ExchangeRate[]>("SELECT * FROM rates");

      if (!results || results.length === 0) {
        return res.status(404).json({ error: "No rates found" });
      }

      const result = results[0];
      const merchantRate = result.merchant_rate;

      return res.status(200).json({ merchantRate });
    } catch (err: any) {
      console.error("Error querying the merchant rate from rates:", err);
      next(err);
    }
  },
);
// GET /rate/profit
router.get(
  "/profit",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [results] = await pool.query<ExchangeRate[]>("SELECT * FROM rates");

      if (!results || results.length === 0) {
        return res.status(404).json({ error: "No rates found" });
      }

      const result = results[0];
      const profitRate = result.profit_rate;

      return res.status(200).json({ profitRate });
    } catch (err: any) {
      console.error("Error querying the profit rate from rates:", err);
      next(err);
    }
  },
);

// GET /rate/all
router.get("/all", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [results] = await pool.query<ExchangeRate[]>("SELECT * FROM rates");

    if (!results || results.length === 0) {
      return res.status(404).json({ error: "No rates found" });
    }

    const result = results[0];

    const parseRate = (value: string | number): number => {
      if (typeof value === "number") return value;
      return parseFloat(value.toString().replace(/,/g, ""));
    };

    const currentRate = parseRate(result.current_rate);
    const merchantRate = parseRate(result.merchant_rate);
    const profitRate = result.profit_rate ? parseRate(result.profit_rate) : 0;

    // Apply 0.8% adjustment to current rate
    const percentage = 0.8;
    const adjustment = (percentage / 100) * currentRate;
    const adjustedRate = currentRate - adjustment;

    return res.status(200).json({
      rate: adjustedRate.toLocaleString(),
      rateNumeric: adjustedRate,
      merchantRate,
      profitRate,
    });
  } catch (err: any) {
    console.error("Error querying rates:", err);
    next(err);
  }
});

// GET /rate/limits?crypto=ETH&estimateAsset=naira
// Returns min/max in the user's chosen estimation unit plus the asset price.
// Public endpoint — no auth required.
router.get("/limits", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const crypto = ((req.query.crypto as string) ?? "").toUpperCase();
    const estimateAsset = ((req.query.estimateAsset as string) ?? "naira").toLowerCase();

    if (!crypto) {
      return res.status(400).json({ error: "crypto query param is required" });
    }

    // --- NGN/USD rate (same logic as /rate/all) ---
    const [rateRows] = await pool.query<ExchangeRate[]>("SELECT * FROM rates LIMIT 1");
    if (!rateRows || rateRows.length === 0) {
      return res.status(404).json({ error: "No rates found" });
    }

    const parseRate = (v: string | number) =>
      parseFloat(typeof v === "number" ? v.toString() : v.toString().replace(/,/g, ""));

    const rawRate = parseRate(rateRows[0].current_rate);
    const adjustment = (0.8 / 100) * rawRate;
    const rate = rawRate - adjustment; // NGN per USD

    // --- Asset price in USD (fetched from CoinMarketCap via rate-service cache) ---
    const assetPrice = await getAssetPrice(crypto as any);

    // --- Fixed NGN bounds ---
    const MIN_NGN = 20_000;
    const MAX_NGN = 2_000_000;

    let min: number;
    let max: number;
    let unit: string;

    if (estimateAsset === "naira") {
      min  = MIN_NGN;
      max  = MAX_NGN;
      unit = "NGN";
    } else if (estimateAsset === "dollar") {
      min  = parseFloat((MIN_NGN / rate).toFixed(2));
      max  = parseFloat((MAX_NGN / rate).toFixed(2));
      unit = "USD";
    } else {
      // crypto
      if (assetPrice <= 0) {
        return res.status(400).json({ error: `No asset price available for ${crypto}` });
      }
      const isStable = crypto === "USDT" || crypto === "USDC";
      if (isStable) {
        min  = parseFloat((MIN_NGN / rate).toFixed(6));
        max  = parseFloat((MAX_NGN / rate).toFixed(6));
      } else {
        min  = parseFloat((MIN_NGN / rate / assetPrice).toFixed(8));
        max  = parseFloat((MAX_NGN / rate / assetPrice).toFixed(8));
      }
      unit = crypto;
    }

    return res.status(200).json({ min, max, unit, assetPrice, rate });
  } catch (err: any) {
    next(err);
  }
});

export default router;
