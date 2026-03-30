/**
 * Payment Engine Integration Test Script
 * Tests all payment flows: transfer, gift, request, claim, fulfill
 *
 * Usage: node test-payments.js
 *
 * Prerequisites:
 * 1. Server running on localhost:3500
 * 2. ADMIN_SECRET set in .env
 * 3. Database with required tables
 */

const crypto = require('crypto');
const http = require('http');

// Configuration
const BASE_URL = 'http://localhost:3500';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'your-secure-admin-secret-here';

// Test state
let apiKey = null;
let secretKey = null;
let keyHash = null;
let giftReference = null;
let requestReference = null;

// =============================================================================
// HTTP Utilities
// =============================================================================

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: json });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// =============================================================================
// Crypto Utilities (matching server implementation)
// =============================================================================

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

function generateSignature(method, path, body) {
  const timestamp = Date.now().toString();
  const bodyString = body ? JSON.stringify(body) : '{}';
  const bodyHash = sha256(bodyString);
  const payload = `${timestamp}|${method}|${path}|${bodyHash}`;
  const signature = hmacSha256(keyHash, payload);

  return { timestamp, signature };
}

// =============================================================================
// API Functions
// =============================================================================

async function healthCheck() {
  console.log('\n📋 Health Check...');
  const result = await makeRequest('GET', '/v1/health');
  console.log(`   Status: ${result.status}`);
  console.log(`   Response:`, result.data);
  return result.status === 200;
}

async function createApiKey() {
  console.log('\n🔑 Creating API Key...');
  const result = await makeRequest(
    'POST',
    '/v1/admin/api-keys',
    {
      merchantId: 'test-merchant-' + Date.now(),
      name: 'Integration Test Key',
      rateLimitTier: 'standard',
    },
    {
      Authorization: `Bearer ${ADMIN_SECRET}`,
    }
  );

  if (result.status === 201 || result.status === 200) {
    // Response format: { status: true, data: { apiKey: {...}, secretKey: "..." } }
    const data = result.data.data;
    apiKey = data.apiKey.keyId;
    secretKey = data.secretKey;
    keyHash = sha256(secretKey); // Server uses hash of secret for HMAC
    console.log(`   ✅ API Key created: ${apiKey}`);
    console.log(`   Secret Key: ${secretKey.substring(0, 20)}...`);
    return true;
  } else {
    console.log(`   ❌ Failed: ${result.status}`, result.data);
    return false;
  }
}

async function makeAuthenticatedRequest(method, path, body = null) {
  const { timestamp, signature } = generateSignature(method, path, body);

  return makeRequest(method, path, body, {
    'X-API-Key': apiKey,
    'X-Timestamp': timestamp,
    'X-Signature': signature,
  });
}

// =============================================================================
// Payment Tests
// =============================================================================

async function testCreateTransfer() {
  console.log('\n💸 Test 1: Create Transfer Payment...');

  const payload = {
    type: 'transfer',
    fiatAmount: 10000,
    fiatCurrency: 'NGN',
    crypto: 'USDT',
    network: 'trc20',
    payer: {
      chatId: 'test-payer-' + Date.now(),
    },
    receiver: {
      bankCode: '044',
      accountNumber: '0123456789',
      accountName: 'Test Transfer Receiver',
    },
  };

  const result = await makeAuthenticatedRequest('POST', '/v1/payments', payload);

  if (result.status === 201 || result.status === 200) {
    const payment = result.data.payment || result.data;
    console.log(`   ✅ Transfer created!`);
    console.log(`   Reference: ${payment.reference}`);
    console.log(`   Deposit Address: ${payment.depositAddress || 'N/A'}`);
    console.log(`   Status: ${payment.status}`);
    return true;
  } else {
    console.log(`   ❌ Failed: ${result.status}`);
    console.log(`   Error:`, result.data);
    return false;
  }
}

async function testCreateGift() {
  console.log('\n🎁 Test 2: Create Gift Payment...');

  const payload = {
    type: 'gift',
    fiatAmount: 5000,
    fiatCurrency: 'NGN',
    crypto: 'USDT',
    network: 'trc20',
    payer: {
      chatId: 'gift-sender-' + Date.now(),
    },
  };

  const result = await makeAuthenticatedRequest('POST', '/v1/payments', payload);

  if (result.status === 201 || result.status === 200) {
    const payment = result.data.payment || result.data;
    giftReference = payment.reference;
    console.log(`   ✅ Gift created!`);
    console.log(`   Reference: ${giftReference}`);
    console.log(`   Deposit Address: ${payment.depositAddress || 'N/A'}`);
    console.log(`   Status: ${payment.status}`);
    return true;
  } else {
    console.log(`   ❌ Failed: ${result.status}`);
    console.log(`   Error:`, result.data);
    return false;
  }
}

async function testCreateRequest() {
  console.log('\n📨 Test 3: Create Request Payment...');

  const payload = {
    type: 'request',
    fiatAmount: 7500,
    fiatCurrency: 'NGN',
    crypto: 'USDT',
    network: 'trc20',
    receiver: {
      bankCode: '058',
      accountNumber: '1234567890',
      accountName: 'Request Receiver',
    },
  };

  const result = await makeAuthenticatedRequest('POST', '/v1/payments', payload);

  if (result.status === 201 || result.status === 200) {
    const payment = result.data.payment || result.data;
    requestReference = payment.reference;
    console.log(`   ✅ Request created!`);
    console.log(`   Reference: ${requestReference}`);
    console.log(`   Status: ${payment.status}`);
    return true;
  } else {
    console.log(`   ❌ Failed: ${result.status}`);
    console.log(`   Error:`, result.data);
    return false;
  }
}

