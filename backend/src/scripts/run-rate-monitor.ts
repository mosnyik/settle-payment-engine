import config from '../config';
import { checkRateAlerts, validateRateAlertConfig } from '../services/payment-engine/rate/rate-email-alerts';

async function main(): Promise<void> {
  if (!config.rateAlerts.enabled) {
    console.log('[RateMonitor] Email alerts disabled');
    return;
  }
  validateRateAlertConfig();
  console.log(`[RateMonitor] Checking every ${config.rateAlerts.checkIntervalSeconds}s`);
  // Sequential checks prevent overlapping email sends when SMTP is slow.
  const check = async (): Promise<void> => {
    try {
      await checkRateAlerts();
    } catch (error) {
      console.error('[RateMonitor] Check failed:', error instanceof Error ? error.message : 'Unknown error');
    }
    setTimeout(() => void check(), config.rateAlerts.checkIntervalSeconds * 1000);
  };
  await check();
}

main().catch((error) => {
  console.error('[RateMonitor] Fatal:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
});
