/**
 * Test Wallet-as-a-Service API
 */

const crypto = require('crypto');

const BASE_URL = 'http://localhost:3500';
const ADMIN_SECRET = 'test-admin-secret-123';

let API_KEY = '';
let SECRET_KEY = '';

function generateSignature(method, path, body) {
  const timestamp = Date.now().toString();
  const bodyStr = JSON.stringify(body || {});
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
  const payload = `${timestamp}|${method.toUpperCase()}|${path}|${bodyHash}`;
  const hmacKey = crypto.createHash('sha256').update(SECRET_KEY).digest('hex');
  const signature = crypto.createHmac('sha256', hmacKey).update(payload).digest('hex');
  return { timestamp, signature, bodyStr };
}

async function adminRequest(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_SECRET}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function apiRequest(method, path, body) {
  const fullPath = path.startsWith('/v1') ? path : `/v1${path}`;
  const { timestamp, signature, bodyStr } = generateSignature(method, fullPath, body);

  const res = await fetch(`${BASE_URL}${fullPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
    },
    body: method !== 'GET' ? bodyStr : undefined,
  });
  return res.json();
}

async function test(name, fn) {
  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST: ${name}`);
    console.log('='.repeat(60));
    await fn();
    console.log(`PASSED`);
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }
}

async function runTests() {
  // Step 1: Create API key with wallet permissions
  await test('Create API key with wallet permissions', async () => {
    const result = await adminRequest('POST', '/v1/admin/api-keys', {
      merchantId: 'wallet-test',
      name: 'Wallet API Test Key',
      rateLimitTier: 'standard',
      permissions: ['wallet:create', 'wallet:read'],
    });

    console.log('Response:', JSON.stringify(result, null, 2));

    if (!result.status) throw new Error(`Failed: ${result.message || result.error}`);

    API_KEY = result.data.apiKey.keyId;
    SECRET_KEY = result.data.secretKey;

    console.log(`API Key: ${API_KEY}`);
    console.log(`Secret Key: ${SECRET_KEY}`);
  });

  // Step 2: Create wallet - USDT on TRC20
  let walletId = '';
  await test('Create wallet (USDT on trc20)', async () => {
    const result = await apiRequest('POST', '/wallets', {
      network: 'trc20',
      crypto: 'USDT',
      metadata: { orderId: 'test-123', customer: 'John Doe' },
    });

    console.log('Response:', JSON.stringify(result, null, 2));

    if (!result.success) throw new Error(`Failed: ${result.error}`);
    if (!result.wallet.address) throw new Error('No address returned');
    if (result.wallet.status !== 'watching') throw new Error('Status should be watching');

    walletId = result.wallet.id;
    console.log(`Wallet ID: ${walletId}`);
    console.log(`Address: ${result.wallet.address}`);
  });

  // Step 3: Get wallet by ID
  await test('Get wallet by ID', async () => {
    const result = await apiRequest('GET', `/wallets/${walletId}`, {});

    console.log('Response:', JSON.stringify(result, null, 2));

    if (!result.success) throw new Error(`Failed: ${result.error}`);
    if (result.wallet.id !== walletId) throw new Error('Wallet ID mismatch');
  });

  // Step 4: Create another wallet - BTC
  await test('Create wallet (BTC on bitcoin)', async () => {
    const result = await apiRequest('POST', '/wallets', {
      network: 'bitcoin',
      crypto: 'BTC',
    });

    console.log('Response:', JSON.stringify(result, null, 2));

    if (!result.success) throw new Error(`Failed: ${result.error}`);
    if (!result.wallet.address.startsWith('bc1')) throw new Error('Expected bech32 address');
  });

  // Step 5: Create wallet - ETH
  await test('Create wallet (ETH on ethereum)', async () => {
    const result = await apiRequest('POST', '/wallets', {
      network: 'ethereum',
      crypto: 'ETH',
      expiresInMinutes: 60,
    });

    console.log('Response:', JSON.stringify(result, null, 2));

    if (!result.success) throw new Error(`Failed: ${result.error}`);
    if (!result.wallet.address.startsWith('0x')) throw new Error('Expected 0x address');
    if (!result.wallet.expiresAt) throw new Error('Should have expiresAt');
  });

  // Step 6: List all wallets
  await test('List all wallets', async () => {
    const result = await apiRequest('GET', '/wallets', {});

    console.log('Response:', JSON.stringify(result, null, 2));

    if (!result.success) throw new Error(`Failed: ${result.error}`);
    if (result.wallets.length < 3) throw new Error('Should have at least 3 wallets');
    console.log(`Total wallets: ${result.wallets.length}`);
  });

  // Step 7: Invalid crypto/network combo
  await test('Invalid crypto/network combo (should fail)', async () => {
    const result = await apiRequest('POST', '/wallets', {
      network: 'trc20',
      crypto: 'BTC', // BTC not supported on trc20
    });

    console.log('Response:', JSON.stringify(result, null, 2));

    if (result.success) throw new Error('Should have failed');
    console.log('Correctly rejected invalid combo');
  });

  // Step 8: Test permission denied (no payment permission)
  await test('Create payment without permission (should fail)', async () => {
    const result = await apiRequest('POST', '/payments', {
      type: 'transfer',
      fiatAmount: 1000,
      fiatCurrency: 'NGN',
      crypto: 'USDT',
      network: 'trc20',
      payer: { chatId: '123' },
      receiver: { bankCode: '044', accountNumber: '1234567890', accountName: 'Test' },
    });

    console.log('Response:', JSON.stringify(result, null, 2));

    if (result.success) throw new Error('Should have failed - no payment permission');
    console.log('Correctly denied - no payment permission');
  });

  console.log('\n' + '='.repeat(60));
  console.log('ALL TESTS COMPLETED');
  console.log('='.repeat(60));
}

runTests().catch(console.error);