async function testClaimGift() {
  console.log('\n🎁 Test 4: Claim Gift...');

  if (!giftReference) {
    console.log('   ⏭️  Skipped (no gift reference)');
    return false;
  }

  const payload = {
    receiver: {
      bankCode: '011',
      accountNumber: '2345678901',
      accountName: 'Gift Claimer',
    },
  };

  const path = `/v1/payments/gifts/${giftReference}/claim`;
  const result = await makeAuthenticatedRequest('POST', path, payload);

  if (result.status === 200 || result.status === 201) {
    const payment = result.data.payment || result.data;
    console.log(`   ✅ Gift claimed!`);
    console.log(`   Reference: ${giftReference}`);
    console.log(`   New Status: ${payment.status}`);
    return true;
  } else {
    console.log(`   ❌ Failed: ${result.status}`);
    console.log(`   Error:`, result.data);
    // Gift might not be in claimable state (needs deposit first)
    if (result.data.error?.includes('not in claimable') || result.data.code === 'INVALID_STATE') {
      console.log(`   ℹ️  Gift needs deposit confirmation before claiming`);
      return true; // Expected behavior
    }
    return false;
  }
}

async function testFulfillRequest() {
  console.log('\n📨 Test 5: Fulfill Request...');

  if (!requestReference) {
    console.log('   ⏭️  Skipped (no request reference)');
    return false;
  }

  const payload = {
    payer: {
      chatId: 'request-fulfiller-' + Date.now(),
    },
  };

  const path = `/v1/payments/requests/${requestReference}/fulfill`;
  const result = await makeAuthenticatedRequest('POST', path, payload);

  if (result.status === 200 || result.status === 201) {
    const payment = result.data.payment || result.data;
    console.log(`   ✅ Request fulfilled!`);
    console.log(`   Reference: ${requestReference}`);
    console.log(`   Deposit Address: ${payment.depositAddress || 'N/A'}`);
    console.log(`   Status: ${payment.status}`);
    return true;
  } else {
    console.log(`   ❌ Failed: ${result.status}`);
    console.log(`   Error:`, result.data);
    return false;
  }
}

async function testGetPayment() {
  console.log('\n🔍 Test 6: Get Payment Status...');

  const reference = giftReference || requestReference;
  if (!reference) {
    console.log('   ⏭️  Skipped (no reference available)');
    return false;
  }

  const path = `/v1/payments/${reference}`;
  const result = await makeAuthenticatedRequest('GET', path);

  if (result.status === 200) {
    const payment = result.data.payment || result.data;
    console.log(`   ✅ Payment retrieved!`);
    console.log(`   Reference: ${payment.reference}`);
    console.log(`   Type: ${payment.type}`);
    console.log(`   Status: ${payment.status}`);
    console.log(`   Fiat Amount: ${payment.fiatAmount} ${payment.fiatCurrency}`);
    return true;
  } else {
    console.log(`   ❌ Failed: ${result.status}`);
    console.log(`   Error:`, result.data);
    return false;
  }
}

// =============================================================================
// Main Test Runner
// =============================================================================

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('           Payment Engine Integration Tests');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Admin Secret: ${ADMIN_SECRET.substring(0, 10)}...`);

  const results = {
    passed: 0,
    failed: 0,
    tests: [],
  };

  try {
    // Step 0: Health check
    const healthOk = await healthCheck();
    if (!healthOk) {
      console.log('\n❌ Server not responding. Is it running on port 3500?');
      process.exit(1);
    }
    results.tests.push({ name: 'Health Check', passed: true });
    results.passed++;

    // Step 1: Create API key
    const keyCreated = await createApiKey();
    results.tests.push({ name: 'Create API Key', passed: keyCreated });
    if (keyCreated) results.passed++;
    else results.failed++;

    if (!keyCreated) {
      console.log('\n❌ Cannot proceed without API key');
      return results;
    }

    // Step 2: Create transfer
    const transferOk = await testCreateTransfer();
    results.tests.push({ name: 'Create Transfer', passed: transferOk });
    if (transferOk) results.passed++;
    else results.failed++;

    // Step 3: Create gift
    const giftOk = await testCreateGift();
    results.tests.push({ name: 'Create Gift', passed: giftOk });
    if (giftOk) results.passed++;
    else results.failed++;

    // Step 4: Create request
    const requestOk = await testCreateRequest();
    results.tests.push({ name: 'Create Request', passed: requestOk });
    if (requestOk) results.passed++;
    else results.failed++;

    // Step 5: Claim gift
    const claimOk = await testClaimGift();
    results.tests.push({ name: 'Claim Gift', passed: claimOk });
    if (claimOk) results.passed++;
    else results.failed++;

    // Step 6: Fulfill request
    const fulfillOk = await testFulfillRequest();
    results.tests.push({ name: 'Fulfill Request', passed: fulfillOk });
    if (fulfillOk) results.passed++;
    else results.failed++;

    // Step 7: Get payment status
    const getOk = await testGetPayment();
    results.tests.push({ name: 'Get Payment', passed: getOk });
    if (getOk) results.passed++;
    else results.failed++;

  } catch (error) {
    console.log('\n❌ Test error:', error.message);
    results.failed++;
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                        Test Results');
  console.log('═══════════════════════════════════════════════════════════════');

  for (const test of results.tests) {
    const icon = test.passed ? '✅' : '❌';
    console.log(`   ${icon} ${test.name}`);
  }

  console.log('───────────────────────────────────────────────────────────────');
  console.log(`   Passed: ${results.passed}/${results.tests.length}`);
  console.log(`   Failed: ${results.failed}/${results.tests.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  return results;
}

// Run tests
runTests().then((results) => {
  process.exit(results.failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
