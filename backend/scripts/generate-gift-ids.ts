import fs from 'fs';
import path from 'path';

const envPaths = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
];

function loadEnvFile(): void {
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const dotenv = require('dotenv');
      dotenv.config({ path: envPath });
    }
  }
}

function getArg(flag: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function assertDatabaseName(name: string, label: string): void {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Invalid ${label}: ${name}`);
  }
}

async function main(): Promise<void> {
  loadEnvFile();

  const count = Number(getArg('--count', '1'));
  const amount = Number(getArg('--amount', '0'));
  const fiatCurrency = (getArg('--fiat-currency', 'NGN') || 'NGN').toUpperCase();
  const crypto = (getArg('--crypto', 'USDT') || 'USDT').toUpperCase();
  const network = (getArg('--network', 'trc20') || 'trc20').toLowerCase();
  const chargeFrom = (getArg('--charge-from', 'crypto') || 'crypto').toLowerCase();
  const database = getArg('--db', process.env.DB_NAME || 'settle_db_test') || 'settle_db_test';
  const host = getArg('--host', process.env.DB_HOST || '127.0.0.1') || '127.0.0.1';
  const port = getArg('--port', process.env.DB_PORT || '3306') || '3306';
  const user = getArg('--user', process.env.DB_USER || 'root') || 'root';
  const password = getArg('--password', process.env.DB_PASSWORD || '') || '';
  const apply = hasFlag('--apply');

  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('--count must be a positive integer.');
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('--amount must be a positive number.');
  }

  if (!['NGN', 'GHS', 'KES', 'ZAR'].includes(fiatCurrency)) {
    throw new Error(`Unsupported --fiat-currency: ${fiatCurrency}`);
  }

  if (!['BTC', 'ETH', 'BNB', 'TRX', 'USDT', 'USDC'].includes(crypto)) {
    throw new Error(`Unsupported --crypto: ${crypto}`);
  }

  if (!['bitcoin', 'ethereum', 'bsc', 'tron', 'polygon', 'base', 'erc20', 'bep20', 'trc20'].includes(network)) {
    throw new Error(`Unsupported --network: ${network}`);
  }

  if (!['fiat', 'crypto'].includes(chargeFrom)) {
    throw new Error(`Unsupported --charge-from: ${chargeFrom}`);
  }

  assertDatabaseName(database, 'database name');

  process.env.DB_NAME = database;
  process.env.DB_HOST = host;
  process.env.DB_PORT = port;
  process.env.DB_USER = user;
  process.env.DB_PASSWORD = password;

  const previewRows = Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    fiatAmount: amount,
    fiatCurrency,
    crypto,
    network,
    chargeFrom,
    status: 'confirmed',
  }));

  if (!apply) {
    console.log(`Planned ${count} confirmed gift(s) via PaymentEngine create flow.`);
    console.table(previewRows);
    console.log('Dry run only. Re-run with --apply to create confirmed gifts.');
    return;
  }

  const [
    { paymentEngine },
    { participantService },
    { legacySyncService },
    { createHDWalletService, getHDWalletService },
  ] = await Promise.all([
    import('../src/services/payment-engine'),
    import('../src/services/payment-engine/participant'),
    import('../src/services/payment-engine/sync'),
    import('../src/services/payment-engine/hd-wallet'),
  ]);

  if (process.env.HD_WALLET_ENABLED === 'true' && !getHDWalletService()?.isEnabled()) {
    const seedEncrypted = process.env.HD_SEED_PHRASE_ENCRYPTED || '';
    const seedEncryptionKey = process.env.HD_SEED_ENCRYPTION_KEY || '';
    const hotWallets = {
      bitcoin: process.env.HOT_WALLET_BITCOIN || '',
      ethereum: process.env.HOT_WALLET_ETHEREUM || '',
      tron: process.env.HOT_WALLET_TRON || '',
    };

    if (!seedEncrypted || !seedEncryptionKey) {
      throw new Error('HD wallet is enabled but seed configuration is missing.');
    }

    await createHDWalletService(seedEncrypted, seedEncryptionKey, hotWallets);
  }

  const poolModule = await import('../src/lib/mysql');
  const pool = poolModule.pool;

  const createdGifts: Array<{
    gift_id: string;
    payment_id: string;
    fiat_amount: number;
    crypto_amount: number | null | undefined;
    current_rate: number | null | undefined;
    charges: number | null | undefined;
    deposit_address: string | null | undefined;
  }> = [];

  for (let index = 0; index < count; index += 1) {
    const payer = {
      chatId: `gift-seed-${Date.now()}-${index + 1}`,
    };

    const session = await paymentEngine.createPayment({
      type: 'gift',
      fiatAmount: amount,
      fiatCurrency: fiatCurrency as 'NGN' | 'GHS' | 'KES' | 'ZAR',
      crypto: crypto as 'BTC' | 'ETH' | 'BNB' | 'TRX' | 'USDT' | 'USDC',
      network: network as 'bitcoin' | 'ethereum' | 'bsc' | 'tron' | 'polygon' | 'base' | 'erc20' | 'bep20' | 'trc20',
      payer,
      chargeFrom: chargeFrom as 'fiat' | 'crypto',
    });

    const payerId = await participantService.getOrCreatePayer(payer);
    await paymentEngine.setPayerId(session.id, payerId);

    const now = new Date();
    await pool.query(
      `UPDATE payment_sessions
       SET status = 'confirmed',
           confirmed_at = ?,
           settled_at = NULL,
           updated_at = ?
       WHERE id = ?`,
      [now, now, session.id]
    );

    const updatedSession = await paymentEngine.getPayment(session.id);
    await legacySyncService.syncToLegacy(updatedSession);

    createdGifts.push({
      gift_id: updatedSession.reference,
      payment_id: updatedSession.id,
      fiat_amount: updatedSession.fiatAmount,
      crypto_amount: updatedSession.cryptoAmount,
      current_rate: updatedSession.rate,
      charges: updatedSession.chargeAmount,
      deposit_address: updatedSession.depositAddress,
    });
  }

  console.log(`Created ${createdGifts.length} confirmed gift(s) in ${database}.`);
  console.table(createdGifts);
  console.log(JSON.stringify(createdGifts, null, 2));
  console.log('Gift ID array:');
  console.log(JSON.stringify(createdGifts.map((gift) => gift.gift_id), null, 2));
}

main().catch((error: Error) => {
  console.error(`Failed to generate gift ids: ${error.message}`);
  process.exit(1);
});
