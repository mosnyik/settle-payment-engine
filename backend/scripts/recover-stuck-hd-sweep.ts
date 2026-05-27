import type { HDWalletService } from '../src/services/payment-engine/hd-wallet';
import {
  SWEEP_TOKEN_CONTRACTS,
  TOKEN_DECIMALS,
} from '../src/services/payment-engine/sweeper/types';

type RecoveryTarget = {
  sessionId?: string;
  reference?: string;
  fromAddress: string;
  derivationIndex: number;
  fundingWalletIndex?: number;
  toAddress?: string;
};

const USDT_TRC20 = SWEEP_TOKEN_CONTRACTS.trc20.USDT;
const USDT_DECIMALS = TOKEN_DECIMALS[USDT_TRC20];
const SUN_PER_TRX = 1_000_000n;
type RecoverAsset = 'usdt' | 'trx';

let config: any;
let pool: any;
let createHDWalletService: (
  seedEncrypted: string,
  seedEncryptionKey: string,
  hotWallets: { bitcoin: string; ethereum: string; tron: string }
) => Promise<HDWalletService>;
let destroyHDWalletService: () => void = () => {};

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

function usage(): void {
  console.log(`
Recover stuck HD-wallet TRC20 USDT or native TRX from a derived deposit wallet.

Dry run:
  pnpm recover:hd-sweep -- --reference PAY_xxx --to T_DESTINATION
  pnpm recover:hd-sweep -- --session-id SESSION_ID --to T_DESTINATION
  pnpm recover:hd-sweep -- --address T_DEPOSIT --index 12 --to T_DESTINATION
  pnpm recover:hd-sweep -- --reference PAY_xxx --asset trx --to T_DESTINATION
  pnpm recover:hd-sweep -- --reference PAY_xxx --asset trx --to T_DESTINATION --host YOUR_HOST --user YOUR_USER --password YOUR_PASSWORD --db YOUR_DB

Broadcast:
  pnpm recover:hd-sweep -- --reference PAY_xxx --to T_DESTINATION --execute
  pnpm recover:hd-sweep -- --reference PAY_xxx --asset trx --to T_DESTINATION --execute
  pnpm recover:hd-sweep -- --reference PAY_xxx --asset trx --to T_DESTINATION --execute --db-host YOUR_HOST --db-user YOUR_USER --db-password YOUR_PASSWORD --db-name YOUR_DB

Options:
  --reference <ref>             Payment session reference.
  --session-id <id>             Payment session id.
  --address <tron-address>      HD deposit address, used with --index.
  --index <n>                   HD derivation index, used with --address.
  --to <tron-address>           Recovery destination. Defaults to session parent wallet, then HOT_WALLET_TRON.
  --asset <usdt|trx>            Asset to recover. Default: usdt.
  --amount <usdt>               Amount to send. Defaults to full USDT balance.
  --reserve-trx <trx>           Native TRX to leave behind when --asset trx. Default: 1.
  --min-trx <trx>               TRX balance required before token transfer. Default: 7.
  --no-prefund                  Do not pre-fund TRX from merchant funding wallet.
  --funding-index <n>           Merchant funding wallet index if not present on the session.
  --funding-private-key <hex>   Explicit funding wallet private key for TRX pre-fund.
  --mark-swept                  Mark derived address sweep metadata after a successful transfer.
  --execute                     Actually broadcast transactions. Without this, no funds move.

Database options:
  --db <name>                    Database name. Alias for --db-name.
  --db-name <name>               Database name.
  --db-host <host>               Database host.
  --db-port <port>               Database port.
  --db-user <user>               Database user.
  --db-password <password>       Database password.
`);
}

function applyDatabaseArgs(): void {
  const dbName = getArg('--db-name', getArg('--db'));
  const dbHost = getArg('--db-host', getArg('--host'));
  const dbPort = getArg('--db-port', getArg('--port'));
  const dbUser = getArg('--db-user', getArg('--user'));
  const dbPassword = getArg('--db-password', getArg('--password'));

  if (dbName) process.env.DB_NAME = dbName;
  if (dbHost) process.env.DB_HOST = dbHost;
  if (dbPort) process.env.DB_PORT = dbPort;
  if (dbUser) process.env.DB_USER = dbUser;
  if (dbPassword !== undefined) process.env.DB_PASSWORD = dbPassword;
}

