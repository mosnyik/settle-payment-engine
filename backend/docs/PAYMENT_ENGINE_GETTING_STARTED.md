# Payment Engine - Getting Started Guide

A crypto-to-fiat payment processing API supporting transfers, gifts, payment requests, and merchant payments with automatic settlement.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [Payment Types](#payment-types)
- [API Reference](#api-reference)
- [Payment Flows](#payment-flows)
- [Code Examples](#code-examples)
- [Settlement & Webhooks](#settlement--webhooks)
- [Best Practices](#best-practices)
- [Error Handling](#error-handling)
- [FAQ](#faq)

---

## Overview

### What is the Payment Engine?

The Payment Engine enables crypto-to-fiat payments. Users pay in cryptocurrency, and recipients receive local currency (fiat) directly to their bank accounts.

**Key Features:**
- **Multiple Payment Types** - Transfers, gifts, payment requests, merchant checkout
- **Multi-Crypto Support** - BTC, ETH, BNB, TRX, USDT, USDC
- **Automatic Monitoring** - Blockchain watchers detect and confirm deposits
- **Instant Settlement** - Fiat payouts to bank accounts upon confirmation
- **HD Wallet Technology** - Unique deposit address for each payment

### Supported Currencies

**Cryptocurrencies:**

| Crypto | Networks | Description |
|--------|----------|-------------|
| BTC | `bitcoin` | Bitcoin native |
| ETH | `ethereum` | Ethereum native |
| BNB | `bsc` | BNB Chain native |
| TRX | `tron` | Tron native |
| USDT | `ethereum`, `erc20`, `bsc`, `bep20`, `tron`, `trc20` | Tether stablecoin |
| USDC | `ethereum`, `erc20`, `bsc`, `bep20` | USD Coin stablecoin |

**Fiat Currencies:**

| Currency | Country |
|----------|---------|
| NGN | Nigeria |
| GHS | Ghana |
| KES | Kenya |
| ZAR | South Africa |

### How It Works

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Your App   │     │Payment Engine│     │  Blockchain  │     │  Bank/Fiat   │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       │ 1. Create Payment  │                    │                    │
       │───────────────────>│                    │                    │
       │                    │                    │                    │
       │ 2. Deposit Address │                    │                    │
       │<───────────────────│                    │                    │
       │                    │                    │                    │
       │    (User sends     │                    │                    │
       │     crypto)        │                    │                    │
       │                    │ 3. Detect Deposit  │                    │
       │                    │<───────────────────│                    │
       │                    │                    │                    │
       │                    │ 4. Confirm (wait)  │                    │
       │                    │<───────────────────│                    │
       │                    │                    │                    │
       │                    │ 5. Send Fiat       │                    │
       │                    │───────────────────────────────────────>│
       │                    │                    │                    │
       │ 6. Callback/Poll   │                    │                    │
       │<───────────────────│                    │                    │
       │                    │                    │                    │
```

---

## Quick Start

### Step 1: Get Your API Credentials

Request an API key from the administrator:

```bash
# Admin creates your API key
curl -X POST https://api.2settle.io/v1/admin/api-keys \
  -H "Authorization: Bearer ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "your-company-id",
    "name": "Production Payment API",
    "permissions": ["payment:create", "payment:read"],
    "rateLimitTier": "standard"
  }'
```

Response:
```json
{
  "status": true,
  "message": "API key created successfully. Save the secretKey - it will not be shown again.",
  "data": {
    "apiKey": {
      "keyId": "pk_abc123...",
      "permissions": ["payment:create", "payment:read"]
    },
    "secretKey": "sk_xyz789..."
  }
}
```

**Important:** Save the `secretKey` immediately - it cannot be retrieved later!

### Step 2: Create Your First Payment

```bash
curl -X POST https://api.2settle.io/v1/payments \
  -H "Content-Type: application/json" \
  -H "X-API-Key: pk_your_api_key" \
  -H "X-Timestamp: 1709472000000" \
  -H "X-Signature: your_hmac_signature" \
  -d '{
    "type": "transfer",
    "fiatAmount": 10000,
    "fiatCurrency": "NGN",
    "crypto": "USDT",
    "network": "trc20",
    "payer": {
      "chatId": "user_123"
    },
    "receiver": {
      "bankCode": "044",
      "accountNumber": "0123456789",
      "accountName": "John Doe"
    }
  }'
```

Response:
```json
{
  "success": true,
  "payment": {
    "id": "pay_abc123xyz",
    "reference": "2S-A1B2C3",
    "type": "transfer",
    "status": "pending",
    "depositAddress": "TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "cryptoAmount": 6.95,
    "crypto": "USDT",
    "network": "trc20",
    "fiatAmount": 10000,
    "fiatCurrency": "NGN",
    "rate": 1439.00,
    "chargeAmount": 500,
    "expiresAt": "2024-03-03T11:00:00.000Z"
  }
}
```

### Step 3: Display Payment Details to User

Show the user:
- **Deposit Address:** `TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
- **Amount to Send:** `6.95 USDT`
- **Network:** `TRC20 (Tron)`

### Step 4: Monitor Payment Status

Poll the status or wait for callback:

```bash
curl -X GET https://api.2settle.io/v1/payments/2S-A1B2C3 \
  -H "X-API-Key: pk_your_api_key" \
  -H "X-Timestamp: 1709472000000" \
  -H "X-Signature: your_hmac_signature"
```

---

## Authentication

All API requests require HMAC-SHA256 signature authentication.

### Required Headers

| Header | Description |
|--------|-------------|
| `X-API-Key` | Your public API key (`pk_xxx...`) |
| `X-Timestamp` | Current Unix timestamp in milliseconds |
| `X-Signature` | HMAC-SHA256 signature of the request |
| `Content-Type` | `application/json` |

### Signature Generation

```javascript
const crypto = require('crypto');

function signRequest(secretKey, method, path, body = {}) {
  const timestamp = Date.now().toString();

  // Step 1: Stringify and hash the body (use minified JSON)
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

// Example usage
const { timestamp, signature, bodyStr } = signRequest(
  'sk_your_secret_key',
  'POST',
  '/v1/payments',
  { type: 'transfer', fiatAmount: 10000, ... }
);
```

### Security Notes

- **Timestamp Tolerance:** Requests older than 5 minutes are rejected
- **Secret Key Hashing:** We use `SHA256(secretKey)` as the HMAC key for additional security
- **Body Hashing:** The request body is hashed to prevent tampering

---

## Payment Types

### Overview

| Type | Payer | Receiver | Use Case |
|------|-------|----------|----------|
| `transfer` | Required | Required | Direct crypto-to-bank payment |
| `gift` | Required | Optional (claim later) | Send crypto gift to anyone |
| `request` | Optional (fulfill later) | Required | Invoice/payment request |
| `merchant` | Optional | Optional | E-commerce checkout |

### Transfer

Direct payment where both payer and receiver are known upfront.

```
Payer ──[Crypto]──> Payment Engine ──[Fiat]──> Receiver's Bank
```

**Required Fields:**
- `payer.chatId` - Identifier for the person paying
- `receiver.bankCode`, `receiver.accountNumber`, `receiver.accountName` - Bank details

### Gift

Sender pays crypto, receiver claims later with their bank details.

```
1. Sender creates gift ──> Gets reference code
2. Sender pays crypto  ──> Deposit confirmed
3. Sender shares code  ──> Recipient receives code
4. Recipient claims    ──> Provides bank details
5. Settlement          ──> Fiat sent to recipient
```

**Required Fields (Creation):**
- `payer.chatId` - Gift sender's identifier

**Required Fields (Claim):**
- `receiver.bankCode`, `receiver.accountNumber`, `receiver.accountName`

### Request

Receiver creates a payment request, payer fulfills later.

```
1. Receiver creates request ──> Gets reference code (no crypto specified yet)
2. Receiver shares code     ──> Payer receives code
3. Payer fulfills           ──> Chooses crypto, gets deposit address
4. Payer sends crypto       ──> Deposit confirmed
5. Settlement               ──> Fiat sent to receiver
```

**Required Fields (Creation):**
- `receiver.bankCode`, `receiver.accountNumber`, `receiver.accountName`
- `fiatAmount`, `fiatCurrency`
- Crypto/network are **optional** at creation (can be set at fulfillment)

**Required Fields (Fulfill):**
- `payer.chatId`
- `crypto`, `network` (if not set at creation)

### Merchant

E-commerce checkout flow (customizable).

---

## API Reference

### Base URL

```
https://api.2settle.io
```

All API endpoints are prefixed with `/v1`. For example: `https://api.2settle.io/v1/payments`

### Permissions

| Permission | Description |
|------------|-------------|
| `payment:create` | Create new payments |
| `payment:read` | Read payment status |
| `payment:*` | All payment operations |

---

### Create Payment

Create a new payment of any type.

```
POST /v1/payments
```

**Required Permission:** `payment:create`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | `transfer`, `gift`, `request`, or `merchant` |
| `fiatAmount` | number | Yes | Amount in fiat currency |
| `fiatCurrency` | string | Yes | `NGN`, `GHS`, `KES`, `ZAR` |
| `crypto` | string | Conditional | Required for transfer/gift; optional for request |
| `network` | string | Conditional | Required for transfer/gift; optional for request |
| `payer` | object | Conditional | Required for transfer/gift |
| `payer.chatId` | string | Yes (if payer) | Payer identifier |
| `payer.phone` | string | No | Payer phone number |
| `receiver` | object | Conditional | Required for transfer/request |
| `receiver.bankCode` | string | Yes (if receiver) | Bank code |
| `receiver.accountNumber` | string | Yes (if receiver) | Account number |
| `receiver.accountName` | string | Yes (if receiver) | Account holder name |
| `metadata` | object | No | Custom data for your reference |
| `callbackUrl` | string | No | URL for status callbacks |

#### Example: Create Transfer

```json
POST /v1/payments
{
  "type": "transfer",
  "fiatAmount": 10000,
  "fiatCurrency": "NGN",
  "crypto": "USDT",
  "network": "trc20",
  "payer": {
    "chatId": "telegram_123456"
  },
  "receiver": {
    "bankCode": "044",
    "accountNumber": "0123456789",
    "accountName": "John Doe"
  },
  "metadata": {
    "orderId": "ORD-001",
    "description": "Product purchase"
  }
}
```

**Response:**
```json
{
  "success": true,
  "payment": {
    "id": "pay_r7CNReshKvFlKaec",
    "reference": "2S-7N4VFR",
    "type": "transfer",
    "status": "pending",
    "depositAddress": "TDrhiGeJ11zNStTLhcJt4CvqSwyUVbHPZR",
    "cryptoAmount": 6.95,
    "crypto": "USDT",
    "network": "trc20",
    "fiatAmount": 10000,
    "fiatCurrency": "NGN",
    "rate": 1439.00,
    "chargeAmount": 500,
    "expiresAt": "2024-03-03T11:00:00.000Z"
  }
}
```

#### Example: Create Gift

```json
POST /v1/payments
{
  "type": "gift",
  "fiatAmount": 5000,
  "fiatCurrency": "NGN",
  "crypto": "BTC",
  "network": "bitcoin",
  "payer": {
    "chatId": "sender_456"
  },
  "metadata": {
    "message": "Happy Birthday!"
  }
}
```

**Response:**
```json
{
  "success": true,
  "payment": {
    "id": "pay_giftXYZ123",
    "reference": "2S-GIFT01",
    "type": "gift",
    "status": "pending",
    "depositAddress": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    "cryptoAmount": 0.00012,
    "crypto": "BTC",
    "network": "bitcoin",
    "fiatAmount": 5000,
    "fiatCurrency": "NGN",
    "rate": 41666666.67
  }
}
```

#### Example: Create Request (Deferred Crypto)

When creating a request, you can omit `crypto` and `network`. The payer will choose when fulfilling.

```json
POST /v1/payments
{
  "type": "request",
  "fiatAmount": 25000,
  "fiatCurrency": "NGN",
  "receiver": {
    "bankCode": "058",
    "accountNumber": "1234567890",
    "accountName": "Jane Smith"
  },
  "metadata": {
    "invoiceId": "INV-2024-001"
  }
}
```

**Response:**
```json
{
  "success": true,
  "payment": {
    "id": "pay_reqABC789",
    "reference": "2S-REQ001",
    "type": "request",
    "status": "created",
    "fiatAmount": 25000,
    "fiatCurrency": "NGN"
  }
}
```

Note: No `depositAddress`, `crypto`, or `cryptoAmount` yet - these are set when fulfilled.

---

### Get Payment

Retrieve payment details by reference.

```
GET /v1/payments/:reference
```

**Required Permission:** `payment:read`

**Example Request:**
```
GET /v1/payments/2S-7N4VFR
```

**Response:**
```json
{
  "success": true,
  "payment": {
    "id": "pay_r7CNReshKvFlKaec",
    "reference": "2S-7N4VFR",
    "type": "transfer",
    "status": "confirmed",
    "depositAddress": "TDrhiGeJ11zNStTLhcJt4CvqSwyUVbHPZR",
    "cryptoAmount": 6.95,
    "crypto": "USDT",
    "network": "trc20",
    "fiatAmount": 10000,
    "fiatCurrency": "NGN",
    "rate": 1439.00,
    "chargeAmount": 500,
    "txHash": "abc123def456...",
    "confirmations": 19,
    "receivedAmount": 6.95,
    "expiresAt": "2024-03-03T11:00:00.000Z",
    "confirmedAt": "2024-03-03T10:15:00.000Z",
    "settledAt": null
  }
}
```

---

### Claim Gift

Claim a gift by providing receiver bank details.

```
POST /v1/payments/gifts/:reference/claim
```

**No special permission required** (gift recipient doesn't need API key)

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `receiver.bankCode` | string | Yes | Bank code |
| `receiver.accountNumber` | string | Yes | Account number |
| `receiver.accountName` | string | Yes | Account holder name |

**Example Request:**
```json
POST /v1/payments/gifts/2S-GIFT01/claim
{
  "receiver": {
    "bankCode": "044",
    "accountNumber": "9876543210",
    "accountName": "Gift Recipient"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Gift claimed successfully",
  "payment": {
    "id": "pay_giftXYZ123",
    "reference": "2S-GIFT01",
    "status": "confirmed",
    "receiverId": 42
  }
}
```

**Error Cases:**
- Gift not found: `404`
- Already claimed: `400 - Gift has already been claimed`
- Not a gift: `400 - Payment is not a gift`

---

### Fulfill Request

Fulfill a payment request by providing payer details and choosing crypto.

```
POST /v1/payments/requests/:reference/fulfill
```

**No special permission required** (payer fulfilling a request)

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `payer.chatId` | string | Yes | Payer identifier |
| `crypto` | string | Yes | Cryptocurrency to pay with |
| `network` | string | Yes | Blockchain network |

**Example Request:**
```json
POST /v1/payments/requests/2S-REQ001/fulfill
{
  "payer": {
    "chatId": "payer_789"
  },
  "crypto": "USDT",
  "network": "trc20"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Request fulfilled successfully",
  "payment": {
    "id": "pay_reqABC789",
    "reference": "2S-REQ001",
    "status": "pending",
    "depositAddress": "TLqfASsFNgZ8UhRqJq9fCaMLB5yauoYB1m",
    "cryptoAmount": 17.38,
    "crypto": "USDT",
    "network": "trc20",
    "rate": 1439.00,
    "chargeAmount": 500,
    "fiatAmount": 25000,
    "fiatCurrency": "NGN",
    "expiresAt": "2024-03-03T11:30:00.000Z",
    "payerId": 15
  }
}
```

**Key Points:**
- Rate is locked at fulfillment time (not request creation)
- Crypto amount is calculated based on current rate
- Deposit address is assigned at fulfillment

---

### Payment Statuses

| Status | Description | Next Steps |
|--------|-------------|------------|
| `created` | Request created, awaiting fulfillment | Payer needs to fulfill |
| `pending` | Awaiting crypto deposit | User sends crypto |
| `confirming` | Deposit detected, awaiting confirmations | Wait for blockchain |
| `confirmed` | Fully confirmed, ready for settlement | Auto-settles |
| `settling` | Fiat payout in progress | Wait for bank |
| `settled` | Complete - fiat sent | Done |
| `expired` | Payment timed out | Create new payment |
| `failed` | Error occurred | Check error, retry |

---

## Payment Flows

### Transfer Flow (Complete Example)

```javascript
// 1. Create transfer
const payment = await client.createPayment({
  type: 'transfer',
  fiatAmount: 10000,
  fiatCurrency: 'NGN',
  crypto: 'USDT',
  network: 'trc20',
  payer: { chatId: 'user_123' },
  receiver: {
    bankCode: '044',
    accountNumber: '0123456789',
    accountName: 'John Doe',
  },
});

// 2. Display to user
console.log(`Send ${payment.cryptoAmount} USDT to:`);
console.log(payment.depositAddress);

// 3. Poll for status (or use callback)
let status = payment.status;
while (status !== 'settled' && status !== 'failed') {
  await sleep(30000); // 30 seconds
  const updated = await client.getPayment(payment.reference);
  status = updated.status;
  console.log(`Status: ${status}`);
}

// 4. Complete
if (status === 'settled') {
  console.log('Payment complete! Fiat sent to receiver.');
}
```

### Gift Flow (Complete Example)

```javascript
// === SENDER SIDE ===

// 1. Create gift
const gift = await client.createPayment({
  type: 'gift',
  fiatAmount: 5000,
  fiatCurrency: 'NGN',
  crypto: 'USDT',
  network: 'trc20',
  payer: { chatId: 'sender_456' },
  metadata: { message: 'Happy Birthday!' },
});

// 2. Sender pays crypto
console.log(`Send ${gift.cryptoAmount} USDT to ${gift.depositAddress}`);

// 3. Share reference with recipient
const giftCode = gift.reference; // e.g., "2S-GIFT01"
console.log(`Share this code: ${giftCode}`);


// === RECIPIENT SIDE ===

// 4. Recipient claims gift
const claimed = await client.claimGift(giftCode, {
  receiver: {
    bankCode: '058',
    accountNumber: '9876543210',
    accountName: 'Gift Recipient',
  },
});

// 5. Settlement happens automatically
console.log('Gift claimed! Funds will be sent to your bank.');
```

### Request Flow (Complete Example)

```javascript
// === REQUESTER SIDE ===

// 1. Create request (no crypto specified)
const request = await client.createPayment({
  type: 'request',
  fiatAmount: 15000,
  fiatCurrency: 'NGN',
  receiver: {
    bankCode: '044',
    accountNumber: '1234567890',
    accountName: 'Jane Smith',
  },
  metadata: { invoiceId: 'INV-001' },
});

// 2. Share reference with payer
const requestCode = request.reference; // e.g., "2S-REQ001"
console.log(`Ask payer to pay: ${requestCode}`);
console.log(`Amount: 15,000 NGN`);


// === PAYER SIDE ===

// 3. Payer fulfills (chooses crypto at this point)
const fulfilled = await client.fulfillRequest(requestCode, {
  payer: { chatId: 'payer_789' },
  crypto: 'USDT',
  network: 'trc20',
});

// 4. Payer sends crypto
console.log(`Send ${fulfilled.cryptoAmount} USDT to:`);
console.log(fulfilled.depositAddress);

// 5. Settlement happens automatically to requester's bank
```

---

## Code Examples

### Node.js Client

```javascript
const crypto = require('crypto');

class PaymentEngineClient {
  constructor(apiKey, secretKey, baseUrl = 'https://api.2settle.io') {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = baseUrl;
  }

  sign(method, path, body = {}) {
    const timestamp = Date.now().toString();
    const bodyStr = JSON.stringify(body);
    const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
    const payload = `${timestamp}|${method}|${path}|${bodyHash}`;
    const hmacKey = crypto.createHash('sha256').update(this.secretKey).digest('hex');
    const signature = crypto.createHmac('sha256', hmacKey).update(payload).digest('hex');
    return { timestamp, signature, bodyStr };
  }

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

  // Create any payment type
  async createPayment(options) {
    return this.request('POST', '/v1/payments', options);
  }

  // Get payment by reference
  async getPayment(reference) {
    return this.request('GET', `/v1/payments/${reference}`, {});
  }

  // Claim a gift
  async claimGift(reference, receiver) {
    return this.request('POST', `/v1/payments/gifts/${reference}/claim`, { receiver });
  }

  // Fulfill a request
  async fulfillRequest(reference, options) {
    return this.request('POST', `/v1/payments/requests/${reference}/fulfill`, options);
  }
}

// Usage
const client = new PaymentEngineClient('pk_xxx', 'sk_xxx');

// Create a transfer
const transfer = await client.createPayment({
  type: 'transfer',
  fiatAmount: 10000,
  fiatCurrency: 'NGN',
  crypto: 'USDT',
  network: 'trc20',
  payer: { chatId: 'user_123' },
  receiver: {
    bankCode: '044',
    accountNumber: '0123456789',
    accountName: 'John Doe',
  },
});

console.log(`Deposit ${transfer.payment.cryptoAmount} USDT to:`);
console.log(transfer.payment.depositAddress);
```

### Python Client

```python
import hashlib
import hmac
import json
import time
import requests

class PaymentEngineClient:
    def __init__(self, api_key: str, secret_key: str, base_url: str = 'https://api.2settle.io'):
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

        response = requests.request(
            method,
            f"{self.base_url}{path}",
            headers={
                'Content-Type': 'application/json',
                'X-API-Key': self.api_key,
                'X-Timestamp': timestamp,
                'X-Signature': signature,
            },
            data=body_str if method != 'GET' else None,
        )
        return response.json()

    def create_payment(self, payment_type: str, fiat_amount: float, fiat_currency: str,
                       crypto: str = None, network: str = None,
                       payer: dict = None, receiver: dict = None, **kwargs):
        body = {
            'type': payment_type,
            'fiatAmount': fiat_amount,
            'fiatCurrency': fiat_currency,
        }
        if crypto: body['crypto'] = crypto
        if network: body['network'] = network
        if payer: body['payer'] = payer
        if receiver: body['receiver'] = receiver
        body.update(kwargs)
        return self._request('POST', '/v1/payments', body)

    def get_payment(self, reference: str):
        return self._request('GET', f'/v1/payments/{reference}', {})

    def claim_gift(self, reference: str, receiver: dict):
        return self._request('POST', f'/v1/payments/gifts/{reference}/claim', {'receiver': receiver})

    def fulfill_request(self, reference: str, payer: dict, crypto: str, network: str):
        return self._request('POST', f'/v1/payments/requests/{reference}/fulfill', {
            'payer': payer,
            'crypto': crypto,
            'network': network,
        })


# Usage
client = PaymentEngineClient('pk_xxx', 'sk_xxx')

# Create a transfer
result = client.create_payment(
    payment_type='transfer',
    fiat_amount=10000,
    fiat_currency='NGN',
    crypto='USDT',
    network='trc20',
    payer={'chatId': 'user_123'},
    receiver={
        'bankCode': '044',
        'accountNumber': '0123456789',
        'accountName': 'John Doe',
    }
)

print(f"Deposit {result['payment']['cryptoAmount']} USDT to:")
print(result['payment']['depositAddress'])
```

### PHP Client

```php
<?php

class PaymentEngineClient {
    private string $apiKey;
    private string $secretKey;
    private string $baseUrl;

    public function __construct(string $apiKey, string $secretKey, string $baseUrl = 'https://api.2settle.io') {
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

    public function createPayment(array $options): array {
        return $this->request('POST', '/v1/payments', $options);
    }

    public function getPayment(string $reference): array {
        return $this->request('GET', "/v1/payments/{$reference}", []);
    }

    public function claimGift(string $reference, array $receiver): array {
        return $this->request('POST', "/v1/payments/gifts/{$reference}/claim", ['receiver' => $receiver]);
    }

    public function fulfillRequest(string $reference, array $payer, string $crypto, string $network): array {
        return $this->request('POST', "/v1/payments/requests/{$reference}/fulfill", [
            'payer' => $payer,
            'crypto' => $crypto,
            'network' => $network,
        ]);
    }
}

// Usage
$client = new PaymentEngineClient('pk_xxx', 'sk_xxx');

$result = $client->createPayment([
    'type' => 'transfer',
    'fiatAmount' => 10000,
    'fiatCurrency' => 'NGN',
    'crypto' => 'USDT',
    'network' => 'trc20',
    'payer' => ['chatId' => 'user_123'],
    'receiver' => [
        'bankCode' => '044',
        'accountNumber' => '0123456789',
        'accountName' => 'John Doe',
    ],
]);

echo "Deposit {$result['payment']['cryptoAmount']} USDT to:\n";
echo $result['payment']['depositAddress'] . "\n";
```

---

## Settlement & Webhooks

### Automatic Settlement

When a deposit is confirmed, settlement happens automatically:

1. **Deposit Confirmed** - Required blockchain confirmations reached
2. **Fiat Payout Initiated** - Bank transfer started via settlement provider
3. **Status Updated** - Payment status changes to `settled`

### Callback URL

Set `callbackUrl` when creating a payment to receive status updates:

```json
{
  "type": "transfer",
  "fiatAmount": 10000,
  "callbackUrl": "https://yourapp.com/webhooks/payments",
  ...
}
```

### Callback Payload

```json
{
  "event": "payment.confirmed",
  "payment": {
    "id": "pay_abc123",
    "reference": "2S-7N4VFR",
    "status": "confirmed",
    "txHash": "abc123...",
    "confirmations": 19,
    "receivedAmount": 6.95
  },
  "metadata": {
    "orderId": "ORD-001"
  }
}
```

### Confirmation Requirements

| Network | Confirmations | Typical Time |
|---------|---------------|--------------|
| Bitcoin | 2 | ~20 minutes |
| Ethereum | 12 | ~3 minutes |
| BSC | 15 | ~1 minute |
| Tron | 19 | ~1 minute |

---

## Best Practices

### 1. Always Use Metadata

Include identifying information to correlate payments with your system:

```javascript
const payment = await client.createPayment({
  type: 'transfer',
  // ... other fields
  metadata: {
    orderId: 'ORD-12345',
    userId: 'user_abc',
    productId: 'prod_xyz',
    environment: process.env.NODE_ENV,
  },
});
```

### 2. Store Payment References

Always store the payment reference with your order:

```javascript
const payment = await client.createPayment({ ... });

await db.orders.update(orderId, {
  paymentReference: payment.payment.reference,
  paymentId: payment.payment.id,
  depositAddress: payment.payment.depositAddress,
  cryptoAmount: payment.payment.cryptoAmount,
});
```

### 3. Handle Expiration

Payments expire after 30 minutes by default. Handle this gracefully:

```javascript
async function checkPaymentStatus(reference) {
  const result = await client.getPayment(reference);

  if (result.payment.status === 'expired') {
    // Offer to create a new payment
    return { expired: true, message: 'Payment expired. Please try again.' };
  }

  return result.payment;
}
```

### 4. Implement Idempotency

Prevent duplicate payments for the same order:

```javascript
async function getOrCreatePayment(orderId, paymentDetails) {
  const order = await db.orders.get(orderId);

  // Return existing payment if already created
  if (order.paymentReference) {
    return client.getPayment(order.paymentReference);
  }

  // Create new payment
  const payment = await client.createPayment(paymentDetails);

  // Store reference immediately
  await db.orders.update(orderId, {
    paymentReference: payment.payment.reference,
  });

  return payment;
}
```

### 5. Choose Network by Transaction Size

Optimize for fees based on amount:

```javascript
function selectOptimalNetwork(crypto, fiatAmount) {
  if (crypto === 'USDT' || crypto === 'USDC') {
    // TRC20 has lowest fees - best for small amounts
    if (fiatAmount < 50000) return 'trc20';
    // BEP20 for medium amounts
    if (fiatAmount < 500000) return 'bep20';
    // ERC20 for large amounts (fee % is smaller)
    return 'erc20';
  }

  // Native coins use their primary network
  return { BTC: 'bitcoin', ETH: 'ethereum', BNB: 'bsc', TRX: 'tron' }[crypto];
}
```

### 6. Validate Bank Details Upfront

Verify bank details before creating payment to avoid settlement failures:

```javascript
// Your app should validate bank account exists
const isValid = await validateBankAccount(bankCode, accountNumber);

if (!isValid) {
  throw new Error('Invalid bank account');
}

// Then create payment
const payment = await client.createPayment({ ... });
```

---

## Error Handling

### Error Response Format

```json
{
  "success": false,
  "error": "Human readable error message",
  "code": "ERROR_CODE",
  "details": { }
}
```

### Common Error Codes

| Code | HTTP | Description | Resolution |
|------|------|-------------|------------|
| `MISSING_API_KEY` | 401 | No X-API-Key header | Add API key header |
| `INVALID_API_KEY` | 401 | API key not found | Check API key |
| `INVALID_SIGNATURE` | 401 | HMAC mismatch | Verify signature logic |
| `SIGNATURE_EXPIRED` | 401 | Timestamp too old | Use current timestamp |
| `PERMISSION_DENIED` | 403 | Missing permission | Request permission |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests | Implement backoff |
| `VALIDATION_ERROR` | 400 | Invalid input | Check request body |
| `PAYMENT_NOT_FOUND` | 404 | Reference not found | Verify reference |
| `PAYMENT_EXPIRED` | 400 | Payment timed out | Create new payment |
| `ALREADY_CLAIMED` | 400 | Gift already claimed | Cannot reclaim |
| `ALREADY_FULFILLED` | 400 | Request already fulfilled | Cannot refulfill |
| `INVALID_NETWORK` | 400 | Crypto/network mismatch | Check valid combinations |

### Retry Strategy

```javascript
async function requestWithRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const shouldRetry =
        error.status >= 500 ||
        error.code === 'RATE_LIMIT_EXCEEDED';

      if (!shouldRetry || attempt === maxRetries) {
        throw error;
      }

      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

---

## FAQ

### What's the difference between payment ID and reference?

- **ID** (`pay_abc123`): Internal identifier, used in database
- **Reference** (`2S-A1B2C3`): Human-friendly code for sharing with users

### Can users pay more or less than the exact amount?

Yes, with a 2% tolerance. Overpayments are processed normally. Significant underpayments may require manual handling.

### What happens if settlement fails?

1. System retries automatically
2. If retries fail, Telegram alert is sent to admin
3. Admin can manually trigger settlement via `/v1/admin/sessions/:reference/settle`

### How long do payments take?

| Stage | Time |
|-------|------|
| Create payment | Instant |
| Detect deposit | 5-60 seconds |
| Confirmations | 1-20 minutes (varies by chain) |
| Fiat settlement | 1-5 minutes |

### Can I cancel a payment?

Payments cannot be cancelled once crypto is sent. Before deposit, simply let the payment expire.

### What are the minimum/maximum amounts?

- **Minimum:** Varies by crypto (typically $1 equivalent)
- **Maximum:** Based on your account tier and daily limits

### How do I test in development?

1. Use testnet API endpoint (if available)
2. Create test API keys with limited permissions
3. Use small amounts on mainnet for integration testing

---

## Support

- **API Status:** https://status.example.com
- **Documentation:** https://docs.example.com
- **Email:** support@example.com

---

*Last updated: March 2024*
