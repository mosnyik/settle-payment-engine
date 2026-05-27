/**
 * Simulate Deposit Script
 *
 * Sample commands:
 *   pnpm exec tsx scripts/simulate-deposit.ts wal_abc123
 *   pnpm exec tsx scripts/simulate-deposit.ts wal_abc123 50.5
 *
 * This script simulates a deposit being detected on a wallet,
 * useful for testing webhooks without real blockchain transactions.
 */

import * as walletService from '../src/services/wallet-api/wallet.service';
import { sendWebhook } from '../src/services/wallet-api/webhook.service';

async function simulateDeposit() {
  const walletId = process.argv[2];
  const amount = parseFloat(process.argv[3] || '100');
  const txHash = `sim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  if (!walletId) {
    console.log('Usage: pnpm exec tsx scripts/simulate-deposit.ts <wallet_id> [amount]');
    console.log('');
    console.log('Example: pnpm exec tsx scripts/simulate-deposit.ts wal_abc123 50.5');
    process.exit(1);
  }

  console.log('=== Simulating Deposit ===\n');
  console.log('Wallet ID:', walletId);
  console.log('Amount:', amount);
  console.log('Simulated TxHash:', txHash);
  console.log('');

  try {
    // Step 1: Get the wallet
    console.log('1. Fetching wallet...');
    const wallets = await walletService.getWatchingWallets();
    const wallet = wallets.find(w => w.id === walletId);

    if (!wallet) {
      // Try to get it directly (might not be in watching status)
      console.log('   Wallet not in watching status, trying direct lookup...');
      try {
        // We need the apiKeyId to get the wallet, but we don't have it
        console.log('   ❌ Cannot find wallet. Make sure it exists and is in "watching" status.');
        process.exit(1);
      } catch {
        console.log('   ❌ Wallet not found');
        process.exit(1);
      }
    }

    console.log('   ✓ Found wallet:', wallet.address.slice(0, 20) + '...');
    console.log('   Network:', wallet.network);
    console.log('   Crypto:', wallet.crypto);

    // Step 2: Simulate deposit detected
    console.log('\n2. Marking deposit as detected...');
    const detectedWallet = await walletService.markDepositDetected(walletId, txHash, amount);

    if (!detectedWallet) {
      console.log('   ❌ Failed to mark deposit');
      process.exit(1);
    }

    console.log('   ✓ Deposit marked as detected');
    console.log('   Status:', detectedWallet.status);

    // Step 3: Send deposit.detected webhook
    console.log('\n3. Sending deposit.detected webhook...');
    const webhookSent = await sendWebhook(detectedWallet, 'deposit.detected');
    console.log('   Webhook sent:', webhookSent ? '✓ Success' : '✗ Failed (check webhook config)');

    // Step 4: Simulate confirmations
    console.log('\n4. Simulating confirmations...');
    await walletService.updateConfirmations(walletId, 19);
    console.log('   ✓ Updated to 19 confirmations');

    // Step 5: Mark as confirmed
    console.log('\n5. Marking deposit as confirmed...');
    const confirmedWallet = await walletService.markDepositConfirmed(walletId, 19);

    if (!confirmedWallet) {
      console.log('   ❌ Failed to confirm deposit');
      process.exit(1);
    }

    console.log('   ✓ Deposit confirmed');
    console.log('   Status:', confirmedWallet.status);

    // Step 6: Send deposit.confirmed webhook
    console.log('\n6. Sending deposit.confirmed webhook...');
    const confirmWebhookSent = await sendWebhook(confirmedWallet, 'deposit.confirmed');
    console.log('   Webhook sent:', confirmWebhookSent ? '✓ Success' : '✗ Failed (check webhook config)');

    console.log('\n=== Simulation Complete ===');
    console.log('');
    console.log('Wallet Status:', confirmedWallet.status);
    console.log('Amount:', confirmedWallet.amount);
    console.log('TxHash:', confirmedWallet.txHash);
    console.log('Confirmations:', confirmedWallet.confirmations);

  } catch (error) {
    console.error('\n❌ Error:', (error as Error).message);
    process.exit(1);
  }

  process.exit(0);
}

simulateDeposit().catch(console.error);
