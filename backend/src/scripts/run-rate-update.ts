import pool from '../lib/mysql';
import config from '../config';
import { updateRateJob } from '../services/payment-engine/rate/update-rate-job';

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

  return `[${lagosTime} Africa/Lagos] [RateUpdateJob]`;
}

async function main() {
  const rateIdRaw = process.env.RATE_ROW_ID;
  const rateId = rateIdRaw ? Number(rateIdRaw) : 1;

  if (!Number.isInteger(rateId) || rateId <= 0) {
    throw new Error(`Invalid RATE_ROW_ID value: ${rateIdRaw}`);
  }

  const result = await updateRateJob(rateId);

  console.log(
    `${logPrefix()} Success db=${config.db.database} rateId=${result.rateId} current_rate=${result.currentRate} merchant_rate=${result.merchantRate} profit_rate=${result.profitRate}`
  );
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix()} Failed db=${config.db.database}: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
