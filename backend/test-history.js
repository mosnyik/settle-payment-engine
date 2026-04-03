/**
 * Test script for GET /v1/history
 *
 * Usage:
 *   ADMIN_SECRET=your-secret node test-history.js
 *
 * Or if you already have an API key + secret:
 *   API_KEY=pk_... API_SECRET=sk_... node test-history.js
 */

const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load env from chat app's .env.development.local
const envPath = path.resolve(__dirname, '../../chat.2settle_new/.env.development.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8')
    .split('\n')
    .forEach((line) => {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
      }
    });
}

const BASE_URL = 'http://localhost:3500';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'your-secure-admin-secret-here';

let apiKey = process.env.SETTLE_API_KEY || process.env.API_KEY || null;
let keyHash = process.env.SETTLE_API_SECRET
  ? sha256(process.env.SETTLE_API_SECRET)
  : process.env.API_SECRET
  ? sha256(process.env.API_SECRET)
  : null;

// =============================================================================
// Crypto helpers (must match server)
// =============================================================================

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

function buildAuthHeaders(method, path, body = null) {
  const timestamp = Date.now().toString();
  const bodyString = body ? JSON.stringify(body) : '{}';
  const bodyHash = sha256(bodyString);
  const payload = `${timestamp}|${method.toUpperCase()}|${path}|${bodyHash}`;
  const signature = hmacSha256(keyHash, payload);

  return {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey,
    'X-Timestamp': timestamp,
    'X-Signature': signature,
  };
}

// =============================================================================
// HTTP helpers
// =============================================================================

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function get(path) {
  const url = new URL(path, BASE_URL);
  const enginePath = url.pathname; // path without query string for signing
  return request('GET', path, null, buildAuthHeaders('GET', enginePath));
}

// =============================================================================
// Setup: create a temporary API key if none provided
// =============================================================================

async function createApiKey() {
  console.log('\n--- Creating temporary API key ---');
  const res = await request(
    'POST',
    '/v1/admin/api-keys',
    { merchantId: 'history-test-' + Date.now(), name: 'History Test Key', rateLimitTier: 'standard' },
    { Authorization: `Bearer ${ADMIN_SECRET}` }
  );

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Failed to create API key: ${JSON.stringify(res.data)}`);
  }

  const { apiKey: key, secretKey } = res.data.data;
  apiKey = key.keyId;
  keyHash = sha256(secretKey);
  console.log(`API Key: ${apiKey}`);
  console.log(`(save this for future runs: API_KEY=${apiKey} API_SECRET=${secretKey})\n`);
}

// =============================================================================
// Tests
// =============================================================================

async function testAllTransactions() {
  console.log('--- GET /v1/history (all) ---');
  const res = await get('/v1/history?limit=5');
  console.log(`Status: ${res.status}`);
  console.log(`Total: ${res.data?.data?.total}`);
  console.log(`Returned: ${res.data?.data?.transactions?.length} records`);
  if (res.data?.data?.transactions?.length) {
    console.log('First record:', JSON.stringify(res.data.data.transactions[0], null, 2));
  }
  return res.status === 200;
}

async function testFilterByStatus() {
  console.log('\n--- GET /v1/history?status=Successful ---');
  const res = await get('/v1/history?status=Successful&limit=5');
  console.log(`Status: ${res.status}`);
  console.log(`Total successful: ${res.data?.data?.total}`);
  const statuses = [...new Set((res.data?.data?.transactions || []).map(t => t.display_status))];
  console.log(`Unique statuses in result: ${statuses.join(', ')}`);
  return res.status === 200;
}

async function testFilterByType() {
  console.log('\n--- GET /v1/history?type=transfer ---');
  const res = await get('/v1/history?type=transfer&limit=5');
  console.log(`Status: ${res.status}`);
  console.log(`Total transfers: ${res.data?.data?.total}`);
  return res.status === 200;
}

async function testPagination() {
  console.log('\n--- Pagination: page 1 vs page 2 ---');
  const page1 = await get('/v1/history?limit=3&offset=0');
  const page2 = await get('/v1/history?limit=3&offset=3');
  const ids1 = (page1.data?.data?.transactions || []).map(t => t.transac_id);
  const ids2 = (page2.data?.data?.transactions || []).map(t => t.transac_id);
  const overlap = ids1.filter(id => ids2.includes(id));
  console.log(`Page 1 IDs: ${ids1.join(', ')}`);
  console.log(`Page 2 IDs: ${ids2.join(', ')}`);
  console.log(`Overlap (should be 0): ${overlap.length}`);
  return overlap.length === 0;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('=== /v1/history endpoint test ===\n');

  try {
    if (!apiKey || !keyHash) {
      await createApiKey();
    } else {
      console.log(`Using existing API key: ${apiKey}\n`);
    }

    const results = await Promise.allSettled([
      testAllTransactions(),
      testFilterByStatus(),
      testFilterByType(),
      testPagination(),
    ]);

    console.log('\n=== Results ===');
    const labels = ['All transactions', 'Filter by status', 'Filter by type', 'Pagination'];
    results.forEach((r, i) => {
      const pass = r.status === 'fulfilled' && r.value === true;
      console.log(`${pass ? '✓' : '✗'} ${labels[i]}${r.status === 'rejected' ? ': ' + r.reason : ''}`);
    });
  } catch (err) {
    console.error('\nFatal error:', err.message);
    process.exit(1);
  }
}

main();
