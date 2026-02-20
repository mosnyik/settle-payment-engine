# 2Settle Payment Engine Design

## Overview

This document describes the architecture for exposing 2Settle's crypto-to-fiat payment engine as a **merchant payment gateway** — enabling businesses to accept crypto payments on their platforms the same way they integrate Paystack or Flutterwave.

### Goals

- Merchants integrate via API/SDK to accept crypto payments
- 2Settle receives crypto into its own wallet pool, settles fiat to merchant's bank
- Support all three transaction types: Transfer, Gift, and Request
- Multi-currency fiat support (NGN first, extensible to GHS, KES, ZAR, etc.)
- Business-level KYC (2Settle KYCs the merchant, merchant KYCs their users)

### Non-Goals (for now)

- End-user KYC by 2Settle
- Non-custodial / user-connects-wallet model (existing chat product handles this separately)
- Crypto-to-crypto payments

---

## Transaction Types

The payment engine supports three distinct transaction types, each with its own flow:

### 1. Transfer (Direct Payment)

**Use Case**: Customer pays merchant directly with crypto, merchant receives fiat.

```
Customer ──[crypto]──▶ 2Settle ──[fiat]──▶ Merchant's Bank
```

**Flow**:
1. Merchant creates payment with customer + bank details
2. Customer sends crypto to assigned wallet
3. 2Settle confirms deposit
4. 2Settle settles fiat to merchant

**Single Phase**: Both payer and receiver known at creation.

### 2. Gift (Send as Gift)

**Use Case**: User sends crypto as a gift. Recipient claims later with their bank details.

```
Sender ──[crypto]──▶ 2Settle ──[gift ID]──▶ Recipient ──[bank details]──▶ 2Settle ──[fiat]──▶ Recipient's Bank
```

**Flow**:
1. **Create Gift**: Sender pays crypto, receives gift ID
2. Sender shares gift ID with recipient (any channel)
3. **Claim Gift**: Recipient provides bank details using gift ID
4. 2Settle settles fiat to recipient

**Two Phases**: Sender known at creation, receiver known at claim.

### 3. Request (Payment Request)

**Use Case**: User requests payment by sharing a link. Payer fulfills with crypto.

```
Requester ──[request ID]──▶ Payer ──[crypto]──▶ 2Settle ──[fiat]──▶ Requester's Bank
```

**Flow**:
1. **Create Request**: Requester specifies fiat amount + bank details, receives request ID
2. Requester shares request ID with payer (invoice, link, QR)
3. **Pay Request**: Payer chooses crypto, pays to assigned wallet
4. 2Settle settles fiat to requester

**Two Phases**: Receiver known at creation, payer known at payment.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Integration Layer                          │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ Hosted       │  │ JS SDK       │  │ REST API           │ │
│  │ Checkout     │  │ (inline.js)  │  │ (server-to-server) │ │
│  │ /pay/{ref}   │  │ iframe modal │  │ POST /v1/payments  │ │
│  │ /gift/{id}   │  │              │  │ POST /v1/gifts     │ │
│  │ /request/{id}│  │              │  │ POST /v1/requests  │ │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬──────────┘ │
│         │                 │                     │            │
└─────────┼─────────────────┼─────────────────────┼────────────┘
          │                 │                     │
          ▼                 ▼                     ▼
┌──────────────────────────────────────────────────────────────┐
│                    Public API Gateway                         │
│                                                              │
│  - API key authentication (pk_live_*, sk_live_*)             │
│  - Rate limiting (per merchant, per endpoint)                │
│  - Request validation                                        │
│  - API versioning (/v1/)                                     │
│  - Webhook dispatch                                          │
└──────────────────────────┬───────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Payment    │  │   Wallet     │  │  Settlement  │
│   Engine     │  │   Pool       │  │  Engine      │
│              │  │              │  │              │
│ - Sessions   │  │ - Assignment │  │ - Fiat payout│
│ - Rate lock  │  │ - Cooldown   │  │ - Multi-curr │
│ - Status     │  │ - Monitoring │  │ - Bank rails │
│ - Expiry     │  │ - Release    │  │ - Batching   │
│ - Gift/Req   │  │              │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
          │                │                │
          ▼                ▼                ▼
