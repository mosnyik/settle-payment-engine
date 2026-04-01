# Payment Engine

A standalone Express API for crypto-to-fiat payment processing. Supports transfers, gifts, payment requests, and merchant payments with HD wallet derivation, automatic fund sweeping, and multi-provider fiat settlement (Mongoro, Paystack, self-settlement).

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Authentication](#authentication)
- [Settlement Modes](#settlement-modes)
- [Payment Flows](#payment-flows)
- [Wallet-as-a-Service (WaaS)](#wallet-as-a-service-waas)
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

Server runs on `http://localhost:3500` (configurable via `PORT`).

---

## Configuration

### Environment Variables (.env)

```env
# =============================================================================
# SERVER
# =============================================================================
PORT=3500
NODE_ENV=development

# Comma-separated allowed CORS origins (frontend URLs)
# Defaults to http://localhost:3000 if not set
CORS_ORIGIN=http://localhost:3000,https://your-admin.vercel.app

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
# Generate with: openssl rand -hex 32
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
ETHEREUM_RPC_URL=https://eth.llamarpc.com
BSC_RPC_URL=https://bsc-dataseed.binance.org

# Minimum amounts to sweep (saves gas on small deposits)
SWEEP_MIN_BTC=0.0001
SWEEP_MIN_ETH=0.001
SWEEP_MIN_BNB=0.01
SWEEP_MIN_TRX=10
SWEEP_MIN_USDT=1
SWEEP_MIN_USDC=1

# =============================================================================
# DEPOSIT WATCHER
# =============================================================================
WATCHER_ENABLED=true
ETHERSCAN_API_KEY=your_key
BSCSCAN_API_KEY=your_key
TRONGRID_API_KEY=your_key

# Polling intervals (ms)
WATCHER_BITCOIN_POLL_MS=60000
WATCHER_ETHEREUM_POLL_MS=15000
WATCHER_BSC_POLL_MS=5000
WATCHER_TRON_POLL_MS=5000

# =============================================================================
# SETTLEMENT (Fiat Payout)
# =============================================================================
SETTLEMENT_ENABLED=true

# --- Mongoro ---
MONGORO_API_URL=https://api-biz-dev.mongoro.com/api/v1/openapi
MONGORO_TOKEN=your_token
MONGORO_TRANSFERPIN=your_pin
MONGORO_CALLBACK_URL=https://yourapp.com/v1/webhooks/mongoro
# Comma-separated IPs/CIDRs allowed to POST /v1/webhooks/mongoro
# Leave empty to skip IP check during initial setup
MONGORO_WEBHOOK_IPS=

# --- Paystack ---
# Get from: https://dashboard.paystack.com/#/settings/developers
PAYSTACK_SECRET_KEY=sk_live_xxxx
PAYSTACK_WEBHOOK_SECRET=your_paystack_webhook_secret
# Minimum NGN balance to trigger low-balance alert (default: ₦100,000)
PAYSTACK_LOW_BALANCE_THRESHOLD=100000

# --- Telegram Alerts (settlement failure fallback) ---
TELEGRAM_ALERTS_ENABLED=true
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# =============================================================================
# SECURITY
# =============================================================================
RATE_LIMIT_ENABLED=true
IP_WHITELIST_ENABLED=true
AUDIT_LOG_ENABLED=true
# Max age for request timestamps (ms) — prevents replay attacks
HMAC_TIMESTAMP_TOLERANCE_MS=300000
```

---

## API Reference

**Base URL:** `http://localhost:3500/v1`

### Public Endpoints (No Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/rate` | Current NGN exchange rate |
| GET | `/v1/rate/merchant` | Merchant rate |
| GET | `/v1/rate/profit` | Profit rate |
| GET | `/v1/rate/all` | All rates (current, merchant, profit) |
| GET | `/v1/banks/list?name=` | Search banks by name — returns bank name + CBN code |
| POST | `/v1/banks/resolve` | Resolve bank account via NUBAN (takes `bank_code` + `account_number`) |
| GET | `/v1/crypto/price?ticker=` | Crypto price by ticker |
| POST | `/v1/auth/login` | Validate API key credentials |
| POST | `/v1/payments/verify-receiver` | Verify a bank account before creating a payment — returns resolved account details |

### Payment Endpoints (HMAC Auth Required)

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| POST | `/v1/payments` | `payment:create` | Create payment (transfer, gift, request, merchant) |
| GET | `/v1/payments/:reference` | Public | Get payment status |
| POST | `/v1/payments/gifts/:reference/claim/confirm` | Public | Claim a gift — provide receiver bank details, triggers settlement |
| POST | `/v1/payments/requests/:reference/fulfill` | Public | Fulfill a request (provide payer + crypto) |
| POST | `/v1/payments/:reference/settle` | `payment:create` | Confirm self-settlement (requires `settlementToken`) |

### Me Endpoints (HMAC Auth — own key only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/me` | Get authenticated API key details |
| GET | `/v1/me/payments` | List own payments (filterable: `status`, `type`, `from`, `to`, `search`) |
| GET | `/v1/me/payments/stats` | Count of payments per status |
| GET | `/v1/me/payments/:reference` | Get single payment with settlement attempts |
| GET | `/v1/me/audit-logs` | Get own audit logs (filterable: `from`, `to`, `action`) |

### Wallet-as-a-Service Endpoints (HMAC Auth Required)

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| POST | `/v1/wallets` | `wallet:create` | Provision new HD wallet address for deposit monitoring |
| GET | `/v1/wallets` | `wallet:read` | List wallets (filterable: `status`, `limit`, `offset`) |
| GET | `/v1/wallets/:id` | `wallet:read` | Get wallet details with deposit/sweep status |

### Admin Endpoints (Bearer Token Auth)

**Header:** `Authorization: Bearer <ADMIN_SECRET>`

#### API Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/admin/api-keys` | Create API key |
| GET | `/v1/admin/api-keys` | List all API keys (filter: `merchantId`) |
| GET | `/v1/admin/api-keys/:keyId` | Get API key details |
| PATCH | `/v1/admin/api-keys/:keyId` | Update API key (name, permissions, tier, whitelist, settlementMode) |
| DELETE | `/v1/admin/api-keys/:keyId` | Revoke API key |
| GET | `/v1/admin/api-keys/:keyId/wallets` | View funding & parent wallet addresses |
| PUT | `/v1/admin/api-keys/:keyId/wallets` | Set parent wallet addresses (sweep destinations) |

#### Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/admin/payments` | List all payments (filterable) |
| GET | `/v1/admin/payments/:reference` | Get payment details with settlement attempts |
| POST | `/v1/admin/sessions/:reference/settle` | Manually mark payment as settled |

#### Audit Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/admin/audit-logs` | Get all audit logs (filter: `apiKeyId`, `merchantId`, `action`, `from`, `to`, `success`) |

### Webhook Endpoints (Public — Provider-Verified)

| Method | Endpoint | Verification | Description |
|--------|----------|-------------|-------------|
| POST | `/v1/webhooks/mongoro` | IP allowlist (`MONGORO_WEBHOOK_IPS`) | Mongoro settlement callbacks |
| POST | `/v1/webhooks/paystack` | HMAC-SHA512 signature (`X-Paystack-Signature`) | Paystack transfer event callbacks |

### Legacy Endpoints (Deprecated)

These still work but return deprecation headers. Migrate to `/v1/payments`.

| Deprecated | Use Instead |
|------------|-------------|
| `POST /v1/transfer/save` | `POST /v1/payments` with `type: "transfer"` |
| `POST /v1/gifts/save` | `POST /v1/payments` with `type: "gift"` |
| `POST /v1/requests/save` | `POST /v1/payments` with `type: "request"` |

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

**Important**: The HMAC key is `SHA256(secretKey)`, not the raw secret key. This allows the server to store only the hash while both sides compute the same HMAC key.

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

// Step 3: Derive HMAC key (SHA256 of secretKey)
const hmacKey = crypto.createHash('sha256').update(secretKey).digest('hex');

// Step 4: Generate signature
const signature = crypto.createHmac('sha256', hmacKey).update(payload).digest('hex');
```

### Admin Authentication

```
Authorization: Bearer <ADMIN_SECRET>
```

### API Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `keyId` | string | Public key (`pk_xxxxx`) |
| `merchantId` | string | Associated merchant |
| `permissions` | string[] | e.g. `['payment:create', 'wallet:read']` |
| `rateLimitTier` | `standard` \| `premium` \| `unlimited` | Rate limit bucket |
| `ipWhitelist` | string[] \| null | CIDR ranges allowed to use this key |
| `settlementMode` | `mongoro` \| `paystack` \| `self` | How fiat is disbursed for this key's payments |
| `parentWalletBitcoin` | string \| null | BTC sweep destination |
| `parentWalletEthereum` | string \| null | ETH/BSC sweep destination |
| `parentWalletTron` | string \| null | TRX sweep destination |

### Rate Limit Tiers

| Tier | Req/Min | Req/Month | Wallets/Month | Max Watches |
|------|---------|-----------|--------------|-------------|
| `standard` | 60 | 50,000 | 1,000 | 100 |
| `premium` | 500 | 1,000,000 | 50,000 | 1,000 |
| `unlimited` | 1,000 | Unlimited | Unlimited | 10,000 |

### Security Features

- **Rate Limiting**: Per-tier limits enforced on HMAC-authenticated endpoints
- **IP Whitelisting**: Per-API-key with CIDR support
- **Audit Logging**: All requests logged with timestamps, IPs, response times
- **Security Headers**: XSS, HSTS, CSP, no-cache

---

## Settlement Modes

Settlement mode is set per API key (`settlementMode` field). It determines how fiat is disbursed after a deposit is confirmed.

### 1. Mongoro (`settlementMode: "mongoro"`)

Default mode. The engine calls Mongoro's bank transfer API automatically.

- Transfer initiated → session status: `settling`
- Mongoro webhook (`POST /v1/webhooks/mongoro`) confirms result
- On success → `settled`; on failure/reversal → Telegram alert → stays in `settling` for manual resolution
- Webhook is IP-allowlisted via `MONGORO_WEBHOOK_IPS`

### 2. Paystack (`settlementMode: "paystack"`)

The engine initiates a Paystack bank transfer automatically.

- Pre-transfer balance check: if Paystack balance < payment amount, alert sent and session stays in `settling`
- Transfer initiated → session status: `settling`
- Paystack webhook (`POST /v1/webhooks/paystack`) confirms result via HMAC-SHA512 signature
- On `transfer.success` → `settled`
- On `transfer.failed`/`transfer.reversed` due to insufficient funds → Telegram alert, stays in `settling`
- After each successful transfer, balance is checked against `PAYSTACK_LOW_BALANCE_THRESHOLD`
- Paystack recipient codes are cached on the `receivers` table to avoid a redundant API call on repeat transfers to the same account

### 3. Self (`settlementMode: "self"`)

For integrators (e.g. banks) who handle fiat disbursement themselves.

**Flow:**
1. Deposit confirmed → engine generates a one-time `settlementToken` (64-char hex, 24h expiry)
2. `payment.settling` webhook fired — `settlementToken` included in payload
3. Integrator sends fiat to receiver
4. Integrator calls `POST /v1/payments/:reference/settle` with the token to mark payment settled

```json
POST /v1/payments/2S-XXXXXX/settle
{
  "settlementToken": "<token_from_webhook>",
  "settlementReference": "your-internal-ref"  // optional
}
```

**Security guarantees:**
- Token compared with `crypto.timingSafeEqual` (constant-time, prevents timing attacks)
- Token is one-time: nulled after first successful use
- Token expires after 24 hours
- Requires valid HMAC auth on the settle endpoint

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
   ↓         ↓                                ↓
[fulfill] [deposit]                    settlement_reversed
             ↓
          expired / failed
```

| Status | Description |
|--------|-------------|
| `created` | Request created without crypto (awaiting fulfillment) |
| `pending` | Payment has deposit address, awaiting crypto deposit |
| `confirming` | Deposit detected, awaiting blockchain confirmations |
| `confirmed` | Fully confirmed, ready for settlement |
| `settling` | Fiat payout in progress |
| `settled` | Complete |
| `expired` | Timed out without deposit |
| `failed` | Unrecoverable error |
| `settlement_reversed` | Fiat payout reversed by provider |

### 1. Transfer Flow

**Step 1 — Search for the bank**

```
GET /v1/banks/list?name=GTBank
```
```json
{ "message": ["1. Guaranty Trust Bank 058"] }
```

**Step 2 — Verify the receiver account**

```
POST /v1/payments/verify-receiver
{ "bankCode": "058", "accountNumber": "0123456789" }
```
```json
{
  "success": true,
  "receiver": {
    "accountName": "John Doe",
    "accountNumber": "0123456789",
    "bankName": "Guaranty Trust Bank",
    "bankCode": "058"
  }
}
```
Show the user: **"Sending to John Doe — Guaranty Trust Bank. Confirm?"**

**Step 3 — Create the transfer**

Fiat-first (send exactly ₦10,000):
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
    "bankCode": "058",
    "accountNumber": "0123456789"
  }
}
```

Crypto-first (send all of 50 USDT):
```json
POST /v1/payments
{
  "type": "transfer",
  "cryptoAmount": 50,
  "fiatCurrency": "NGN",
  "crypto": "USDT",
  "network": "trc20",
  "payer": { "chatId": "123456789" },
  "receiver": {
    "bankCode": "058",
    "accountNumber": "0123456789"
  }
}
```

> `accountName` and `bankName` are never sent by the client — they are resolved server-side via NUBAN every time.

Response:
```json
{
  "success": true,
  "payment": {
    "reference": "2S-XXXXXX",
    "status": "pending",
    "depositAddress": "TXxxxxxxxxxxxxxxxxxxxxxx",
    "cryptoAmount": 50.0123,
    "crypto": "USDT",
    "network": "trc20",
    "fiatAmount": 24750,
    "fiatCurrency": "NGN",
    "rate": 1650,
    "chargeAmount": 500,
    "expiresAt": "2026-04-01T13:30:00.000Z"
  }
}
```

**Step 4 — Payer sends crypto**

Show the payer: *Send **50.0123 USDT (TRC20)** to `TXxxxxxxxxxxxxxxxxxxxxxx`. Expires in 30 minutes.*

**Step 5 — Automatic from here**

| Event | Status | Webhook |
|---|---|---|
| Deposit detected | `confirming` | `payment.confirming` |
| Confirmations complete | `confirmed` | `payment.confirmed` |
| Fiat payout initiated | `settling` | `payment.settling` |
| Fiat payout confirmed | `settled` | `payment.settled` |

Poll anytime: `GET /v1/payments/2S-XXXXXX`

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

1. No receiver at creation — deposit address assigned, status: `pending`
2. Sender pays crypto → deposit confirms
3. Sender shares `reference` with recipient
4. Recipient claims:

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

5. Settlement sends fiat → `settled`
   - If session was already `confirmed` before claim, settlement fires immediately
   - If still `pending`/`confirming`, settlement fires after confirmation

### 3. Request Flow

The receiver specifies the fiat amount. The payer chooses which crypto to pay when fulfilling. Rate locks at fulfillment time — not at creation.

**Step 1: Create Request**

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

Response: status `created`, no deposit address yet.

**Step 2: Share `reference` with payer**

**Step 3: Payer fulfills**

```json
POST /v1/payments/requests/2S-XXXXXX/fulfill
{
  "payer": { "chatId": "payer456" },
  "crypto": "USDT",
  "network": "trc20"
}
```

Response: rate locked, `depositAddress` and `cryptoAmount` assigned, status → `pending`.

**Step 4–5:** Payer sends crypto → watcher confirms → settlement sends fiat

> **Shortcut:** Pass `crypto`/`network` at creation to lock rate immediately and skip fulfillment (starts at `pending` directly).

### 4. Merchant Flow

```json
POST /v1/payments
{
  "type": "merchant",
  "fiatAmount": 5000,
  "fiatCurrency": "NGN",
  "crypto": "USDT",
  "network": "trc20",
  "merchantId": "store-xyz",
  "callbackUrl": "https://yourstore.com/callback"
}
```

Rate locked, deposit address assigned, status: `pending`. Show hosted checkout at `pay.2settle.io/p/:reference`. On success, redirect to `callbackUrl?reference=...&status=settled`.

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

## Wallet-as-a-Service (WaaS)

Provision unique HD-derived deposit addresses for external platforms to monitor on-chain deposits independently.

### Provision a Wallet

```json
POST /v1/wallets
{
  "network": "trc20",
  "externalId": "user-123",
  "webhookUrl": "https://yourapp.com/webhooks/deposit"
}
```

Returns a unique `depositAddress`. When a deposit is detected, the engine fires a `deposit.confirmed` webhook to `webhookUrl`.

### List Wallets

```
GET /v1/wallets?status=active&limit=50&offset=0
```

### Get Wallet

```
GET /v1/wallets/:id
```

### Tier Quotas

| Tier | Wallets/Month | Max Active Watches |
|------|--------------|--------------------|
| `standard` | 1,000 | 100 |
| `premium` | 50,000 | 1,000 |
| `unlimited` | Unlimited | 10,000 |

---

## HD Wallet Setup

HD wallet provides unlimited unique deposit addresses derived from a single seed phrase.

### Generate Encrypted Seed

```bash
node generate-hd-keys.js
```

Enter your 12 or 24-word mnemonic (ALL ON ONE LINE). It outputs:

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
| Ethereum | `m/44'/60'/0'/0/{index}` | ethereum, bsc, erc20, bep20 |
| Tron | `m/44'/195'/0'/0/{index}` | tron, trc20 |

### Disable HD Wallet

```env
HD_WALLET_ENABLED=false
```

Falls back to legacy wallet pool.

---

## Database Setup

### Run All Migrations (in order)

```sql
-- Core payment tables
SOURCE src/services/payment-engine/migrations/001_create_payment_tables.sql;

-- Settlement token columns (self-settlement hardening)
SOURCE src/services/payment-engine/migrations/002_add_settlement_token.sql;

-- Paystack recipient code cache
SOURCE src/services/payment-engine/migrations/003_add_paystack_recipient_code.sql;

-- HD wallet tables
SOURCE src/services/payment-engine/hd-wallet/migrations/001_create_hd_wallet_tables.sql;

-- Watcher tables
SOURCE src/services/payment-engine/watcher/migrations/001_create_watcher_tables.sql;

-- Settlement tables
SOURCE src/services/payment-engine/settlement/migrations/001_create_settlement_tables.sql;

-- Security tables
SOURCE src/security/migrations/001_create_security_tables.sql;
```

### Core Tables

| Table | Description |
|-------|-------------|
| `payment_sessions` | Main payment records — status, amounts, deposit address, settlement info |
| `payers` | Payer identity (chatId, phone, wallet address) |
| `receivers` | Receiver bank details + `paystack_recipient_code` cache |
| `wallets` | Legacy wallet pool |
| `rates` | Exchange rate cache |

### Settlement Tables

| Table | Description |
|-------|-------------|
| `settlement_attempts` | Per-attempt log: provider, status, reference, error |

### HD Wallet Tables

| Table | Description |
|-------|-------------|
| `hd_wallet_config` | Current derivation index per chain |
| `derived_addresses` | Audit trail of all derived addresses |
| `sweep_transactions` | Sweep records |

### Security Tables

| Table | Description |
|-------|-------------|
| `api_keys` | API credentials, permissions, settlement mode, wallet config |
| `audit_logs` | Full request audit trail |

---

## Testing with Postman

### 1. Start Server

```bash
pnpm dev
```

### 2. Test Public Endpoints

- `GET http://localhost:3500/v1/rate`
- `GET http://localhost:3500/v1/banks/list?name=access`
- `POST http://localhost:3500/v1/banks/resolve` → `{ "accountNumber": "...", "bankCode": "..." }`

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
  "tier": "standard",
  "settlementMode": "self"
}
```

**Save the `publicKey` and `secretKey`!**

### 4. Set Up Postman Environment

Variables:
- `baseUrl`: `http://localhost:3500/v1`
- `apiKey`: `<your_public_key>`
- `secretKey`: `<your_secret_key>`

### 5. Add Pre-request Script (Collection level)

```javascript
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

let body = pm.request.body ? pm.request.body.raw : '{}';
try {
    body = JSON.stringify(JSON.parse(body || '{}'));
} catch (e) {
    body = '{}';
}

const bodyHash = CryptoJS.SHA256(body).toString();
const payload = `${timestamp}|${method}|${path}|${bodyHash}`;
const hmacKey = CryptoJS.SHA256(secretKey).toString();
const signature = CryptoJS.HmacSHA256(payload, hmacKey).toString();

pm.request.headers.upsert({ key: 'X-API-Key', value: apiKey });
pm.request.headers.upsert({ key: 'X-Timestamp', value: timestamp });
pm.request.headers.upsert({ key: 'X-Signature', value: signature });
pm.request.headers.upsert({ key: 'Content-Type', value: 'application/json' });
```

**Key points:**
- Body is parsed and re-stringified to ensure minified JSON (must match server)
- HMAC key is `SHA256(secretKey)`, not the raw secret

### 6. Test Payments

**Step 1 — Search bank (public, no auth):**
```
GET {{baseUrl}}/banks/list?name=GTBank
```

**Step 2 — Verify receiver (public, no auth):**
```json
POST {{baseUrl}}/payments/verify-receiver
{
  "bankCode": "058",
  "accountNumber": "0123456789"
}
```

**Step 3 — Create Transfer (fiat-first):**
```json
POST {{baseUrl}}/payments
{
  "type": "transfer",
  "fiatAmount": 10000,
  "fiatCurrency": "NGN",
  "crypto": "USDT",
  "network": "trc20",
  "payer": { "chatId": "123" },
  "receiver": {
    "bankCode": "058",
    "accountNumber": "0123456789"
  }
}
```

**Step 3 — Create Transfer (crypto-first):**
```json
POST {{baseUrl}}/payments
{
  "type": "transfer",
  "cryptoAmount": 50,
  "fiatCurrency": "NGN",
  "crypto": "USDT",
  "network": "trc20",
  "payer": { "chatId": "123" },
  "receiver": {
    "bankCode": "058",
    "accountNumber": "0123456789"
  }
}
```

**Get Payment:**
```
GET {{baseUrl}}/payments/2S-XXXXXX
```

**Get Own Payments:**
```
GET {{baseUrl}}/me/payments?status=settling&limit=20
```

**Get Payment Stats:**
```
GET {{baseUrl}}/me/payments/stats
```

**Confirm Self-Settlement:**
```json
POST {{baseUrl}}/payments/2S-XXXXXX/settle
{
  "settlementToken": "<token_from_webhook_payload>",
  "settlementReference": "your-internal-txn-id"
}
```

---

## Deposit Watcher

| Chain | API | Confirmations Required | Default Poll |
|-------|-----|----------------------|--------------|
| Bitcoin | Blockstream | 2 | 60s |
| Ethereum | Etherscan | 12 | 15s |
| BSC | BscScan | 15 | 5s |
| Tron | TronGrid | 19 | 5s |

### Fraud Protection

- Zero-confirmation rejection
- RBF detection (Bitcoin)
- Fake token contract filtering
- Dust amount filtering
- Amount validation (2% tolerance by default)

---

## Settlement

After a deposit is confirmed the settlement service fires automatically based on the API key's `settlementMode`. See [Settlement Modes](#settlement-modes) for full details.

**Failure handling:**
- Any settlement failure sends a Telegram alert (if configured)
- Session stays in `settling` — it is NOT marked `failed` — so the admin can resolve manually
- Admin can manually mark settled via `POST /v1/admin/sessions/:reference/settle`

---

## Project Structure

```
src/
├── index.ts                          # Express app entry
├── config/                           # Environment config
├── routes/
│   ├── index.ts                      # Route aggregator
│   ├── payment.routes.ts             # Unified /payments routes
│   ├── me.routes.ts                  # /me/* — own key data
│   ├── wallet.routes.ts              # /wallets — WaaS
│   ├── webhook.routes.ts             # /webhooks/mongoro, /webhooks/paystack
│   ├── auth.routes.ts                # /auth/login
│   ├── rate.routes.ts
│   ├── bank.routes.ts
│   ├── crypto.routes.ts
│   ├── admin/
│   │   ├── index.ts
│   │   ├── apiKey.routes.ts
│   │   ├── payments.routes.ts
│   │   └── auditLog.routes.ts
│   └── [legacy] transfer, gift, request, transaction routes
├── services/payment-engine/
│   ├── payment-engine.ts             # Main facade
│   ├── session/                      # Session management + state machine
│   ├── hd-wallet/                    # HD derivation (BIP32/44/84)
│   ├── sweeper/                      # Fund sweeping to hot wallets
│   ├── watcher/                      # On-chain deposit monitoring
│   ├── settlement/
│   │   ├── settlement.service.ts     # Orchestrator
│   │   ├── mongoro.service.ts        # Mongoro adapter
│   │   ├── paystack.service.ts       # Paystack adapter
│   │   └── telegram.service.ts       # Alert service
│   ├── participant/                  # Payer/Receiver upsert
│   ├── rate/                         # CoinMarketCap + rate locking
│   └── charges/                      # Fee calculation
├── security/
│   ├── middleware/
│   │   ├── authenticate.ts           # HMAC verification
│   │   ├── adminAuth.ts
│   │   ├── rateLimit.ts
│   │   ├── ipWhitelist.ts
│   │   ├── auditLog.ts
│   │   └── securityHeaders.ts
│   └── services/
│       └── apiKey.service.ts
├── validation/
│   └── payment.schemas.ts            # Zod schemas
├── lib/mysql.ts
└── utils/
```