async function loadRuntime(): Promise<void> {
  applyDatabaseArgs();

  const configModule = await import('../src/config');
  const mysqlModule = await import('../src/lib/mysql');
  const hdWalletModule = await import('../src/services/payment-engine/hd-wallet');

  config = configModule.default;
  pool = mysqlModule.default;
  createHDWalletService = hdWalletModule.createHDWalletService;
  destroyHDWalletService = hdWalletModule.destroyHDWalletService;
}

function parsePositiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function parseUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }

  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) {
    throw new Error(`Amount has too many decimals. USDT TRC20 supports ${decimals}.`);
  }

  return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
}

function formatUnits(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

function trxToSun(value: string): bigint {
  return parseUnits(value, 6);
}

function formatTrx(sun: bigint): string {
  return formatUnits(sun, 6);
}

function getRecoverAsset(): RecoverAsset {
  const asset = (getArg('--asset', 'usdt') || 'usdt').toLowerCase();
  if (asset !== 'usdt' && asset !== 'trx') {
    throw new Error('--asset must be either "usdt" or "trx".');
  }
  return asset;
}

function requireTronAddress(tronWeb: any, address: string, label: string): void {
  if (!tronWeb.isAddress(address)) {
    throw new Error(`${label} is not a valid Tron address: ${address}`);
  }
}

async function getTronWebClass(): Promise<any> {
  const tronWebModule = await import('tronweb');
  return (
    (tronWebModule as any).TronWeb ||
    (tronWebModule as any).default?.TronWeb ||
    (tronWebModule as any).default
  );
}

async function initHDWallet(): Promise<HDWalletService> {
  if (!config.hdWallet.seedEncrypted || !config.hdWallet.seedEncryptionKey) {
    throw new Error('Missing HD_SEED_PHRASE_ENCRYPTED or HD_SEED_ENCRYPTION_KEY.');
  }

  return createHDWalletService(
    config.hdWallet.seedEncrypted,
    config.hdWallet.seedEncryptionKey,
    config.hdWallet.hotWallets
  );
}

async function loadSessionTarget(): Promise<Partial<RecoveryTarget> | null> {
  const sessionId = getArg('--session-id');
  const reference = getArg('--reference');

  if (!sessionId && !reference) return null;

  const [rows] = await pool.query(
    `SELECT id, reference, deposit_address, derivation_index, funding_wallet_index, parent_wallet
       FROM payment_sessions
      WHERE ${sessionId ? 'id = ?' : 'reference = ?'}
      LIMIT 1`,
    [sessionId || reference]
  ) as [any[], any];

  if (!rows || rows.length === 0) {
    throw new Error(`Payment session not found for ${sessionId ? '--session-id' : '--reference'}.`);
  }

  const row = rows[0];
  if (!row.deposit_address) {
    throw new Error('Payment session has no deposit_address.');
  }
  if (row.derivation_index === null || row.derivation_index === undefined) {
    throw new Error('Payment session has no derivation_index; this script only recovers HD wallets.');
  }

  return {
    sessionId: row.id,
    reference: row.reference,
    fromAddress: row.deposit_address,
    derivationIndex: Number(row.derivation_index),
    fundingWalletIndex: row.funding_wallet_index === null ? undefined : Number(row.funding_wallet_index),
    toAddress: row.parent_wallet || undefined,
  };
}

async function resolveTarget(): Promise<RecoveryTarget> {
  const sessionTarget = await loadSessionTarget();
  const address = getArg('--address', sessionTarget?.fromAddress);
  const index = parsePositiveInteger(getArg('--index'), '--index') ?? sessionTarget?.derivationIndex;
  const fundingIndex =
    parsePositiveInteger(getArg('--funding-index'), '--funding-index') ??
    sessionTarget?.fundingWalletIndex;
  const toAddress =
    getArg('--to', sessionTarget?.toAddress || config.hdWallet.hotWallets.tron) || undefined;

  if (!address) {
    throw new Error('Provide --reference, --session-id, or --address.');
  }
  if (index === undefined) {
    throw new Error('Provide --index when using --address without a session.');
  }
  if (!toAddress) {
    throw new Error('Provide --to or configure HOT_WALLET_TRON.');
  }

  return {
    sessionId: sessionTarget?.sessionId,
    reference: sessionTarget?.reference,
    fromAddress: address,
    derivationIndex: index,
    fundingWalletIndex: fundingIndex,
    toAddress,
  };
}

async function prefundTrxIfNeeded(params: {
  TronWebClass: any;
  childAddress: string;
  currentSun: bigint;
  minSun: bigint;
  fundingPrivateKey?: string;
  fundingWalletIndex?: number;
  hdWallet: HDWalletService;
  execute: boolean;
}): Promise<string | undefined> {
  const deficit = params.minSun - params.currentSun;
  if (deficit <= 0n) return undefined;

  const fundingPrivateKey =
    params.fundingPrivateKey ||
    (params.fundingWalletIndex !== undefined
      ? params.hdWallet.getMerchantFundingPrivateKey('tron', params.fundingWalletIndex)
      : undefined);

  if (!fundingPrivateKey) {
    throw new Error(
      `Deposit wallet needs ${formatTrx(deficit)} TRX before transfer. ` +
      'Provide --funding-index, --funding-private-key, or top it up manually.'
    );
  }

  const fundingTronWeb = new params.TronWebClass({
    fullHost: config.watcher.chains.tron.apiUrl,
    headers: config.watcher.chains.tron.apiKey
      ? { 'TRON-PRO-API-KEY': config.watcher.chains.tron.apiKey }
      : undefined,
    privateKey: fundingPrivateKey,
  });
  const fundingAddress = fundingTronWeb.address.fromPrivateKey(fundingPrivateKey);
  const fundingBalance = BigInt(await fundingTronWeb.trx.getBalance(fundingAddress));

  console.log(`TRX pre-fund needed: ${formatTrx(deficit)} TRX`);
  console.log(`Funding wallet: ${fundingAddress} (${formatTrx(fundingBalance)} TRX)`);

  if (fundingBalance < deficit) {
    throw new Error(
      `Funding wallet has insufficient TRX: need ${formatTrx(deficit)}, have ${formatTrx(fundingBalance)}.`
    );
  }

  if (!params.execute) return undefined;

  const tx = await fundingTronWeb.transactionBuilder.sendTrx(
    params.childAddress,
    Number(deficit),
    fundingAddress
  );
  const signedTx = await fundingTronWeb.trx.sign(tx);
  const result = await fundingTronWeb.trx.sendRawTransaction(signedTx);

  if (!result.result) {
    throw new Error(`TRX pre-fund failed: ${result.message || JSON.stringify(result)}`);
  }

  console.log(`TRX pre-fund broadcast: ${result.txid}`);
  await new Promise((resolve) => setTimeout(resolve, 8000));
  return result.txid;
}

async function markSwept(target: RecoveryTarget, txHash: string): Promise<void> {
  await pool.query(
    `UPDATE derived_addresses
        SET swept_at = NOW(), sweep_tx_hash = ?
      WHERE chain = 'tron' AND derivation_index = ? AND address = ?`,
    [txHash, target.derivationIndex, target.fromAddress]
  );
}

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) {
    usage();
    return;
  }

  await loadRuntime();

  const execute = hasFlag('--execute');
  const asset = getRecoverAsset();
  const shouldPrefund = !hasFlag('--no-prefund');
  const mark = hasFlag('--mark-swept');
  const amountArg = getArg('--amount');
  const minTrx = getArg('--min-trx', '10') || '10';
  const reserveTrx = getArg('--reserve-trx', '1') || '1';
  const fundingPrivateKey = getArg('--funding-private-key');

  const target = await resolveTarget();
  const hdWallet = await initHDWallet();
  const keyMaterial = hdWallet.deriveAtIndex('tron', target.derivationIndex);

  const TronWebClass = await getTronWebClass();
  if (!TronWebClass) {
    throw new Error('Could not load TronWeb class.');
  }

  const tronWeb = new TronWebClass({
    fullHost: config.watcher.chains.tron.apiUrl,
    headers: config.watcher.chains.tron.apiKey
      ? { 'TRON-PRO-API-KEY': config.watcher.chains.tron.apiKey }
      : undefined,
    privateKey: keyMaterial.privateKey,
  });

  requireTronAddress(tronWeb, target.fromAddress, '--address/fromAddress');
  requireTronAddress(tronWeb, target.toAddress!, '--to');

  if (keyMaterial.address !== target.fromAddress) {
    throw new Error(
      `Derived address mismatch for index ${target.derivationIndex}: ` +
      `derived ${keyMaterial.address}, target ${target.fromAddress}. Refusing to sign.`
    );
  }

  const contract = await tronWeb.contract().at(USDT_TRC20);
  const tokenBalance = BigInt((await contract.balanceOf(target.fromAddress).call()).toString());
  const trxBalance = BigInt(await tronWeb.trx.getBalance(target.fromAddress));
  const tokenTransferAmount = amountArg ? parseUnits(amountArg, USDT_DECIMALS) : tokenBalance;
  const reserveSun = trxToSun(reserveTrx);
  const trxTransferAmount = amountArg ? trxToSun(amountArg) : trxBalance - reserveSun;
  const minSun = trxToSun(minTrx);

  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Asset: ${asset.toUpperCase()}`);
  console.log(`Session: ${target.reference || target.sessionId || '(manual address)'}`);
  console.log(`From: ${target.fromAddress} (index ${target.derivationIndex})`);
  console.log(`To: ${target.toAddress}`);
  console.log(`USDT balance: ${formatUnits(tokenBalance, USDT_DECIMALS)} USDT`);
  console.log(`TRX balance: ${formatTrx(trxBalance)} TRX`);
  console.log(
    asset === 'usdt'
      ? `Transfer amount: ${formatUnits(tokenTransferAmount, USDT_DECIMALS)} USDT`
      : `Transfer amount: ${formatTrx(trxTransferAmount)} TRX`
  );

  if (asset === 'trx') {
    if (trxTransferAmount <= 0n) {
      throw new Error(
        `No TRX amount to transfer after reserving ${formatTrx(reserveSun)} TRX. ` +
        'Use --amount to send an explicit amount or lower --reserve-trx.'
      );
    }
    if (trxTransferAmount >= trxBalance) {
      throw new Error('TRX transfer amount must be less than wallet balance to leave room for fees.');
    }

    if (!execute) {
      console.log('Dry run only. Re-run with --execute to broadcast.');
      return;
    }

    const tx = await tronWeb.transactionBuilder.sendTrx(
      target.toAddress,
      Number(trxTransferAmount),
      target.fromAddress
    );
    const signedTx = await tronWeb.trx.sign(tx);
    const result = await tronWeb.trx.sendRawTransaction(signedTx);

    if (!result.result) {
      throw new Error(`TRX transfer failed: ${result.message || JSON.stringify(result)}`);
    }

    console.log(`TRX transfer broadcast: ${result.txid}`);

    if (mark) {
      await markSwept(target, result.txid);
      console.log('Marked derived address sweep metadata.');
    }
    return;
  }

  if (tokenTransferAmount <= 0n) {
    throw new Error('No USDT amount to transfer.');
  }
  if (tokenTransferAmount > tokenBalance) {
    throw new Error('Requested --amount is greater than the wallet USDT balance.');
  }

  if (shouldPrefund) {
    await prefundTrxIfNeeded({
      TronWebClass,
      childAddress: target.fromAddress,
      currentSun: trxBalance,
      minSun,
      fundingPrivateKey,
      fundingWalletIndex: target.fundingWalletIndex,
      hdWallet,
      execute,
    });
  } else if (trxBalance < minSun) {
    console.warn(
      `Warning: TRX balance is below --min-trx (${formatTrx(minSun)}). ` +
      'The USDT transfer may fail.'
    );
  }

  if (!execute) {
    console.log('Dry run only. Re-run with --execute to broadcast.');
    return;
  }

  const txHash = await contract.transfer(target.toAddress, tokenTransferAmount.toString()).send({
    feeLimit: 100_000_000,
    callValue: 0,
    shouldPollResponse: false,
  });

  console.log(`USDT transfer broadcast: ${txHash}`);

  if (mark) {
    await markSwept(target, txHash);
    console.log('Marked derived address sweep metadata.');
  }
}

main()
  .catch((error: Error) => {
    console.error(`Recovery failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    destroyHDWalletService();
    if (pool) {
      await pool.end();
    }
  });
