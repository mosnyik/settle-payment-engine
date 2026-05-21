/**
 * Sync Paystack Bank Codes
 *
 * Fetches the full bank list from Paystack and populates the `paystack_code`
 * column in the `banks` table by matching Paystack/NIP codes first, then
 * known aliases and fuzzy bank names.
 *
 * Usage:
 *   npx tsx scripts/sync-paystack-banks.ts
 *   npx tsx scripts/sync-paystack-banks.ts --dry-run
 *   npx tsx scripts/sync-paystack-banks.ts --db-host=localhost --db-user=root --db-password=secret --db-name=2settle
 *   npx tsx scripts/sync-paystack-banks.ts --host localhost --user root --password secret --db 2settle
 *
 * Prerequisites:
 *   ALTER TABLE banks ADD COLUMN IF NOT EXISTS paystack_code VARCHAR(20) NULL;
 *   (MySQL 8.0 doesn't support IF NOT EXISTS on ALTER TABLE — run manually if needed)
 */

import axios from 'axios';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { RowDataPacket, Pool } from 'mysql2/promise';
import { PaystackBankLike, findPaystackBankMatch } from '../src/services/payment-engine/settlement/paystack-bank-matcher';

// dotenv MUST load before the mysql pool is created — use require() to prevent import hoisting
dotenv.config({ path: resolve(__dirname, '../.env') });

function getArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(name);
  if (index !== -1) return process.argv[index + 1];

  return undefined;
}

const dbArgMap: Array<[string, string]> = [
  ['--db-host', 'DB_HOST'],
  ['--host', 'DB_HOST'],
  ['--db-port', 'DB_PORT'],
  ['--port', 'DB_PORT'],
  ['--db-user', 'DB_USER'],
  ['--user', 'DB_USER'],
  ['--db-password', 'DB_PASSWORD'],
  ['--password', 'DB_PASSWORD'],
  ['--db-name', 'DB_NAME'],
  ['--db-database', 'DB_NAME'],
  ['--db', 'DB_NAME'],
];

for (const [argName, envName] of dbArgMap) {
  const value = getArg(argName);
  if (value !== undefined) process.env[envName] = value;
}

const pool: Pool = require('../src/lib/mysql').pool;

const DRY_RUN = process.argv.includes('--dry-run');

interface PaystackBank extends PaystackBankLike {
  id: number;
  name: string;
  slug: string;
  code: string;
  longcode: string;
  type: string;
  active: boolean;
  country: string;
}

interface BankRow extends RowDataPacket {
  id: number;
  name: string;
  code: string;
  paystack_code: string | null;
}

async function fetchPaystackBanks(): Promise<PaystackBank[]> {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY not set in .env');

  const banks: PaystackBank[] = [];
  let page = 1;
  const perPage = 100;
  const maxPages = 20;
  const seenPageSignatures = new Set<string>();

  while (true) {
    if (page > maxPages) {
      throw new Error(`Paystack bank pagination exceeded ${maxPages} pages; aborting to avoid an infinite loop`);
    }

    const res = await axios.get<{ status: boolean; data: PaystackBank[] }>(
      `https://api.paystack.co/bank?country=nigeria&perPage=${perPage}&page=${page}&include_nip_sort_code=true`,
      { headers: { Authorization: `Bearer ${key}` }, timeout: 15000 }
    );
    const chunk = res.data.data;
    console.log(`  Page ${page}: ${chunk?.length ?? 0} banks returned (total: ${banks.length + (chunk?.length ?? 0)})`);
    if (!chunk || chunk.length === 0) break;

    const pageSignature = chunk.map(bank => `${bank.id}:${bank.code}`).join('|');
    if (seenPageSignatures.has(pageSignature)) {
      throw new Error(`Paystack returned a repeated bank page at page ${page}; aborting to avoid an infinite loop`);
    }
    seenPageSignatures.add(pageSignature);

    banks.push(...chunk);
    if (chunk.length > perPage) {
      console.log(`  Paystack returned more than ${perPage} banks on one page; treating response as complete.`);
      break;
    }
    if (chunk.length < perPage) break;
    page++;
  }

  return banks;
}

async function main() {
  console.log(`=== Sync Paystack Bank Codes ${DRY_RUN ? '[DRY RUN]' : ''} ===\n`);

  // 1. Fetch Paystack bank list
  console.log('Fetching banks from Paystack...');
  let paystackBanks: PaystackBank[];
  try {
    paystackBanks = await fetchPaystackBanks();
  } catch (err: any) {
    console.error('Paystack fetch failed:', err.message);
    if (err.response) console.error('  Status:', err.response.status, JSON.stringify(err.response.data));
    await pool.end();
    process.exit(1);
  }
  console.log(`  Got ${paystackBanks!.length} banks from Paystack\n`);

  // 2. Load our banks table
  const [rows] = await pool.execute<BankRow[]>('SELECT id, name, code, paystack_code FROM banks');
  console.log(`  Got ${rows.length} banks in our DB\n`);

  const THRESHOLD = 0.5; // minimum similarity to accept a match

  const updates: { id: number; ourName: string; ourCode: string; paystackName: string; paystackCode: string; score: number; reason: string }[] = [];
  const unmatched: { name: string; code: string }[] = [];

  for (const bank of rows) {
    const match = findPaystackBankMatch(bank.code, bank.name, paystackBanks, THRESHOLD);

    if (match) {
      updates.push({
        id: bank.id,
        ourName: bank.name,
        ourCode: bank.code,
        paystackName: match.bank.name,
        paystackCode: match.bank.code,
        score: match.score,
        reason: match.reason,
      });
    } else {
      unmatched.push({ name: bank.name, code: bank.code });
    }
  }

  // 3. Report matches
  console.log(`MATCHED (${updates.length}):`);
  for (const u of updates) {
    const flag = u.score < 0.8 ? ' ⚠ low confidence' : '';
    console.log(`  [${u.ourCode}] "${u.ourName}" → paystack_code=${u.paystackCode} "${u.paystackName}" (score=${u.score.toFixed(2)})${flag}`);
  }

  if (unmatched.length > 0) {
    console.log(`\nUNMATCHED (${unmatched.length}) — paystack_code will be left NULL:`);
    for (const u of unmatched) {
      console.log(`  [${u.code}] "${u.name}"`);
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes written. Re-run without --dry-run to apply.');
    await pool.end();
    return;
  }

  // 4. Apply updates
  console.log(`\nWriting ${updates.length} paystack_code values...`);
  let written = 0;
  for (const u of updates) {
    await pool.execute('UPDATE banks SET paystack_code = ? WHERE id = ?', [u.paystackCode, u.id]);
    written++;
  }

  // 5. Clear stale recipient codes so they get regenerated with correct bank codes
  const [rcResult] = await pool.execute('UPDATE receivers SET paystack_recipient_code = NULL') as any;
  console.log(`Cleared ${rcResult.affectedRows} stale paystack_recipient_code entries from receivers table`);

  console.log(`\nDone. ${written} banks updated, ${unmatched.length} unmatched.\n`);
  await pool.end();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