┌──────────────────────────────────────────────────────────────┐
│                         MySQL                                │
│                                                              │
│  merchants │ api_keys │ payments │ wallets │ settlements     │
└──────────────────────────────────────────────────────────────┘
```

---

## Wallet Pool Model

2Settle does **not** use HD wallet derivation. Instead, it maintains a **finite pool of pre-funded wallets** in the `wallets` table. Each wallet has addresses for multiple chains (BTC, EVM, TRON) and per-chain availability flags.

### Current Schema

```sql
CREATE TABLE wallets (
  id            INT NOT NULL,
  bitcoin       VARCHAR(80),
  evm           VARCHAR(80),
  tron          VARCHAR(80),
  bitcoin_flag  TINYINT(1),    -- 1 = available, 0 = in use
  ethereum_flag TINYINT(1),
  binance_flag  TINYINT(1),
  tron_flag     TINYINT(1),
  erc20_flag    TINYINT(1),
  bep20_flag    TINYINT(1),
  trc20_flag    TINYINT(1),
  -- Timestamp columns for tracking
  bitcoin_last_assigned   DATETIME,
  ethereum_last_assigned  DATETIME,
  -- ... etc
);
```

### Assignment Flow by Transaction Type

```
TRANSFER / GIFT (Create):
────────────────────────────
1. Transaction initiated → network selected (e.g. "bep20")
2. SELECT * FROM wallets WHERE bep20_flag = 1 LIMIT 1 FOR UPDATE
3. If found:
   - Set bep20_flag = 0
   - Record bep20_last_assigned = NOW()
   - Return wallet address to payment session
4. If none available:
   - Return 503 with estimated wait time

REQUEST (Create):
─────────────────
1. Request created → NO wallet assigned yet
2. Store fiat amount and receiver bank details only
3. Return request ID

