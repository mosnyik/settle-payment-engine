import { HttpRateProvider } from './providers/http-provider';
import { BushaRateProvider } from './providers/busha';
import { LiquidRampRateProvider } from './providers/liquidramp';
import { AnchorRateProvider } from './providers/anchor';
import { clearAggregatorCache } from './rate-aggregator';
import { FiatCurrency } from '../types';

const DEFAULT_INTERVAL_MS = 30_000; // 30 seconds
const FIAT_CURRENCIES: FiatCurrency[] = ['NGN'];

// All HTTP-based providers. System provider is excluded — it has its own job.
const HTTP_PROVIDERS: HttpRateProvider[] = [
  new BushaRateProvider(),
  new LiquidRampRateProvider(),
  new AnchorRateProvider(),
];

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

async function fetchAndStore(
  provider: HttpRateProvider,
  fiatCurrency: FiatCurrency,
): Promise<void> {
  const quote = await provider.fetchLiveRate(fiatCurrency);

  const pool = (await import('../../../lib/mysql')).default;
  await pool.execute(
    `INSERT INTO provider_rates (provider, fiat_currency, rate, fetched_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       rate       = VALUES(rate),
       fetched_at = VALUES(fetched_at)`,
    [quote.provider, fiatCurrency, quote.rate, quote.fetchedAt],
  );
}

async function runOnce(): Promise<void> {
  if (isRunning) return; // skip if previous tick is still in flight
  isRunning = true;

  try {
    const enabledProviders = HTTP_PROVIDERS.filter((p) => p.isEnabled());
    if (enabledProviders.length === 0) return;

    const tasks = enabledProviders.flatMap((p) =>
      FIAT_CURRENCIES.map((currency) => fetchAndStore(p, currency)),
    );

    const results = await Promise.allSettled(tasks);

    let anySuccess = false;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const provider = enabledProviders[Math.floor(i / FIAT_CURRENCIES.length)];
      if (result.status === 'fulfilled') {
        anySuccess = true;
      } else {
        console.warn(
          `[RateFetchJob] Failed to fetch from "${provider.name}":`,
          result.reason?.message ?? result.reason,
        );
      }
    }

    // Clear the in-memory aggregator cache so the next getBestRate() reads
    // fresh data from the DB rows we just wrote.
    if (anySuccess) {
      clearAggregatorCache();
    }
  } finally {
    isRunning = false;
  }
}

export function startRateFetchJob(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (intervalHandle) return; // already started

  const enabledProviders = HTTP_PROVIDERS.filter((p) => p.isEnabled());
  if (enabledProviders.length === 0) {
    console.log('RateFetchJob: No external rate providers enabled — job not started');
    return;
  }

  console.log(
    `RateFetchJob: Started — polling ${enabledProviders.map((p) => p.name).join(', ')} every ${intervalMs / 1000}s`,
  );

  // Run immediately on startup so DB has data before any transaction hits
  runOnce().catch((err) =>
    console.error('[RateFetchJob] Initial fetch failed:', err),
  );

  intervalHandle = setInterval(() => {
    runOnce().catch((err) =>
      console.error('[RateFetchJob] Scheduled fetch failed:', err),
    );
  }, intervalMs);
}

export function stopRateFetchJob(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('RateFetchJob: Stopped');
  }
}
