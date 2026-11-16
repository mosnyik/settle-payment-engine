import pool from '../lib/mysql';
import config from '../config';
import { updateRateJob } from '../services/payment-engine/rate/update-rate-job';
import { recordRateOutcome } from '../services/payment-engine/rate/rate-email-alerts';
import { flushQuidaxFailureAlerts } from '../services/payment-engine/rate/quidax-failure-alerts';

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

  try {
    await recordRateOutcome();
  } catch (error) {
    console.error(`${logPrefix()} Could not record success for email monitor:`, error instanceof Error ? error.message : 'Unknown error');
  }

  console.log(
    `${logPrefix()} Success db=${config.db.database} rateId=${result.rateId} current_rate=${result.currentRate} merchant_rate=${result.merchantRate} profit_rate=${result.profitRate}`
  );
}

main()
  .catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix()} Failed db=${config.db.database}: ${message}`);
    process.exitCode = 1;
    try {
      await recordRateOutcome(message || 'Unknown update error');
    } catch (stateError) {
      console.error(`${logPrefix()} Could not record failure for email monitor:`, stateError instanceof Error ? stateError.message : 'Unknown error');
    }
  })
  .finally(async () => {
    // Short-lived process: send any Quidax failures now instead of waiting for the digest window.
    try {
      await flushQuidaxFailureAlerts();
    } catch (error) {
      console.error(`${logPrefix()} Could not send Quidax failure email:`, error instanceof Error ? error.message : 'Unknown error');
    }
    await pool.end();
  });
