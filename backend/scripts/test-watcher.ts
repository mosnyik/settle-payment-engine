/**
 * Manual Watcher Test Script
 *
 * Sample commands:
 *   pnpm exec tsx scripts/test-watcher.ts
 *   WATCHER_ENABLED=true pnpm exec tsx scripts/test-watcher.ts
 *
 * This script:
 * 1. Initializes the watcher
 * 2. Creates a test wallet
 * 3. Simulates deposit detection
 */

import { createDepositWatcher, getDepositWatcher } from '../src/services/payment-engine/watcher';
import { config } from '../src/config';
import * as walletService from '../src/services/wallet-api/wallet.service';
import * as walletRepository from '../src/services/wallet-api/wallet.repository';
import { sendWebhook } from '../src/services/wallet-api/webhook.service';

async function testWatcher() {
  console.log('=== Watcher Manual Test ===\n');

  // Step 1: Check watcher config
  console.log('1. Checking watcher configuration...');
  console.log('   Watcher enabled:', config.watcher.enabled);
  console.log('   Chains:', Object.entries(config.watcher.chains)
    .filter(([_, c]) => c.enabled)
    .map(([name]) => name)
    .join(', ') || 'none');

  if (!config.watcher.enabled) {
    console.log('\n⚠️  Watcher is disabled. Set WATCHER_ENABLED=true in .env');
    return;
  }

  // Step 2: Start watcher
  console.log('\n2. Starting watcher...');
  const watcher = createDepositWatcher(config.watcher);
  await watcher.start();
  console.log('   Watcher started');
  console.log('   Active session watches:', watcher.getActiveWatchCount());
  console.log('   Active wallet watches:', watcher.getActiveWalletWatchCount());

  // Step 3: List any existing watching wallets
  console.log('\n3. Checking existing wallets...');
  try {
    const watchingWallets = await walletService.getWatchingWallets();
    console.log(`   Found ${watchingWallets.length} wallets in "watching" status`);

    if (watchingWallets.length > 0) {
      console.log('\n   Existing wallets:');
      for (const w of watchingWallets.slice(0, 5)) {
        console.log(`   - ${w.id}: ${w.address.slice(0, 20)}... (${w.crypto} on ${w.network})`);
      }
      if (watchingWallets.length > 5) {
        console.log(`   ... and ${watchingWallets.length - 5} more`);
      }
    }
  } catch (err) {
    console.log('   Could not fetch wallets (DB not connected?):', (err as Error).message);
  }

  // Step 4: Show watcher status
  console.log('\n4. Watcher status:');
  console.log('   Running:', watcher.isActive());
  console.log('   Enabled chains:', watcher.getEnabledChains().join(', '));
  console.log('   Watching sessions:', watcher.getActiveSessionIds().length);
  console.log('   Watching wallets:', watcher.getActiveWalletIds().length);

  // Step 5: Event listener for testing
  console.log('\n5. Listening for events (Ctrl+C to stop)...\n');

  watcher.on('watcher_event', (event) => {
    console.log(`[${new Date().toISOString()}] Event:`, event.type);
    if (event.sessionId) console.log('   Session:', event.sessionId);
    if (event.txHash) console.log('   TxHash:', event.txHash);
    if (event.details) console.log('   Details:', JSON.stringify(event.details));
  });

  // Keep running
  console.log('Watcher is running. Press Ctrl+C to stop.\n');
  console.log('To test deposit detection:');
  console.log('1. Create a wallet via POST /v1/wallets');
  console.log('2. Send testnet crypto to the generated address');
  console.log('3. Watch this console for deposit events\n');

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await watcher.stop();
    process.exit(0);
  });
}

// Run
testWatcher().catch(console.error);
