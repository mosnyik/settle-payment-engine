# Payment Engine

A standalone Express API for crypto-to-fiat payment processing. Supports transfers, gifts, payment requests, and merchant payments with HD wallet derivation and automatic fund sweeping.

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Authentication](#authentication)
- [Payment Flows](#payment-flows)
- [HD Wallet Setup](#hd-wallet-setup)
- [Database Setup](#database-setup)
- [Testing with Postman](#testing-with-postman)
- [Project Structure](#project-structure)

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Run database migrations (see Database Setup section)

# Start development server
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test
```

Server runs on `http://localhost:3500` (configurable via PORT).

---

## Configuration

### Environment Variables (.env)

```env
# =============================================================================
# SERVER
# =============================================================================
PORT=3500

# =============================================================================
# DATABASE
# =============================================================================
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=2settle

# =============================================================================
# ADMIN
# =============================================================================
ADMIN_SECRET=your-secure-admin-secret-here

# =============================================================================
# EXTERNAL APIs
# =============================================================================
COINMARKETCAP_API_KEY=your_key
NUBAN_API_KEY=your_key

# =============================================================================
# HD WALLET (Optional - uses legacy wallet pool if disabled)
# =============================================================================
HD_WALLET_ENABLED=true
HD_SEED_PHRASE_ENCRYPTED=<generated_encrypted_seed>
HD_SEED_ENCRYPTION_KEY=<generated_64_char_hex_key>

# Hot Wallets (sweep destinations)
HOT_WALLET_BITCOIN=bc1q...
HOT_WALLET_ETHEREUM=0x...
HOT_WALLET_TRON=T...

# =============================================================================
# SWEEPER (Requires HD Wallet)
# =============================================================================
SWEEPER_ENABLED=true
SWEEPER_BITCOIN_RPC=https://blockstream.info/api
SWEEPER_ETHEREUM_RPC=https://mainnet.infura.io/v3/your_key
SWEEPER_BSC_RPC=https://bsc-dataseed.binance.org
SWEEPER_TRON_RPC=https://api.trongrid.io

# Minimum amounts to sweep
SWEEPER_THRESHOLD_BTC=0.0001
SWEEPER_THRESHOLD_ETH=0.001
SWEEPER_THRESHOLD_BNB=0.001
SWEEPER_THRESHOLD_TRX=10
SWEEPER_THRESHOLD_USDT=1

# =============================================================================
# DEPOSIT WATCHER
# =============================================================================
WATCHER_ENABLED=true
ETHERSCAN_API_KEY=your_key
BSCSCAN_API_KEY=your_key
TRONGRID_API_KEY=your_key

# =============================================================================
# SETTLEMENT (Fiat Payout)
# =============================================================================
SETTLEMENT_ENABLED=true
MONGORO_API_URL=https://api-biz-dev.mongoro.com/api/v1/openapi
MONGORO_TOKEN=your_token
MONGORO_TRANSFERPIN=your_pin
MONGORO_CALLBACK_URL=https://yourapp.com/v1/webhooks/mongoro

# Telegram Alerts
TELEGRAM_ALERTS_ENABLED=true
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# =============================================================================
# SECURITY
# =============================================================================
RATE_LIMIT_ENABLED=true
IP_WHITELIST_ENABLED=true
AUDIT_LOG_ENABLED=true
HMAC_TIMESTAMP_TOLERANCE_MS=300000
```

---

## API Reference

**Base URL:** `http://localhost:3500/v1`

### Public Endpoints (No Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/health` | Health check |
| GET | `/v1/rate/current` | Current exchange rates |
| GET | `/v1/banks` | List supported banks |
| GET | `/v1/crypto/prices` | Crypto prices |

### Admin Endpoints (Bearer Token Auth)

**Header:** `Authorization: Bearer <ADMIN_SECRET>`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/admin/api-keys` | Create API key |
| GET | `/v1/admin/api-keys` | List API keys |
| GET | `/v1/admin/api-keys/:keyId` | Get key details |
| PATCH | `/v1/admin/api-keys/:keyId` | Update key |
| DELETE | `/v1/admin/api-keys/:keyId` | Revoke key |
| POST | `/v1/admin/sessions/:reference/settle` | Manual settlement |

### Payment Endpoints (HMAC Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/payments` | Create payment (any type) |
| GET | `/v1/payments/:reference` | Get payment status |
| POST | `/v1/payments/gifts/:reference/claim` | Claim a gift |
| POST | `/v1/payments/requests/:reference/fulfill` | Fulfill a request |

### Webhook Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/webhooks/mongoro` | Mongoro settlement callbacks |

### Legacy Endpoints (Deprecated)

These still work but return deprecation headers. Use `/v1/payments` instead.

| Deprecated | Use Instead |
|------------|-------------|
| `/v1/transfer/*` | `POST /v1/payments` with `type: "transfer"` |
| `/v1/gifts/*` | `POST /v1/payments` with `type: "gift"` |
| `/v1/requests/*` | `POST /v1/payments` with `type: "request"` |

---

## Authentication

### HMAC Signature Authentication

Protected endpoints require three headers:

```
X-API-Key: pk_xxxxx           # Public key ID
X-Timestamp: 1708267200000    # Unix timestamp (ms)
X-Signature: abc123...        # HMAC-SHA256 signature
```

### Signature Generation (Node.js)

**Important**: The HMAC key is `SHA256(secretKey)`, not the raw secret key. This allows us to store only the hash on the server while both client and server can compute the same HMAC key.

```javascript
const crypto = require('crypto');

const secretKey = 'sk_your_secret_key_here';
const timestamp = Date.now().toString();
const method = 'POST';
const path = '/v1/payments';
const body = JSON.stringify({ type: 'transfer', ... }); // Must be minified JSON

// Step 1: Hash the body
const bodyHash = crypto.createHash('sha256').update(body).digest('hex');

// Step 2: Build payload
const payload = `${timestamp}|${method}|${path}|${bodyHash}`;

// Step 3: Derive HMAC key from secret (SHA256 of secretKey)
const hmacKey = crypto.createHash('sha256').update(secretKey).digest('hex');

// Step 4: Generate signature
const signature = crypto.createHmac('sha256', hmacKey).update(payload).digest('hex');
```

**Why SHA256(secretKey)?**
- Server stores `SHA256(secretKey)` in database (never the raw secret)
- Client computes `SHA256(secretKey)` locally
- Both sides use the same derived key for HMAC
- If database is breached, attacker cannot reverse the hash to get original secret

### Admin Authentication

Admin endpoints use Bearer token:

```
Authorization: Bearer <ADMIN_SECRET>
```

### Security Features

- **Rate Limiting**: 100/1000/10000 requests per minute by tier
- **IP Whitelisting**: Per-API-key with CIDR support
- **Audit Logging**: All requests logged with timestamps, IPs, response times
- **Security Headers**: XSS, HSTS, CSP, no-cache

---

## Payment Flows

### Payment Types

| Type | Payer | Receiver | Crypto/Network | Use Case |
|------|-------|----------|----------------|----------|
| `transfer` | Required | Required | Required | Direct payment |
| `gift` | Required | Optional (claim later) | Required | Send crypto gift |
| `request` | Optional (fulfill later) | Required | Optional (set at fulfill) | Payment invoice |
| `merchant` | Optional | Optional | Required | Merchant checkout |

### Status Lifecycle

```
                              [request without crypto]
                                       ↓
created → pending → confirming → confirmed → settling → settled
   ↓         ↓                       ↓
[fulfill] [deposit]              [if fails]
                                     ↓
                    expired / failed / settlement_reversed
```

| Status | Description |
|--------|-------------|
| `created` | Request created without crypto (awaiting fulfillment) |
| `pending` | Payment has deposit address, awaiting crypto deposit |
| `confirming` | Deposit detected, awaiting confirmations |
| `confirmed` | Fully confirmed, ready for settlement |
| `settling` | Fiat payout in progress |
| `settled` | Complete |
| `expired` | Timed out |
| `failed` | Error occurred |
| `settlement_reversed` | Fiat payout reversed |

**Note:** Transfers and gifts start at `pending` (have deposit address immediately). Requests without crypto start at `created` and move to `pending` when fulfilled.

### 1. Transfer Flow

```json
POST /v1/payments
{
  "type": "transfer",
  "fiatAmount": 10000,
  "fiatCurrency": "NGN",
  "crypto": "USDT",
  "network": "trc20",
  "payer": { "chatId": "123456789" },
  "receiver": {
    "bankCode": "044",
    "accountNumber": "0123456789",
    "accountName": "John Doe"
  }
}
```

1. Create payment → Returns `depositAddress`
2. Payer sends crypto to `depositAddress`
3. Watcher detects deposit → Status: `confirmed`
4. Settlement sends fiat → Status: `settled`

### 2. Gift Flow

```json
POST /v1/payments
{
  "type": "gift",
  "fiatAmount": 5000,
  "fiatCurrency": "NGN",
  "crypto": "BTC",
  "network": "bitcoin",
  "payer": { "chatId": "sender123" }
}
```

1. Create gift → Returns `reference`
2. Sender pays crypto
3. Deposit confirmed
4. Sender shares `reference` with recipient
5. Recipient claims:

```json
POST /v1/payments/gifts/2S-XXXXXX/claim
{
  "receiver": {
    "bankCode": "044",
    "accountNumber": "1234567890",
    "accountName": "Gift Recipient"
  }
}
```

6. Settlement sends fiat

### 3. Request Flow

Payment requests allow the receiver to specify only the fiat amount they want. The payer chooses which crypto to pay with when fulfilling the request, and the exchange rate is locked at that moment.

**Step 1: Create Request (crypto/network optional)**

```json
POST /v1/payments
{
  "type": "request",
  "fiatAmount": 15000,
  "fiatCurrency": "NGN",
  "receiver": {
    "bankCode": "058",
    "accountNumber": "0987654321",
    "accountName": "Jane Smith"
  }
}
```

Response:
```json
{
  "success": true,
  "payment": {
    "reference": "2S-XXXXXX",
    "status": "created",
    "fiatAmount": 15000,
    "fiatCurrency": "NGN",
    "depositAddress": null,
    "cryptoAmount": null,
    "crypto": null,
    "network": null
  }
}
```

**Step 2: Requester shares `reference` with payer**

**Step 3: Payer fulfills (provides crypto/network)**

```json
POST /v1/payments/requests/2S-XXXXXX/fulfill
{
  "payer": { "chatId": "payer456" },
  "crypto": "USDT",
  "network": "trc20"
}
```

Response (rate locked, crypto amount calculated):
```json
{
  "success": true,
  "payment": {
    "reference": "2S-XXXXXX",
    "status": "pending",
    "depositAddress": "T...",
    "cryptoAmount": 9.75,
    "crypto": "USDT",
    "network": "trc20",
    "rate": 1538.46,
    "fiatAmount": 15000
  }
}
```

**Step 4: Payer sends crypto to `depositAddress`**

**Step 5: Deposit confirmed → Settlement to requester**

**Alternative: Pre-specified crypto**

If you know which crypto the payer will use, you can specify it at creation:

```json
POST /v1/payments
{
  "type": "request",
  "fiatAmount": 15000,
  "fiatCurrency": "NGN",
  "crypto": "ETH",
  "network": "ethereum",
  "receiver": { ... }
}
```

This will return `status: "pending"` with `depositAddress` immediately (rate locked at creation).

### Supported Crypto/Network Combinations

| Crypto | Networks |
|--------|----------|
| BTC | `bitcoin` |
| ETH | `ethereum` |
| BNB | `bsc` |
| TRX | `tron` |
| USDT | `ethereum`, `erc20`, `bsc`, `bep20`, `tron`, `trc20` |
| USDC | `ethereum`, `erc20`, `bsc`, `bep20` |

---

## HD Wallet Setup

HD wallet provides unlimited unique deposit addresses derived from a single seed phrase.

### Generate Encrypted Seed

```bash
node generate-hd-keys.js
```

Enter your 12 or 24 word mnemonic (ALL ON ONE LINE). It outputs:

```
HD_WALLET_ENABLED=true
HD_SEED_PHRASE_ENCRYPTED=<encrypted_value>
HD_SEED_ENCRYPTION_KEY=<64_char_hex_key>
```

Add these to your `.env` file.

### Derivation Paths

| Chain | Path | Networks |
|-------|------|----------|
| Bitcoin | `m/84'/0'/0'/0/{index}` | bitcoin |
| Ethereum | `m/44'/60'/0'/0/{index}` | ethereum, bsc, polygon, base, erc20, bep20 |
| Tron | `m/44'/195'/0'/0/{index}` | tron, trc20 |

### Disable HD Wallet

To use legacy wallet pool:

```env
HD_WALLET_ENABLED=false
```

---

## Database Setup

### Run All Migrations

```sql
-- Core payment tables
source src/services/payment-engine/migrations/001_create_payment_tables.sql

-- HD wallet tables
source src/services/payment-engine/hd-wallet/migrations/001_create_hd_wallet_tables.sql

-- Watcher tables
source src/services/payment-engine/watcher/migrations/001_create_watcher_tables.sql

-- Settlement tables
source src/services/payment-engine/settlement/migrations/001_create_settlement_tables.sql

-- Security tables
source src/security/migrations/001_create_security_tables.sql
```

### Core Tables

| Table | Description |
|-------|-------------|
| `payment_sessions` | Main payment records |
| `payers` | Payer information |
| `receivers` | Receiver bank details |
| `wallets` | Legacy wallet pool |
| `rates` | Exchange rates |
| `transfers` | Legacy transfer records |
| `gifts` | Legacy gift records |
| `requests` | Legacy request records |

### HD Wallet Tables

| Table | Description |
|-------|-------------|
| `hd_wallet_config` | Derivation index per chain |
| `derived_addresses` | Audit trail |
| `sweep_transactions` | Sweep records |

### Security Tables

| Table | Description |
|-------|-------------|
| `api_keys` | API credentials |
| `audit_logs` | Request audit trail |

---

## Testing with Postman

### 1. Start Server

```bash
pnpm dev
```

### 2. Test Public Endpoints

- `GET http://localhost:3500/v1/health`
- `GET http://localhost:3500/v1/rate/current`
- `GET http://localhost:3500/v1/banks`

### 3. Create API Key

**POST** `http://localhost:3500/v1/admin/api-keys`

Headers:
```
Authorization: Bearer <ADMIN_SECRET>
Content-Type: application/json
```

Body:
```json
{
  "merchantId": "test-merchant",
  "name": "Test Key",
  "tier": "standard"
}
```

**Save the `publicKey` and `secretKey`!**

### 4. Set Up Postman Environment

Variables:
- `baseUrl`: `http://localhost:3500/v1`
- `apiKey`: `<your_public_key>`
- `secretKey`: `<your_secret_key>`

### 5. Add Pre-request Script

Add this to your Postman **Collection** (not individual requests):

```javascript
// Modern Postman approach - use require instead of deprecated global CryptoJS
const CryptoJS = require('crypto-js');

const secretKey = pm.environment.get('secretKey');
const apiKey = pm.environment.get('apiKey');

if (!secretKey || !apiKey) {
    console.log('Missing apiKey or secretKey in environment');
    return;
}

const timestamp = Date.now().toString();
const method = pm.request.method;
const path = pm.request.url.getPath();

// Get raw body and normalize to minified JSON (must match server's JSON.stringify)
let body = pm.request.body ? pm.request.body.raw : '{}';
try {
    body = JSON.stringify(JSON.parse(body || '{}'));
} catch (e) {
    body = '{}';
}

// Step 1: Hash the body
const bodyHash = CryptoJS.SHA256(body).toString();

// Step 2: Build payload
const payload = `${timestamp}|${method}|${path}|${bodyHash}`;

// Step 3: Derive HMAC key from secret (SHA256 of secretKey)
const hmacKey = CryptoJS.SHA256(secretKey).toString();

// Step 4: Generate signature using derived key
const signature = CryptoJS.HmacSHA256(payload, hmacKey).toString();

// Set headers
pm.request.headers.upsert({ key: 'X-API-Key', value: apiKey });
pm.request.headers.upsert({ key: 'X-Timestamp', value: timestamp });
pm.request.headers.upsert({ key: 'X-Signature', value: signature });
pm.request.headers.upsert({ key: 'Content-Type', value: 'application/json' });

// Debug logging (check Postman Console)
console.log('=== HMAC Auth Debug ===');
console.log('Path:', path);
console.log('Body:', body);
console.log('Body Hash:', bodyHash);
console.log('Payload:', payload);
console.log('Signature:', signature);
```

**Key points:**
- Uses `require('crypto-js')` instead of deprecated global `CryptoJS`
- Body is parsed and re-stringified to ensure consistent minified JSON
- HMAC key is `SHA256(secretKey)`, not the raw secret

### 6. Test Payments

**Create Transfer:**
```
POST {{baseUrl}}/payments
{
  "type": "transfer",
  "fiatAmount": 10000,
  "fiatCurrency": "NGN",
  "crypto": "USDT",
  "network": "trc20",
  "payer": { "chatId": "123" },
  "receiver": {
    "bankCode": "044",
    "accountNumber": "0123456789",
    "accountName": "John Doe"
  }
}
```

**Get Payment:**
```
GET {{baseUrl}}/payments/2S-XXXXXX
```

---

## Project Structure

```
src/
├── index.ts                    # Express app entry
├── config/                     # Environment config
├── routes/
│   ├── index.ts               # Route aggregator
│   ├── payment.routes.ts      # Unified /payments routes
│   ├── transfer.routes.ts     # Legacy (deprecated)
│   ├── gift.routes.ts         # Legacy (deprecated)
│   ├── request.routes.ts      # Legacy (deprecated)
│   ├── rate.routes.ts
│   ├── bank.routes.ts
│   └── crypto.routes.ts
├── services/payment-engine/
│   ├── payment-engine.ts       # Main facade
│   ├── session/                # Session management
│   ├── hd-wallet/              # HD derivation
│   ├── sweeper/                # Fund sweeping
│   ├── watcher/                # Deposit monitoring
│   ├── settlement/             # Fiat payout
│   ├── participant/            # Payer/Receiver
│   ├── sync/                   # Legacy sync
│   ├── rate/
│   ├── charges/
│   └── types.ts
├── security/
│   ├── middleware/
│   │   ├── authenticate.ts
│   │   ├── adminAuth.ts
│   │   ├── rateLimit.ts
│   │   ├── ipWhitelist.ts
│   │   ├── auditLog.ts
│   │   └── securityHeaders.ts
│   └── services/
├── validation/
│   └── payment.schemas.ts
├── middleware/
│   ├── deprecation.ts
│   └── errorHandler.ts
├── lib/mysql.ts
└── utils/crypto.ts
```

---

## Deposit Watcher

| Chain | API | Confirmations | Polling |
|-------|-----|---------------|---------|
| Bitcoin | Blockstream | 2 | 60s |
| Ethereum | Etherscan | 12 | 15s |
| BSC | BscScan | 15 | 5s |
| Tron | TronGrid | 19 | 5s |

### Fraud Protection

- Zero-confirmation rejection
- RBF detection (Bitcoin)
- Fake token filtering
- Dust filtering
- Amount validation (2% tolerance)

---

## Settlement

Automatic fiat payout via Mongoro with Telegram fallback.

1. Deposit confirmed → Settlement triggered
2. Mongoro sends bank transfer
3. Success → `settled`
4. Failure → Telegram alert → Manual pay → `/settle {ref}`

---

## Code Style

- TypeScript strict mode
- Zod for validation
- Parameterized SQL queries
- Error classes extend `PaymentEngineError` or `SecurityError`

## Testing

```bash
pnpm test           # Watch mode
pnpm test:run       # Single run
pnpm coverage       # With coverage
```
