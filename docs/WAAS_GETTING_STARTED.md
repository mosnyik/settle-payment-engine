# 2settle HD Wallet Service (HDWaaS) - Getting Started Guide

Generate unique cryptocurrency deposit addresses on demand with automatic deposit detection and webhook notifications.

> **Alias:** Throughout this documentation and in code examples, we use **HDWaaS** as the short name for 2settle HD Wallet Service.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [API Reference](#api-reference)
- [Code Examples](#code-examples)
- [Webhooks](#webhooks)
- [Best Practices](#best-practices)
- [Error Handling](#error-handling)
- [FAQ](#faq)

---

## Overview

### What is 2settle HD Wallet Service?

Wallet-as-a-Service allows you to generate unique HD wallet addresses for each customer deposit. Instead of managing your own wallet infrastructure, you can:

- **Generate addresses on demand** - Each customer gets a unique deposit address
- **Monitor deposits automatically** - We watch the blockchain for incoming transactions
- **Receive webhook notifications** - Get notified when deposits are detected and confirmed
- **Track everything** - Full visibility into all generated addresses and their status

### Supported Cryptocurrencies

| Crypto | Networks | Use Case |
|--------|----------|----------|
| BTC | `bitcoin` | Native Bitcoin payments |
| ETH | `ethereum` | Native Ethereum payments |
| BNB | `bsc` | Native BNB Chain payments |
| TRX | `tron` | Native Tron payments |
| USDT | `ethereum`, `erc20`, `bsc`, `bep20`, `tron`, `trc20` | Stablecoin payments |
| USDC | `ethereum`, `erc20`, `bsc`, `bep20` | Stablecoin payments |

### How It Works

```
1. Your App                    2. HDWaaS API                 3. Blockchain
   │                              │                              │
   │─── Create Wallet ───────────>│                              │
   │<── Return Address ───────────│                              │
   │                              │                              │
   │    (Customer sends crypto)   │                              │
   │                              │<──── Deposit Detected ───────│
   │<── Webhook: deposit.detected │                              │
   │                              │                              │
   │                              │<──── Confirmations ──────────│
   │<── Webhook: deposit.confirmed│                              │
   │                              │                              │
```

---

## Quick Start

### Step 1: Get Your API Credentials

Contact the administrator to create an API key with wallet permissions:

```bash
# Admin creates your API key
curl -X POST https://api.spend.2settle.io/v1/admin/api-keys \
  -H "Authorization: Bearer ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "your-company-id",
    "name": "Production Wallet API",
    "permissions": ["wallet:create", "wallet:read"],
    "rateLimitTier": "standard"
  }'
```

You'll receive:
- **API Key** (`pk_xxx...`) - Public identifier, safe to store
- **Secret Key** (`sk_xxx...`) - Keep this secret! Used for signing requests

### Step 2: Generate Your First Address

```bash
curl -X POST https://api.spend.2settle.io/v1/wallets \
  -H "Content-Type: application/json" \
  -H "X-API-Key: pk_your_api_key" \
  -H "X-Timestamp: 1709472000000" \
  -H "X-Signature: your_hmac_signature" \
  -d '{
    "network": "trc20",
    "crypto": "USDT",
    "metadata": {
      "orderId": "ORD-12345",
      "customerId": "cust_abc"
    }
  }'
```

Response:
```json
{
  "success": true,
  "wallet": {
    "id": "wal_abc123xyz",
    "address": "TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "network": "trc20",
    "crypto": "USDT",
    "status": "watching",
    "createdAt": "2024-03-03T10:00:00.000Z",
    "metadata": {
      "orderId": "ORD-12345",
      "customerId": "cust_abc"
    }
  }
}
```

### Step 3: Display Address to Customer

Show the generated address to your customer for payment. The address is unique and permanently associated with your API key.

### Step 4: Receive Webhook Notifications

Configure your webhook URL to receive deposit notifications (coming soon).

---

## Authentication

All API requests require HMAC-SHA256 signature authentication.

### Required Headers

| Header | Description |
|--------|-------------|
| `X-API-Key` | Your public API key (`pk_xxx...`) |
| `X-Timestamp` | Current Unix timestamp in milliseconds |
| `X-Signature` | HMAC-SHA256 signature of the request |

### Signature Generation

The signature ensures request integrity and authenticity.

```javascript
const crypto = require('crypto');

function signRequest(secretKey, method, path, body = {}) {
  const timestamp = Date.now().toString();

  // Step 1: Stringify and hash the body
  const bodyStr = JSON.stringify(body);
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');

  // Step 2: Build the payload
  const payload = `${timestamp}|${method}|${path}|${bodyHash}`;

  // Step 3: Derive HMAC key from secret (SHA256 of secretKey)
  const hmacKey = crypto.createHash('sha256').update(secretKey).digest('hex');

  // Step 4: Generate signature
  const signature = crypto.createHmac('sha256', hmacKey).update(payload).digest('hex');

  return { timestamp, signature, bodyStr };
}
```

### Why SHA256(secretKey)?

We use `SHA256(secretKey)` as the HMAC key for security:
- The server stores only the hash, never the raw secret
- Even if the database is compromised, your secret remains safe
- Both client and server derive the same HMAC key

---

## API Reference

### Base URL

```
https://api.spend.2settle.io
```

All API endpoints are prefixed with `/v1`. For example: `https://api.spend.2settle.io/v1/wallets`

### Create Wallet

Generate a new deposit address.

```
POST /v1/wallets
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `network` | string | Yes | Blockchain network (see supported networks) |
| `crypto` | string | Yes | Cryptocurrency symbol |
| `metadata` | object | No | Custom data returned in webhooks |
| `expiresInMinutes` | number | No | Address expiration (1-43200 minutes, max 30 days) |

**Example Request:**

```json
{
  "network": "trc20",
  "crypto": "USDT",
  "metadata": {
    "orderId": "ORD-12345",
    "customerId": "cust_abc",
    "productName": "Premium Subscription"
  },
  "expiresInMinutes": 60
}
```

**Example Response:**

```json
{
  "success": true,
  "wallet": {
    "id": "wal_tW_hoGlA1SpQNB1y",
    "address": "TYVVgZBSUrvntue4WSGWNi15b3er3wiYnh",
    "network": "trc20",
    "crypto": "USDT",
    "status": "watching",
    "createdAt": "2024-03-03T08:38:12.000Z",
    "expiresAt": "2024-03-03T09:38:12.000Z",
    "metadata": {
      "orderId": "ORD-12345",
      "customerId": "cust_abc",
      "productName": "Premium Subscription"
    }
  }
}
```

### Get Wallet

Retrieve wallet details and deposit status.

```
GET /v1/wallets/:id
```

**Example Response (with deposit):**

```json
{
  "success": true,
  "wallet": {
    "id": "wal_tW_hoGlA1SpQNB1y",
    "address": "TYVVgZBSUrvntue4WSGWNi15b3er3wiYnh",
    "network": "trc20",
    "crypto": "USDT",
    "status": "confirmed",
    "txHash": "abc123...",
    "amount": "100.50",
    "confirmations": 19,
    "detectedAt": "2024-03-03T08:45:00.000Z",
    "confirmedAt": "2024-03-03T08:50:00.000Z",
    "createdAt": "2024-03-03T08:38:12.000Z",
    "metadata": {
      "orderId": "ORD-12345"
    }
  }
}
```

### List Wallets

List all wallets for your API key.

```
GET /v1/wallets
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | all | Filter by status: `watching`, `deposit_detected`, `confirmed`, `swept`, `expired` |
| `limit` | number | 50 | Results per page (1-100) |
| `offset` | number | 0 | Pagination offset |

**Example Request:**

```
GET /v1/wallets?status=confirmed&limit=10&offset=0
```

**Example Response:**

```json
{
  "success": true,
  "wallets": [
    {
      "id": "wal_abc123",
      "address": "TYVVgZBSUrvntue4WSGWNi15b3er3wiYnh",
      "network": "trc20",
      "crypto": "USDT",
      "status": "confirmed",
      "amount": "100.50",
      "confirmations": 19,
      "createdAt": "2024-03-03T08:38:12.000Z"
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "returned": 1
  }
}
```

### Wallet Statuses

| Status | Description |
|--------|-------------|
| `watching` | Address is being monitored for deposits |
| `deposit_detected` | Deposit received, awaiting confirmations |
| `confirmed` | Deposit has sufficient confirmations |
| `swept` | Funds have been swept to hot wallet |
| `expired` | Address monitoring expired (if expiration was set) |

---

## Code Examples

### Node.js SDK

```javascript
const crypto = require('crypto');

class HDWaaSClient {
  constructor(apiKey, secretKey, baseUrl = 'https://api.spend.2settle.io') {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = baseUrl;
  }

  // Generate HMAC signature
  sign(method, path, body = {}) {
    const timestamp = Date.now().toString();
    const bodyStr = JSON.stringify(body);
    const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
    const payload = `${timestamp}|${method}|${path}|${bodyHash}`;
    const hmacKey = crypto.createHash('sha256').update(this.secretKey).digest('hex');
    const signature = crypto.createHmac('sha256', hmacKey).update(payload).digest('hex');
    return { timestamp, signature, bodyStr };
  }

  // Make authenticated request
  async request(method, path, body) {
    const { timestamp, signature, bodyStr } = this.sign(method, path, body);

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'X-Timestamp': timestamp,
        'X-Signature': signature,
      },
      body: method !== 'GET' ? bodyStr : undefined,
    });

    return response.json();
  }

  // Create a new wallet address
  async createWallet(options) {
    return this.request('POST', '/v1/wallets', {
      network: options.network,
      crypto: options.crypto,
      metadata: options.metadata,
      expiresInMinutes: options.expiresInMinutes,
    });
  }

  // Get wallet by ID
  async getWallet(walletId) {
    return this.request('GET', `/v1/wallets/${walletId}`, {});
  }

  // List wallets
  async listWallets(options = {}) {
    const params = new URLSearchParams();
    if (options.status) params.append('status', options.status);
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());

    const query = params.toString();
    const path = `/v1/wallets${query ? '?' + query : ''}`;
    return this.request('GET', path, {});
  }
}

// Usage
const client = new HDWaaSClient('pk_your_api_key', 'sk_your_secret_key');

// Create USDT deposit address
const wallet = await client.createWallet({
  network: 'trc20',
  crypto: 'USDT',
  metadata: { orderId: 'ORD-12345' },
  expiresInMinutes: 60,
});

console.log('Deposit address:', wallet.wallet.address);

// Check deposit status
const status = await client.getWallet(wallet.wallet.id);
console.log('Status:', status.wallet.status);
```

### Python SDK

```python
import hashlib
import hmac
import json
import time
import requests

class HDWaaSClient:
    def __init__(self, api_key: str, secret_key: str, base_url: str = 'https://api.spend.2settle.io'):
        self.api_key = api_key
        self.secret_key = secret_key
        self.base_url = base_url

    def _sign(self, method: str, path: str, body: dict = None) -> tuple:
        timestamp = str(int(time.time() * 1000))
        body_str = json.dumps(body or {}, separators=(',', ':'))
        body_hash = hashlib.sha256(body_str.encode()).hexdigest()
        payload = f"{timestamp}|{method}|{path}|{body_hash}"
        hmac_key = hashlib.sha256(self.secret_key.encode()).hexdigest()
        signature = hmac.new(hmac_key.encode(), payload.encode(), hashlib.sha256).hexdigest()
        return timestamp, signature, body_str

    def _request(self, method: str, path: str, body: dict = None):
        timestamp, signature, body_str = self._sign(method, path, body)

        headers = {
            'Content-Type': 'application/json',
            'X-API-Key': self.api_key,
            'X-Timestamp': timestamp,
            'X-Signature': signature,
        }

        response = requests.request(
            method,
            f"{self.base_url}{path}",
            headers=headers,
            data=body_str if method != 'GET' else None,
        )

        return response.json()

    def create_wallet(self, network: str, crypto: str, metadata: dict = None, expires_in_minutes: int = None):
        body = {'network': network, 'crypto': crypto}
        if metadata:
            body['metadata'] = metadata
        if expires_in_minutes:
            body['expiresInMinutes'] = expires_in_minutes
        return self._request('POST', '/v1/wallets', body)

    def get_wallet(self, wallet_id: str):
        return self._request('GET', f'/v1/wallets/{wallet_id}', {})

    def list_wallets(self, status: str = None, limit: int = 50, offset: int = 0):
        params = []
        if status:
            params.append(f"status={status}")
        params.append(f"limit={limit}")
        params.append(f"offset={offset}")
        path = f"/v1/wallets?{'&'.join(params)}"
        return self._request('GET', path, {})


# Usage
client = HDWaaSClient('pk_your_api_key', 'sk_your_secret_key')

# Create USDT deposit address
result = client.create_wallet(
    network='trc20',
    crypto='USDT',
    metadata={'orderId': 'ORD-12345'},
    expires_in_minutes=60
)

print(f"Deposit address: {result['wallet']['address']}")

# Check deposit status
status = client.get_wallet(result['wallet']['id'])
print(f"Status: {status['wallet']['status']}")
```

### PHP SDK

```php
<?php

class HDWaaSClient {
    private string $apiKey;
    private string $secretKey;
    private string $baseUrl;

    public function __construct(string $apiKey, string $secretKey, string $baseUrl = 'https://api.spend.2settle.io') {
        $this->apiKey = $apiKey;
        $this->secretKey = $secretKey;
        $this->baseUrl = $baseUrl;
    }

    private function sign(string $method, string $path, array $body = []): array {
        $timestamp = (string) round(microtime(true) * 1000);
        $bodyStr = json_encode($body ?: new stdClass(), JSON_UNESCAPED_SLASHES);
        $bodyHash = hash('sha256', $bodyStr);
        $payload = "{$timestamp}|{$method}|{$path}|{$bodyHash}";
        $hmacKey = hash('sha256', $this->secretKey);
        $signature = hash_hmac('sha256', $payload, $hmacKey);
        return [$timestamp, $signature, $bodyStr];
    }

    private function request(string $method, string $path, array $body = null): array {
        [$timestamp, $signature, $bodyStr] = $this->sign($method, $path, $body ?? []);

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $this->baseUrl . $path,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'X-API-Key: ' . $this->apiKey,
                'X-Timestamp: ' . $timestamp,
                'X-Signature: ' . $signature,
            ],
        ]);

        if ($method !== 'GET' && $body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $bodyStr);
        }

        $response = curl_exec($ch);
        curl_close($ch);

        return json_decode($response, true);
    }

    public function createWallet(string $network, string $crypto, array $metadata = null, int $expiresInMinutes = null): array {
        $body = ['network' => $network, 'crypto' => $crypto];
        if ($metadata) $body['metadata'] = $metadata;
        if ($expiresInMinutes) $body['expiresInMinutes'] = $expiresInMinutes;
        return $this->request('POST', '/v1/wallets', $body);
    }

    public function getWallet(string $walletId): array {
        return $this->request('GET', "/v1/wallets/{$walletId}", []);
    }

    public function listWallets(string $status = null, int $limit = 50, int $offset = 0): array {
        $query = http_build_query(array_filter([
            'status' => $status,
            'limit' => $limit,
            'offset' => $offset,
        ]));
        return $this->request('GET', "/v1/wallets?{$query}", []);
    }
}

// Usage
$client = new HDWaaSClient('pk_your_api_key', 'sk_your_secret_key');

// Create USDT deposit address
$result = $client->createWallet('trc20', 'USDT', ['orderId' => 'ORD-12345'], 60);
echo "Deposit address: " . $result['wallet']['address'] . "\n";

// Check deposit status
$status = $client->getWallet($result['wallet']['id']);
echo "Status: " . $status['wallet']['status'] . "\n";
```

---

## Webhooks

> **Note:** Webhook functionality is coming soon. This section describes the planned behavior.

### Configuration

Configure your webhook URL when creating your API key:

```json
{
  "merchantId": "your-company",
  "name": "Production Key",
  "permissions": ["wallet:create", "wallet:read"],
  "webhookUrl": "https://yourapp.com/webhooks/crypto"
}
```

### Webhook Events

| Event | Description | When |
|-------|-------------|------|
| `deposit.detected` | Deposit received | 0 confirmations |
| `deposit.confirmed` | Deposit confirmed | Required confirmations reached |
| `sweep.completed` | Funds swept | Funds moved to hot wallet |

### Webhook Payload

```json
{
  "event": "deposit.confirmed",
  "timestamp": "2024-03-03T08:50:00.000Z",
  "wallet": {
    "id": "wal_abc123",
    "address": "TYVVgZBSUrvntue4WSGWNi15b3er3wiYnh",
    "network": "trc20",
    "crypto": "USDT"
  },
  "deposit": {
    "txHash": "abc123...",
    "amount": "100.50",
    "confirmations": 19
  },
  "metadata": {
    "orderId": "ORD-12345",
    "customerId": "cust_abc"
  }
}
```

### Webhook Signature Verification

All webhooks are signed with HMAC-SHA256. Verify the signature to ensure authenticity:

```javascript
function verifyWebhook(payload, signature, webhookSecret) {
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// In your webhook handler
app.post('/webhooks/crypto', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = JSON.stringify(req.body);

  if (!verifyWebhook(payload, signature, process.env.WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }

  // Process webhook
  const { event, wallet, deposit, metadata } = req.body;

  if (event === 'deposit.confirmed') {
    // Update your order status
    await updateOrder(metadata.orderId, {
      status: 'paid',
      txHash: deposit.txHash,
      amount: deposit.amount,
    });
  }

  res.status(200).send('OK');
});
```

---

## Best Practices

### 1. Use Metadata for Correlation

Always include identifying metadata when creating wallets:

```javascript
// Good - includes correlation IDs
const wallet = await client.createWallet({
  network: 'trc20',
  crypto: 'USDT',
  metadata: {
    orderId: 'ORD-12345',        // Your order ID
    customerId: 'cust_abc',      // Your customer ID
    productId: 'prod_xyz',       // What they're paying for
    environment: 'production',   // Helpful for debugging
  },
});

// Bad - no way to correlate deposits to orders
const wallet = await client.createWallet({
  network: 'trc20',
  crypto: 'USDT',
});
```

### 2. Store Wallet IDs

Always store the wallet ID with your order:

```javascript
// When creating payment
const wallet = await waas.createWallet({ ... });

await db.orders.update(orderId, {
  walletId: wallet.wallet.id,
  depositAddress: wallet.wallet.address,
  status: 'awaiting_payment',
});
```

### 3. Set Appropriate Expiration

Use expiration for time-sensitive payments:

```javascript
// 30 minutes for checkout flows
const wallet = await client.createWallet({
  network: 'trc20',
  crypto: 'USDT',
  expiresInMinutes: 30,
  metadata: { orderId },
});

// No expiration for subscription top-ups
const wallet = await client.createWallet({
  network: 'trc20',
  crypto: 'USDT',
  // No expiresInMinutes = never expires
  metadata: { userId, type: 'subscription_topup' },
});
```

### 4. Handle Edge Cases

```javascript
// Poll for status if webhook is delayed
async function checkPaymentStatus(orderId) {
  const order = await db.orders.get(orderId);

  if (!order.walletId) {
    return { status: 'no_wallet' };
  }

  const result = await waas.getWallet(order.walletId);
  const wallet = result.wallet;

  switch (wallet.status) {
    case 'watching':
      return { status: 'awaiting_payment', address: wallet.address };

    case 'deposit_detected':
      return {
        status: 'confirming',
        amount: wallet.amount,
        confirmations: wallet.confirmations,
      };

    case 'confirmed':
      // Update order if not already done
      if (order.status !== 'paid') {
        await markOrderPaid(orderId, wallet);
      }
      return { status: 'paid', txHash: wallet.txHash };

    case 'expired':
      return { status: 'expired' };

    default:
      return { status: wallet.status };
  }
}
```

### 5. Implement Idempotent Order Creation

Prevent duplicate addresses for the same order:

```javascript
async function getOrCreatePaymentAddress(orderId, options) {
  const order = await db.orders.get(orderId);

  // Return existing address if already created
  if (order.walletId) {
    const wallet = await waas.getWallet(order.walletId);
    return wallet.wallet;
  }

  // Create new address
  const result = await waas.createWallet({
    network: options.network,
    crypto: options.crypto,
    metadata: { orderId },
    expiresInMinutes: options.expiresInMinutes,
  });

  // Store wallet ID atomically
  await db.orders.update(orderId, {
    walletId: result.wallet.id,
    depositAddress: result.wallet.address,
  });

  return result.wallet;
}
```

### 6. Use Appropriate Network for Amount

Choose network based on transaction amount to optimize fees:

```javascript
function selectNetwork(crypto, amount) {
  if (crypto === 'USDT') {
    // TRC20 has lowest fees, best for small amounts
    if (amount < 100) return 'trc20';
    // ERC20 for larger amounts where fee % is smaller
    if (amount >= 1000) return 'erc20';
    // BEP20 as middle ground
    return 'bep20';
  }

  // For native coins, use their primary network
  const primaryNetworks = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    BNB: 'bsc',
    TRX: 'tron',
  };

  return primaryNetworks[crypto];
}
```

---

## Error Handling

### Error Response Format

```json
{
  "success": false,
  "error": "Human readable error message",
  "code": "ERROR_CODE",
  "details": { }  // Optional additional context
}
```

### Common Error Codes

| Code | HTTP Status | Description | Resolution |
|------|-------------|-------------|------------|
| `MISSING_API_KEY` | 401 | X-API-Key header not provided | Add X-API-Key header |
| `INVALID_API_KEY` | 401 | API key not found or inactive | Check your API key |
| `INVALID_SIGNATURE` | 401 | HMAC signature mismatch | Verify signature generation |
| `SIGNATURE_EXPIRED` | 401 | Timestamp too old | Use current timestamp |
| `PERMISSION_DENIED` | 403 | Missing required permission | Request additional permissions |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests | Implement backoff |
| `VALIDATION_ERROR` | 400 | Invalid request body | Check request parameters |
| `INVALID_CRYPTO` | 400 | Unsupported cryptocurrency | Use supported crypto |
| `INVALID_NETWORK` | 400 | Crypto not supported on network | Check crypto/network combo |
| `WALLET_NOT_FOUND` | 404 | Wallet ID not found | Verify wallet ID |
| `HD_WALLET_UNAVAILABLE` | 503 | Service temporarily unavailable | Retry later |

### Retry Strategy

```javascript
async function requestWithRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const shouldRetry =
        error.code === 'HD_WALLET_UNAVAILABLE' ||
        error.code === 'RATE_LIMIT_EXCEEDED' ||
        error.status >= 500;

      if (!shouldRetry || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Usage
const wallet = await requestWithRetry(() =>
  client.createWallet({ network: 'trc20', crypto: 'USDT' })
);
```

---

## FAQ

### How long are addresses valid?

Addresses are valid indefinitely unless you set `expiresInMinutes`. Even after expiration, the address remains unique to your account - we just stop actively monitoring it.

### Can I reuse addresses?

Each call to `POST /v1/wallets` generates a new unique address. For recurring payments from the same customer, you can either:
1. Generate a new address each time (recommended)
2. Store and reuse the wallet ID to check for new deposits

### What happens if a customer sends to an expired address?

The deposit will still be detected and credited to your account. Expiration only affects active monitoring - we'll still sweep funds from any address associated with your API key.

### How many confirmations are required?

| Network | Confirmations | Typical Time |
|---------|---------------|--------------|
| Bitcoin | 2 | ~20 minutes |
| Ethereum | 12 | ~3 minutes |
| BSC | 15 | ~1 minute |
| Tron | 19 | ~1 minute |

### What's the minimum deposit amount?

We detect all deposits, but very small amounts ("dust") may not be swept due to network fees exceeding the value. Recommended minimums:

| Crypto | Minimum |
|--------|---------|
| BTC | 0.0001 BTC |
| ETH | 0.001 ETH |
| BNB | 0.01 BNB |
| TRX | 10 TRX |
| USDT/USDC | 1 USD |

### How do I test in development?

Use testnet networks when available, or create a separate API key for testing with lower rate limits.

---

## Support

- **API Status:** https://status.example.com
- **Documentation:** https://docs.example.com
- **Email:** support@example.com

---

*Last updated: March 2024*
