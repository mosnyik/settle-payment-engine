/**
 * Update gift fields for all gifts with a matching amount_payable value.
 *
 * Sample commands:
 *   pnpm run update:gift-fields-by-amount -- --amount 5000
 *   pnpm run update:gift-fields-by-amount -- --amount 5000 --crypto-amount 4.03375422 --current-rate 1363.4941 --charges 500.00000000
 *   pnpm run update:gift-fields-by-amount -- --amount 5000 --crypto-amount 4.03375422 --current-rate 1363.4941 --charges 500.00000000 --apply
 *   pnpm run update:gift-fields-by-amount -- --amount 5000 --host YOUR_HOST --user YOUR_USER --password YOUR_PASSWORD --db YOUR_DB --apply
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

const envPaths = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

function getArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function assertDatabaseName(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Invalid database name: ${name}`);
  }
}

async function main() {
  const database = getArg('--db', process.env.DB_NAME || 'settle_db_test');
  const host = getArg('--host', process.env.DB_HOST || '127.0.0.1');
  const port = Number(getArg('--port', process.env.DB_PORT || '3306'));
  const user = getArg('--user', process.env.DB_USER || 'root');
  const password = getArg('--password', process.env.DB_PASSWORD || '');
  const amount = Number(getArg('--amount', '5000'));
  const cryptoAmount = getArg('--crypto-amount', '4.03375422');
  const currentRate = getArg('--current-rate', '1363.4941');
  const charges = getArg('--charges', '500.00000000');
  const status = getArg('--status', 'confirmed');
  const giftStatus = getArg('--gift-status', 'Not claimed');
  const apply = hasFlag('--apply');

  assertDatabaseName(database);

  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
  });

  try {
    const [countRows] = await connection.query(
      `
        SELECT COUNT(*) AS matchCount
        FROM gifts
        WHERE amount_payable = ?
      `,
      [amount]
    );

    const [sampleRows] = await connection.query(
      `
        SELECT id, gift_id, amount_payable, crypto_amount, current_rate, charges, gift_status, status
        FROM gifts
        WHERE amount_payable = ?
        ORDER BY id DESC
        LIMIT 10
      `,
      [amount]
    );

    console.log(`Database: ${database}`);
    console.log(`Matching gifts: ${countRows[0].matchCount}`);
    if (sampleRows.length > 0) {
      console.table(sampleRows);
    }

    if (!apply) {
      console.log('Dry run only. Re-run with --apply to update matching gifts.');
      return;
    }

    const [result] = await connection.query(
      `
        UPDATE gifts
        SET crypto_amount = ?,
            current_rate = ?,
            charges = ?,
            gift_status = ?,
            status = ?
        WHERE amount_payable = ?
      `,
      [cryptoAmount, currentRate, charges, giftStatus, status, amount]
    );

    console.log(`Updated rows: ${result.affectedRows}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Failed to update gift fields: ${error.message}`);
  process.exit(1);
});
