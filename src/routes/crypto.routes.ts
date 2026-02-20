import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import config from '../config';

const router = Router();

// Helper to get base symbol (e.g., USDT-BEP20 -> USDT)
function getBaseSymbol(ticker: string): string {
  if (!ticker) return ticker;

  // Handle cases like USDT-BEP20, USDT-ERC20, etc.
  const parts = ticker.split('-');
  if (parts.length > 1) {
    return parts[0].toUpperCase();
  }

  // Handle cases like USDT_BEP20
  const underscoreParts = ticker.split('_');
  if (underscoreParts.length > 1) {
    return underscoreParts[0].toUpperCase();
  }

  return ticker.toUpperCase();
}

// GET /crypto/price
router.get('/price', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let { ticker } = req.query;

    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker is required and must be a string' });
    }

    ticker = getBaseSymbol(ticker);

    // USDT is pegged to $1
    if (ticker === 'USDT') {
      return res.status(200).json({ price: 1 });
    }

    const response = await axios.get(
      'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest',
      {
        params: { symbol: ticker },
        headers: {
          'X-CMC_PRO_API_KEY': config.coinmarketcap.apiKey,
        },
        timeout: 10000,
      }
    );

    const { price } = response.data.data[ticker].quote.USD;

    return res.status(200).json({ price });
  } catch (error: any) {
    console.error('Error fetching coin price:', error);
    if (axios.isAxiosError(error) && error.response) {
      return res.status(error.response.status).json({
        error: 'Failed to fetch price',
        details: error.response.data
      });
    }
    next(error);
  }
});

// POST /crypto/price (for backwards compatibility)
router.post('/price', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let { ticker } = req.body;

    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker is required and must be a string' });
    }

    ticker = getBaseSymbol(ticker);

    // USDT is pegged to $1
    if (ticker === 'USDT') {
      return res.status(200).json({ price: 1 });
    }

    const response = await axios.get(
      'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest',
      {
        params: { symbol: ticker },
        headers: {
          'X-CMC_PRO_API_KEY': config.coinmarketcap.apiKey,
        },
        timeout: 10000,
      }
    );

    const { price } = response.data.data[ticker].quote.USD;

    return res.status(200).json({ price });
  } catch (error: any) {
    console.error('Error fetching coin price:', error);
    if (axios.isAxiosError(error) && error.response) {
      return res.status(error.response.status).json({
        error: 'Failed to fetch price',
        details: error.response.data
      });
    }
    next(error);
  }
});

export default router;