REQUEST (Pay):
──────────────
1. Payer calls payRequest() with crypto choice
2. NOW: SELECT * FROM wallets WHERE {network}_flag = 1 LIMIT 1 FOR UPDATE
3. Lock rate, calculate crypto amount
4. Assign wallet, return deposit address
```

**Concurrency safety**: `FOR UPDATE` row lock within a DB transaction prevents two payments from being assigned the same wallet.

### Wallet Release by Transaction Type

| Type | When Released |
|------|---------------|
| Transfer | After deposit confirmed |
| Gift | After deposit confirmed (before pending_claim) |
| Request | After deposit confirmed |
| Expired | When payment window expires |

---

## Merchant Model

### Database Schema

```sql
CREATE TABLE merchants (
  id              VARCHAR(36) PRIMARY KEY,        -- UUID
  business_name   VARCHAR(255) NOT NULL,
  email           VARCHAR(255) NOT NULL UNIQUE,
  phone           VARCHAR(20),
  kyc_status      ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  kyc_submitted_at TIMESTAMP NULL,
  kyc_approved_at  TIMESTAMP NULL,
  webhook_url     VARCHAR(500),
  webhook_secret  VARCHAR(255),                   -- HMAC secret for signing payloads
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE merchant_api_keys (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  merchant_id     VARCHAR(36) NOT NULL,
  public_key      VARCHAR(50) NOT NULL UNIQUE,    -- pk_live_xxxx / pk_test_xxxx
  secret_key      VARCHAR(100) NOT NULL UNIQUE,   -- sk_live_xxxx (hashed)
  environment     ENUM('live', 'test') DEFAULT 'test',
  is_active       TINYINT(1) DEFAULT 1,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

CREATE TABLE merchant_settlement_accounts (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  merchant_id     VARCHAR(36) NOT NULL,
  currency        VARCHAR(3) NOT NULL,            -- NGN, GHS, KES
  bank_code       VARCHAR(10) NOT NULL,
  account_number  VARCHAR(20) NOT NULL,
  account_name    VARCHAR(255) NOT NULL,
  is_default      TINYINT(1) DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id),
  UNIQUE KEY (merchant_id, currency, account_number)
);
```

### API Key Format

Following the Paystack convention:
- **Public key**: `pk_live_` + 32 random chars (used client-side, in JS SDK)
- **Secret key**: `sk_live_` + 40 random chars (used server-side, never exposed)
- **Test keys**: `pk_test_` / `sk_test_` for sandbox environment

---

## Payment Session Lifecycle

### States by Transaction Type

```
TRANSFER:
┌──────────┐    ┌─────────┐    ┌────────────┐    ┌───────────┐    ┌──────────┐    ┌─────────┐
│ CREATED  │───▶│ PENDING │───▶│ CONFIRMING │───▶│ CONFIRMED │───▶│ SETTLING │───▶│ SETTLED │
└──────────┘    └─────────┘    └────────────┘    └───────────┘    └──────────┘    └─────────┘

GIFT:
┌──────────┐    ┌─────────┐    ┌────────────┐    ┌───────────┐    ┌───────────────┐
│ CREATED  │───▶│ PENDING │───▶│ CONFIRMING │───▶│ CONFIRMED │───▶│ PENDING_CLAIM │
└──────────┘    └─────────┘    └────────────┘    └───────────┘    └───────┬───────┘
                                                                          │ claimGift()
                                                                          ▼
                                                                 ┌──────────┐    ┌─────────┐
                                                                 │ SETTLING │───▶│ SETTLED │
                                                                 └──────────┘    └─────────┘

REQUEST:
┌──────────┐    ┌─────────────────┐
│ CREATED  │───▶│ PENDING_PAYMENT │ (waiting for payer)
└──────────┘    └────────┬────────┘
                         │ payRequest()
                         ▼
                ┌─────────┐    ┌────────────┐    ┌───────────┐    ┌──────────┐    ┌─────────┐
                │ PENDING │───▶│ CONFIRMING │───▶│ CONFIRMED │───▶│ SETTLING │───▶│ SETTLED │
                └─────────┘    └────────────┘    └───────────┘    └──────────┘    └─────────┘
```

### Status Definitions

| Status | Description |
|--------|-------------|
| `created` | Session initialized |
| `pending_payment` | **Request only**: Waiting for payer to pay |
| `pending` | Wallet assigned, waiting for crypto deposit |
| `confirming` | Deposit detected, waiting for confirmations |
| `confirmed` | Deposit confirmed on-chain |
| `pending_claim` | **Gift only**: Waiting for recipient to claim |
| `settling` | Fiat payout in progress |
| `settled` | Complete - fiat paid out |
| `expired` | Timeout - no deposit or claim |
| `failed` | Error occurred |

### Schema

```sql
CREATE TABLE payment_sessions (
  id                VARCHAR(36) PRIMARY KEY,
  payment_id        VARCHAR(32) NOT NULL UNIQUE,
  reference         VARCHAR(12) NOT NULL UNIQUE,   -- Human-readable (2S-XXXXXX)

  -- Type determines flow
  type              ENUM('transfer', 'gift', 'request', 'merchant') NOT NULL,
  status            ENUM('created', 'pending_payment', 'pending', 'confirming',
                         'confirmed', 'pending_claim', 'settling', 'settled',
                         'expired', 'failed') DEFAULT 'created',

  -- Amounts
  fiat_amount       DECIMAL(15, 2) NOT NULL,
  fiat_currency     VARCHAR(3) NOT NULL DEFAULT 'NGN',
  crypto_currency   VARCHAR(10) NULL,                -- NULL for requests until paid
  crypto_amount     DECIMAL(18, 8) NULL,             -- Calculated when rate locked
  network           VARCHAR(10) NULL,                -- NULL for requests until paid

  -- Rate (locked when applicable)
  exchange_rate     DECIMAL(15, 4) NULL,             -- NULL for requests until paid
  asset_price       DECIMAL(18, 8) NULL,
  rate_locked_at    TIMESTAMP NULL,
  rate_expires_at   TIMESTAMP NULL,

  -- Wallet assignment
  wallet_address    VARCHAR(100) NULL,               -- NULL for requests until paid
  wallet_id         INT NULL,

  -- Participants
  payer_id          INT NULL,                        -- NULL for requests until paid
  receiver_id       INT NULL,                        -- NULL for gifts until claimed

  -- Gift-specific
  gift_id           VARCHAR(20) NULL,                -- e.g., GIFT-XXXXXX
  gift_message      TEXT NULL,
  gift_sender_name  VARCHAR(100) NULL,
  gift_claim_expires_at TIMESTAMP NULL,              -- 30 days from confirmation
  gift_claimed_at   TIMESTAMP NULL,

  -- Request-specific
  request_id        VARCHAR(20) NULL,                -- e.g., REQ-XXXXXX
  request_description TEXT NULL,
  request_expires_at TIMESTAMP NULL,                 -- 7 days from creation

  -- Deposit tracking
  tx_hash           VARCHAR(100) NULL,               -- On-chain transaction hash
  deposit_amount    DECIMAL(18, 8) NULL,
  deposit_confirmed_at TIMESTAMP NULL,

  -- Settlement
  settlement_reference VARCHAR(100) NULL,
  settled_at        TIMESTAMP NULL,

  -- Merchant (for merchant API)
  merchant_id       VARCHAR(36) NULL,
  callback_url      VARCHAR(500) NULL,
  metadata          JSON NULL,

  -- Timestamps
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at        TIMESTAMP NULL,                  -- Payment window expiry

  FOREIGN KEY (merchant_id) REFERENCES merchants(id),
  FOREIGN KEY (wallet_id) REFERENCES wallets(id)
);

-- Indexes for common queries
CREATE INDEX idx_type_status ON payment_sessions(type, status);
CREATE INDEX idx_gift_id ON payment_sessions(gift_id);
CREATE INDEX idx_request_id ON payment_sessions(request_id);
CREATE INDEX idx_pending_claim ON payment_sessions(status, gift_claim_expires_at);
CREATE INDEX idx_pending_payment ON payment_sessions(status, request_expires_at);
```

---

## Public API Design

### Base URL

```
Live:  https://api.2settle.io/v1
Test:  https://sandbox.2settle.io/v1
```

### Authentication

All API requests include the secret key in the `Authorization` header:

```
Authorization: Bearer sk_live_xxx
```

### Transfer Endpoints

#### Initialize Transfer Payment

```
POST /v1/payments/initialize

Headers:
  Authorization: Bearer sk_live_xxx

Body:
{
  "type": "transfer",
  "amount": 50000,                    // Fiat amount
  "currency": "NGN",
  "crypto": "USDT",                   // Optional, can be chosen on checkout
  "network": "bep20",                 // Optional
  "payer": {
    "email": "customer@example.com",
    "phone": "08012345678"
  },
  "receiver": {
    "bank_code": "058",
    "account_number": "1234567890",
    "account_name": "John Doe"
  },
  "reference": "order_12345",         // Optional, auto-generated if omitted
  "callback_url": "https://merchant.com/callback",
  "metadata": {
    "order_id": "12345"
  }
}

Response 200:
{
  "status": true,
  "message": "Payment initialized",
  "data": {
    "payment_id": "pay_abc123",
    "reference": "2S-ABC123",
    "checkout_url": "https://spend.2settle.io/pay/pay_abc123",
    "deposit_address": "0x1234...",
    "crypto_amount": "31.25",
    "amount": 50000,
    "currency": "NGN",
    "status": "pending",
    "expires_at": "2026-02-18T11:30:00Z"
  }
}
```

### Gift Endpoints

#### Create Gift

```
POST /v1/gifts/create

Body:
{
  "amount": 25000,
  "currency": "NGN",
  "crypto": "USDT",
  "network": "bep20",
  "sender": {
    "name": "Alice",                  // Optional display name
    "phone": "08011111111"
  },
  "message": "Happy Birthday!"        // Optional
}

Response 200:
{
  "status": true,
  "data": {
    "payment_id": "pay_xyz789",
    "gift_id": "GIFT-ABC123",         // Share this with recipient
    "deposit_address": "0x1234...",
    "crypto_amount": "15.62",
    "amount": 25000,
    "currency": "NGN",
    "status": "pending",
    "share_url": "https://spend.2settle.io/gift/GIFT-ABC123",
    "expires_at": "2026-02-18T11:30:00Z"
  }
}
```

#### Claim Gift

```
POST /v1/gifts/claim

Body:
{
  "gift_id": "GIFT-ABC123",
  "receiver": {
    "bank_code": "058",
    "account_number": "0987654321",
    "account_name": "Bob Smith",
    "phone": "08022222222"
  }
}

Response 200:
{
  "status": true,
  "message": "Gift claimed successfully",
  "data": {
    "payment_id": "pay_xyz789",
    "gift_id": "GIFT-ABC123",
    "amount": 25000,
    "currency": "NGN",
    "status": "settling",
    "sender_name": "Alice",
    "message": "Happy Birthday!"
  }
}
```

#### Get Gift Status

```
GET /v1/gifts/:gift_id

Response 200:
{
  "status": true,
  "data": {
    "gift_id": "GIFT-ABC123",
    "amount": 25000,
    "currency": "NGN",
    "status": "pending_claim",        // or "settled", "expired"
    "sender_name": "Alice",
    "message": "Happy Birthday!",
    "created_at": "2026-02-17T10:00:00Z",
    "claim_expires_at": "2026-03-19T10:00:00Z"
  }
}
```

### Request Endpoints

#### Create Payment Request

```
POST /v1/requests/create

Body:
{
  "amount": 100000,                   // Fiat amount requested
  "currency": "NGN",
  "receiver": {
    "phone": "08033333333",
    "bank_code": "058",
    "account_number": "1234567890",
    "account_name": "Charlie Brown"
  },
  "description": "Payment for freelance work"  // Optional
}

Response 200:
{
  "status": true,
  "data": {
    "payment_id": "pay_req456",
    "request_id": "REQ-XYZ789",       // Share with payer
    "amount": 100000,
    "currency": "NGN",
    "status": "pending_payment",
    "pay_url": "https://spend.2settle.io/request/REQ-XYZ789",
    "expires_at": "2026-02-25T10:00:00Z"  // 7 days
  }
}
```

#### Pay Request

```
POST /v1/requests/pay

Body:
{
  "request_id": "REQ-XYZ789",
  "crypto": "BTC",
  "network": "bitcoin",
  "payer": {
    "phone": "08044444444",
    "email": "payer@example.com"      // Optional
  }
}

Response 200:
{
  "status": true,
  "data": {
    "payment_id": "pay_req456",
    "request_id": "REQ-XYZ789",
    "deposit_address": "bc1qxy2...",
    "crypto_amount": "0.00103",       // BTC equivalent of ₦100,000
    "fiat_amount": 100000,
    "currency": "NGN",
    "status": "pending",
    "expires_at": "2026-02-18T11:30:00Z"
  }
}
```

#### Get Request Status

```
GET /v1/requests/:request_id

Response 200:
{
  "status": true,
  "data": {
    "request_id": "REQ-XYZ789",
    "amount": 100000,
    "currency": "NGN",
    "status": "pending",              // or "pending_payment", "settled"
    "description": "Payment for freelance work",
    "crypto": "BTC",
    "crypto_amount": "0.00103",
    "created_at": "2026-02-17T10:00:00Z",
    "expires_at": "2026-02-25T10:00:00Z"
  }
}
```

### Common Endpoints

#### Verify Payment

```
GET /v1/payments/verify/:reference

Response 200:
{
  "status": true,
  "data": {
    "payment_id": "pay_abc123",
    "reference": "2S-ABC123",
    "type": "transfer",
    "amount": 50000,
    "currency": "NGN",
    "crypto_currency": "USDT",
    "crypto_amount": "31.25",
    "status": "confirmed",
    "tx_hash": "0xabc...",
    "confirmed_at": "2026-02-18T10:34:56Z",
    "settled_at": null,
    "metadata": { "order_id": "12345" }
  }
}
```

#### Fetch Rates

```
GET /v1/rates?currency=NGN

Response 200:
{
  "status": true,
  "data": {
    "currency": "NGN",
    "rates": {
      "BTC": { "price": 156000000, "unit": "NGN per BTC" },
      "ETH": { "price": 4400000, "unit": "NGN per ETH" },
      "USDT": { "price": 1600, "unit": "NGN per USDT" },
      "BNB": { "price": 992000, "unit": "NGN per BNB" }
    },
    "timestamp": "2026-02-18T10:00:00Z"
  }
}
```

---

## Hosted Checkout Pages

### Transfer Checkout

```
https://spend.2settle.io/pay/{payment_id}
```

Shows:
- Payment amount (fiat + crypto)
- Crypto selector (if not pre-selected)
- Wallet address + QR code
- Countdown timer
- Status updates

### Gift Claim Page

```
https://spend.2settle.io/gift/{gift_id}
```

Shows:
- Gift amount
- Sender name + message
- Bank details form
- Claim button

### Request Payment Page

```
https://spend.2settle.io/request/{request_id}
```

Shows:
- Requested amount
- Description
- Crypto selector
- After selection: wallet address + QR code
- Countdown timer

---

## Webhook System

### Event Types

| Event | Trigger | Transaction Types |
|-------|---------|-------------------|
| `payment.pending` | Wallet assigned | Transfer, Gift, Request (after pay) |
| `payment.confirming` | Deposit detected | All |
| `payment.confirmed` | Deposit confirmed | All |
| `gift.pending_claim` | Gift ready to claim | Gift |
| `gift.claimed` | Gift claimed | Gift |
| `payment.settled` | Fiat paid out | All |
| `payment.expired` | Timeout | All |
| `payment.failed` | Error | All |

### Payload Format

```json
{
  "event": "payment.confirmed",
  "data": {
    "payment_id": "pay_abc123",
    "reference": "2S-ABC123",
    "type": "transfer",
    "amount": 50000,
    "currency": "NGN",
    "crypto_currency": "USDT",
    "crypto_amount": "31.25",
    "tx_hash": "0xabc...",
    "status": "confirmed",
    "metadata": { "order_id": "12345" }
  }
}
```

### Gift-Specific Events

```json
{
  "event": "gift.claimed",
  "data": {
    "payment_id": "pay_xyz789",
    "gift_id": "GIFT-ABC123",
    "amount": 25000,
    "currency": "NGN",
    "status": "settling",
    "sender_name": "Alice",
    "claimed_by": {
      "account_name": "Bob Smith"
    }
  }
}
```

### Security

Webhooks are signed with HMAC-SHA512:

```
X-2Settle-Signature: sha512=<HMAC of raw body>
```

---

## Relationship to Existing Chat Product

The chat product and merchant gateway share the same underlying payment engine:

```
┌───────────────────┐     ┌───────────────────┐
│  Chat Frontend    │     │  Merchant API      │
│  (spend.2settle)  │     │  (api.2settle)     │
│                   │     │                    │
│  TRANSFER:        │     │  TRANSFER:         │
│  - Chatbot flow   │     │  - API call        │
│                   │     │                    │
│  GIFT:            │     │  GIFT:             │
│  - Create via chat│     │  - Create via API  │
│  - Claim via chat │     │  - Claim via API   │
│                   │     │                    │
│  REQUEST:         │     │  REQUEST:          │
│  - Create via chat│     │  - Create via API  │
│  - Pay via chat   │     │  - Pay via hosted  │
└────────┬──────────┘     └────────┬───────────┘
         │                         │
         ▼                         ▼
┌──────────────────────────────────────────────┐
│           Shared Payment Engine               │
│                                              │
│  src/services/payment-engine/                │
│  - createPayment() / createGift() /          │
│    createRequest()                           │
│  - claimGift() / payRequest()                │
│  - rate service                              │
│  - wallet pool                               │
│  - settlement rails                          │
└──────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────┐
│                  MySQL                        │
│  payment_sessions │ wallets │ merchants       │
│  payers │ receivers │ settlements             │
└──────────────────────────────────────────────┘
```

---

## Expiry and Timeout Rules

| Transaction | Phase | Timeout | Action |
|-------------|-------|---------|--------|
| Transfer | Pending deposit | 30 min | Expire, release wallet |
| Gift | Pending deposit | 30 min | Expire, release wallet |
| Gift | Pending claim | 30 days | Expire (crypto already received) |
| Request | Pending payment | 7 days | Expire (no wallet assigned) |
| Request | Pending deposit | 30 min | Expire, release wallet |

---

## Security Considerations

1. **API key storage** — Secret keys stored as bcrypt/argon2 hashes. Never returned after creation.
2. **Wallet private keys** — Already in DB. Must be encrypted at rest. Consider moving to a secrets manager (AWS KMS, Vault) as you scale.
3. **Webhook secrets** — Unique per merchant. HMAC-SHA512 signatures on all payloads.
4. **Rate limiting** — Per-merchant, per-endpoint. Prevent abuse and wallet pool exhaustion.
5. **Wallet pool exhaustion** — If all wallets are assigned, new payments queue or return 503. Monitor pool utilization.
6. **Amount validation** — On-chain deposit must match expected crypto amount (with configurable tolerance).
7. **Gift/Request ID security** — IDs should be unguessable (use crypto-random generation).
8. **Claim validation** — Verify gift hasn't been claimed, isn't expired.

---

## Key Metrics to Track

- Payment conversion rate by type (created → settled)
- Gift claim rate (pending_claim → settled)
- Request fulfillment rate (pending_payment → settled)
- Average time to confirmation (per chain)
- Average time to claim (for gifts)
- Wallet pool utilization (% in use at any time)
- Webhook delivery success rate
- API response times (p50, p95, p99)
