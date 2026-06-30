import pool from '../lib/mysql';
import { BushaRateProvider } from '../services/payment-engine/rate/providers/busha';
import { LiquidRampRateProvider } from '../services/payment-engine/rate/providers/liquidramp';
import { AnchorRateProvider } from '../services/payment-engine/rate/providers/anchor';
import { HttpRateProvider } from '../services/payment-engine/rate/providers/http-provider';
import { FiatCurrency } from '../services/payment-engine/types';

const INTERVAL_MS = parseInt(process.env.RATE_FETCH_INTERVAL_MS || '30000', 10);
const FIAT_CURRENCIES: FiatCurrency[] = ['NGN'];

const HTTP_PROVIDERS: HttpRateProvider[] = [
  new BushaRateProvider(),
  new LiquidRampRateProvider(),
  new AnchorRateProvider(),
];

function logPrefix(): string {
  const lagosTime = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());

  return `[${lagosTime} Africa/Lagos] [RateFetchJob]`;
}

async function fetchAndStore(
  provider: HttpRateProvider,
  fiatCurrency: FiatCurrency,
): Promise<void> {
  const quote = await provider.fetchLiveRate(fiatCurrency);

  await pool.execute(
    `INSERT INTO provider_rates (provider, fiat_currency, rate, fetched_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       rate       = VALUES(rate),
       fetched_at = VALUES(fetched_at)`,
    [quote.provider, fiatCurrency, quote.rate, quote.fetchedAt],
  );

  console.log(
    `${logPrefix()} provider=${quote.provider} currency=${fiatCurrency} rate=${quote.rate}`,
  );
}

async function runOnce(): Promise<void> {
  const enabled = HTTP_PROVIDERS.filter((p) => p.isEnabled());

  if (enabled.length === 0) {
    console.log(`${logPrefix()} No providers enabled — nothing to fetch`);
    return;
  }

  const tasks = enabled.flatMap((p) =>
    FIAT_CURRENCIES.map((currency) => fetchAndStore(p, currency)),
  );

  const results = await Promise.allSettled(tasks);

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected') {
      const provider = enabled[Math.floor(i / FIAT_CURRENCIES.length)];
      console.error(
        `${logPrefix()} FAILED provider=${provider.name}:`,
        result.reason?.message ?? result.reason,
      );
    }
  }
}

async function main(): Promise<void> {
  console.log(`${logPrefix()} Starting — interval=${INTERVAL_MS}ms`);

  // Run immediately on startup
  await runOnce();

  // Then loop
  const run = () => {
    runOnce().catch((err) =>
      console.error(`${logPrefix()} Unexpected error:`, err),
    );
  };

  setInterval(run, INTERVAL_MS);
}

main().catch((err) => {
  console.error(`${logPrefix()} Fatal:`, err);
  process.exitCode = 1;
});
