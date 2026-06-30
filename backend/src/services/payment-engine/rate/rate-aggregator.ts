import { FiatCurrency } from '../types';
import { RateProvider, RateQuote } from './providers/types';
import { SystemRateProvider } from './providers/system';
import { BushaRateProvider } from './providers/busha';
import { LiquidRampRateProvider } from './providers/liquidramp';
import { AnchorRateProvider } from './providers/anchor';
import { RateServiceUnavailableError } from '../errors';

interface CacheEntry {
  quote: RateQuote;
  expiresAt: Date;
}

const TTL_MS = 60 * 1000;

// Built-in provider set. Register additional providers here.
const ALL_PROVIDERS: RateProvider[] = [
  new SystemRateProvider(),
  new BushaRateProvider(),
  new LiquidRampRateProvider(),
  new AnchorRateProvider(),
];

const quoteCache = new Map<string, CacheEntry>();

function cacheKey(fiatCurrency: FiatCurrency): string {
  return fiatCurrency;
}

/**
 * Selection rule:
 *   1. Among all external providers, pick the lowest rate.
 *   2. Compare that against the system rate — use whichever is lower.
 *
 * This is equivalent to: min(all quotes).
 * The system rate acts as a ceiling; external providers can only push the
 * locked rate down, never up.
 */
function selectBest(quotes: RateQuote[]): RateQuote {
  return quotes.reduce((a, b) => (b.rate < a.rate ? b : a));
}

/**
 * Fetch quotes from all enabled providers in parallel.
 * Failed providers are silently skipped; their errors are logged.
 */
export async function getAllQuotes(fiatCurrency: FiatCurrency): Promise<RateQuote[]> {
  const enabled = ALL_PROVIDERS.filter((p) => p.isEnabled());

  const results = await Promise.allSettled(
    enabled.map((p) => p.fetchRate(fiatCurrency)),
  );

  const quotes: RateQuote[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      quotes.push(result.value);
    } else {
      console.warn(
        `[RateEngine] Provider "${enabled[i].name}" failed:`,
        result.reason?.message ?? result.reason,
      );
    }
  }

  return quotes;
}

/**
 * Returns the selected rate quote.
 * Result is cached for TTL_MS.
 */
export async function getBestRate(fiatCurrency: FiatCurrency): Promise<RateQuote> {
  const key = cacheKey(fiatCurrency);
  const cached = quoteCache.get(key);
  if (cached && new Date() < cached.expiresAt) {
    return cached.quote;
  }

  const quotes = await getAllQuotes(fiatCurrency);

  if (quotes.length === 0) {
    throw new RateServiceUnavailableError('All rate providers failed — no quotes available');
  }

  const selected = selectBest(quotes);

  quoteCache.set(key, { quote: selected, expiresAt: new Date(Date.now() + TTL_MS) });

  const allRates = quotes.map((q) => `${q.provider}=${q.rate}`).join(', ');
  console.info(`[RateEngine] Selected rate ${selected.rate} ${fiatCurrency}/USD from "${selected.provider}" — compared: [${allRates}]`);

  return selected;
}

export function clearAggregatorCache(): void {
  quoteCache.clear();
}
