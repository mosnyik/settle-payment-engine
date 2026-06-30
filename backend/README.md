# 2Settle Payment Engine

A standalone crypto-to-fiat payment engine that enables banks, fintechs, and merchants to accept cryptocurrency payments and settle in local fiat currency.

## Transaction Types

The payment engine supports three core transaction types:

| Type | Description | Phases |
|------|-------------|--------|
| **Transfer** | Direct crypto-to-bank payment | Single phase: pay crypto, receive fiat |
| **Gift** | Send crypto as a claimable gift | Two phases: create gift, claim gift |
| **Request** | Request payment from someone | Two phases: create request, pay request |
| **Merchant** | Merchant checkout session | Single phase: pay crypto, merchant notified |
| **Bank Confirmation** | Bank-managed crypto confirmation rail | Single phase: deposit confirmed, bank settles fiat |

## Quick Start

### Transfer (Direct Payment)

A transfer delivers fiat to a receiver's bank account in exchange for crypto. The flow has three steps: find the bank, verify the account, then create the payment.

**Base URL:** `https://api.2settle.io/v1`

#### Step 1 — Find the bank code

```http
GET /v1/banks/list?name=mon
```

```json
{
  "message": [
    "1. MONEYTRUST MFB 090129",
    "2. MONIEPOINT MICROFINANCE BANK 090405",
    "3. Monarch Microfinance Bank 090462",
    "4. Money Master PSB 120005"
  ]
}
```

Pick the right bank from the list and note the code at the end (e.g. `090405` for Moniepoint).

#### Step 2 — Verify the receiver's account

Resolve the account number and show the name to the user for confirmation before creating the payment. No session is created yet.

```http
POST /v1/payments/verify-receiver
Content-Type: application/json

{
  "bankCode": "090405",
  "accountNumber": "8012345678"
}
```

```json
{
  "success": true,
  "receiver": {
    "accountName": "JOHN DOE",
    "accountNumber": "8012345678",
    "bankName": "MONIEPOINT MICROFINANCE BANK",
    "bankCode": "090405"
  }
}
```

Show `accountName` and `bankName` to the user for confirmation before proceeding. Do **not** send `accountName` back to the server — it is always resolved server-side.

#### Step 3 — Create the payment

Pass `bankCode` and `accountNumber` only. The server re-resolves account details via NUBAN.

`chargeFrom` is **required**. It controls who bears the platform fee:
- `"fiat"` — fee deducted from the fiat payout; receiver gets `fiatAmount - fee`
- `"crypto"` — fee added to the crypto amount; receiver gets the full `fiatAmount`

**Fiat-first** — charge from fiat (receiver gets ₦50,000 minus fee):

```http
POST /v1/payments
X-API-Key: pk_xxxxx
X-Timestamp: <unix ms>
X-Signature: <hmac>
Content-Type: application/json

{
  "type": "transfer",
  "fiatAmount": 50000,
  "fiatCurrency": "NGN",
  "crypto": "USDT",
  "network": "trc20",
  "chargeFrom": "fiat",
  "payer": {
    "chatId": "7389201648"
  },
  "receiver": {
    "bankCode": "090405",
    "accountNumber": "8012345678"
  }
}
```

```json
{
  "success": true,
  "payment": {
    "reference": "2S-K4M9PX",
    "type": "transfer",
    "status": "pending",
    "depositAddress": "TQn8RE7rHWkDpAFGLamDj4R9bNHx2V3Kop",
    "cryptoAmount": 30.5718,
    "crypto": "USDT",
    "network": "trc20",
    "fiatAmount": 49500,
    "fiatCurrency": "NGN",
    "transactionUsd": 30.55,
    "rate": 1620.5,
    "charge": {
      "fiat": 500,
      "crypto": 0.3085,
      "usd": 0.31
    },
    "expiresAt": "2026-04-01T13:30:00.000Z"
  }
}
```

> `fiatAmount` in the response is the **net** amount the receiver will receive. `transactionUsd` is that net amount in USD, used for volume analytics.

**Fiat-first** — charge from crypto (receiver gets full ₦50,000, payer sends more crypto):

```http
POST /v1/payments
X-API-Key: pk_xxxxx
X-Timestamp: <unix ms>
X-Signature: <hmac>
Content-Type: application/json

{
  "type": "transfer",
  "fiatAmount": 50000,
  "fiatCurrency": "NGN",
  "crypto": "USDT",
  "network": "trc20",
  "chargeFrom": "crypto",
  "payer": {
    "chatId": "7389201648"
  },
  "receiver": {
    "bankCode": "090405",
    "accountNumber": "8012345678"
  }
}
```

**Crypto-first** (payer sends a fixed crypto amount, charge always from crypto):

```http
POST /v1/payments
X-API-Key: pk_xxxxx
X-Timestamp: <unix ms>
X-Signature: <hmac>
Content-Type: application/json

{
  "type": "transfer",
  "cryptoAmount": 31.2658,
  "fiatCurrency": "NGN",
  "crypto": "USDT",
  "network": "trc20",
  "chargeFrom": "crypto",
  "payer": {
    "chatId": "7389201648"
  },
  "receiver": {
    "bankCode": "090405",
    "accountNumber": "8012345678"
  }
}
```

#### Step 4 — Payer sends crypto

Show `depositAddress` and `cryptoAmount` to the payer:

> Send **31.2658 USDT (TRC20)** to `TQn8RE7rHWkDpAFGLamDj4R9bNHx2V3Kop`. Expires in 30 minutes.

The deposit watcher detects the transaction automatically — no action needed from your side.

#### Step 5 — Monitor status

```http
GET /v1/payments/2S-K4M9PX
```

```json
{
  "success": true,
  "payment": {
    "reference": "2S-K4M9PX",
    "status": "settled",
    "crypto": "USDT",
    "network": "trc20",
    "cryptoAmount": 31.2658,
    "fiatAmount": 50000,
    "fiatCurrency": "NGN",
    "confirmedAt": "2026-04-01T13:12:44.000Z",
    "settledAt": "2026-04-01T13:13:02.000Z"
  }
}
```

| Status | Meaning |
|--------|---------|
| `pending` | Deposit address assigned, waiting for crypto |
| `confirming` | Deposit seen on-chain, accumulating confirmations |
| `confirmed` | Fully confirmed, fiat payout starting |
| `settling` | Fiat transfer in progress |
| `settled` | Complete — receiver has been paid |
| `expired` | No deposit received before the deadline |

### Gift (Two-Phase)

A gift lets the sender pay crypto upfront without knowing the recipient's bank details. The recipient claims later by providing their account.

#### Phase 1 — Sender creates the gift

No receiver needed at creation — it is set at claim time. The fee is always charged from crypto (payer bears it). The sender gets a deposit address and shares the `reference` with the recipient.

**Fiat-first** (recipient receives a specific NGN amount):

```http
POST /v1/payments
X-API-Key: pk_xxxxx
X-Timestamp: <unix ms>
X-Signature: <hmac>
Content-Type: application/json

{
  "type": "gift",
  "fiatAmount": 20000,
  "fiatCurrency": "NGN",
  "crypto": "USDT",
  "network": "trc20",
  "payer": {
    "chatId": "7389201648"
  }
}
```

**Crypto-first** (sender sends a fixed crypto amount):

```http
POST /v1/payments
...

{
  "type": "gift",
  "cryptoAmount": 12.5,
  "fiatCurrency": "NGN",
  "crypto": "USDT",
  "network": "trc20",
  "payer": {
    "chatId": "7389201648"
  }
}
```

```json
{
  "success": true,
  "payment": {
    "reference": "2S-GFT4XW",
    "type": "gift",
    "status": "pending",
    "depositAddress": "TQn8RE7rHWkDpAFGLamDj4R9bNHx2V3Kop",
    "cryptoAmount": 12.5,
    "crypto": "USDT",
    "network": "trc20",
    "fiatAmount": 20000,
    "fiatCurrency": "NGN",
    "transactionUsd": 12.34,
    "rate": 1620.5,
    "charge": {
      "fiat": 0,
      "crypto": 0.3086,
      "usd": 0.19
    },
    "expiresAt": "2026-04-01T14:00:00.000Z"
  }
}
```

Sender pays `cryptoAmount` to `depositAddress`, then shares `reference` (`2S-GFT4XW`) with the recipient.

---

#### Phase 2 — Recipient claims the gift

The deposit must be confirmed on-chain before claiming. The claim flow mirrors the transfer verify-then-confirm pattern.

**Step 1 — Find the recipient's bank code**

```http
GET /v1/banks/list?name=mon
```

```json
{
  "message": [
    "1. MONEYTRUST MFB 090129",
    "2. MONIEPOINT MICROFINANCE BANK 090405",
    "3. Monarch Microfinance Bank 090462",
    "4. Money Master PSB 120005"
  ]
}
```

**Step 2 — Verify the recipient's account**

```http
POST /v1/payments/verify-receiver
Content-Type: application/json

{
  "bankCode": "090405",
  "accountNumber": "8012345678"
}
```

```json
{
  "success": true,
  "receiver": {
    "accountName": "JOHN DOE",
    "accountNumber": "8012345678",
    "bankName": "MONIEPOINT MICROFINANCE BANK",
    "bankCode": "090405"
  }
}
```

Show `accountName` and `bankName` to the recipient for confirmation before proceeding.

**Step 3 — Confirm the claim**

```http
POST /v1/payments/gifts/2S-GFT4XW/claim/confirm
Content-Type: application/json

{
  "bankCode": "090405",
  "accountNumber": "8012345678"
}
```

```json
{
  "success": true,
  "message": "Gift claimed successfully. Payout is being processed.",
  "payment": {
    "id": 31,
    "reference": "2S-GFT4XW",
    "status": "settling",
    "receiver": {
      "accountName": "JOHN DOE",
      "accountNumber": "8012345678",
      "bankName": "MONIEPOINT MICROFINANCE BANK"
    }
  }
}
```

Settlement fires immediately. NGN is sent to the recipient's bank account. Poll `GET /v1/payments/2S-GFT4XW` until status is `settled`.

### Request (Two-Phase)

A request lets the receiver specify the fiat amount upfront. The payer fulfills it later by choosing which crypto to pay with. The rate locks at fulfillment time, not creation.

#### Phase 1 — Receiver creates the request

**Step 1 — Find the bank code**

```http
GET /v1/banks/list?name=mon
```

```json
{
  "message": [
    "1. MONEYTRUST MFB 090129",
    "2. MONIEPOINT MICROFINANCE BANK 090405",
    "3. Monarch Microfinance Bank 090462",
    "4. Money Master PSB 120005"
  ]
}
```

**Step 2 — Verify the receiver's account**

```http
POST /v1/payments/verify-receiver
Content-Type: application/json

{
  "bankCode": "090405",
  "accountNumber": "8012345678"
}
```

```json
{
  "success": true,
  "receiver": {
    "accountName": "JOHN DOE",
    "accountNumber": "8012345678",
    "bankName": "MONIEPOINT MICROFINANCE BANK",
    "bankCode": "090405"
  }
}
```

**Step 3 — Create the request**

No crypto or network at this point — those are chosen by the payer at fulfillment.

```http
POST /v1/payments
X-API-Key: pk_xxxxx
X-Timestamp: <unix ms>
X-Signature: <hmac>
Content-Type: application/json

{
  "type": "request",
  "fiatAmount": 15000,
  "fiatCurrency": "NGN",
  "receiver": {
    "bankCode": "090405",
    "accountNumber": "8012345678"
  }
}
```

```json
{
  "success": true,
  "payment": {
    "reference": "2S-RQ7YNM",
    "type": "request",
    "status": "created",
    "fiatAmount": 15000,
    "fiatCurrency": "NGN"
  }
}
```

Receiver shares `reference` (`2S-RQ7YNM`) with the payer.

---

#### Phase 2 — Payer fulfills the request

**Step 1 — Payer pulls the request details**

```http
GET /v1/payments/2S-RQ7YNM
```

```json
{
  "success": true,
  "payment": {
    "reference": "2S-RQ7YNM",
    "type": "request",
    "status": "created",
    "fiatAmount": 15000,
    "fiatCurrency": "NGN"
  }
}
```

**Step 2 — Payer fulfills with their chosen crypto**

Rate locks here. Deposit address assigned. Payment moves to `pending`.

```http
POST /v1/payments/requests/2S-RQ7YNM/fulfill
Content-Type: application/json

{
  "payer": {
    "chatId": "7389201648"
  },
  "crypto": "USDT",
  "network": "trc20"
}
```

```json
{
  "success": true,
  "message": "Request fulfilled successfully",
  "payment": {
    "reference": "2S-RQ7YNM",
    "status": "pending",
    "depositAddress": "TQn8RE7rHWkDpAFGLamDj4R9bNHx2V3Kop",
    "cryptoAmount": 9.5812,
    "crypto": "USDT",
    "network": "trc20",
    "fiatAmount": 15000,
    "fiatCurrency": "NGN",
    "transactionUsd": 9.25,
    "rate": 1620.5,
    "charge": {
      "fiat": 0,
      "crypto": 0.3086,
      "usd": 0.19
    },
    "expiresAt": "2026-04-01T15:30:00.000Z"
  }
}
```

**Step 3 — Payer sends crypto**

> Send **9.5812 USDT (TRC20)** to `TQn8RE7rHWkDpAFGLamDj4R9bNHx2V3Kop`. Expires in 30 minutes.

The deposit watcher detects the transaction automatically. Once confirmed, settlement fires and NGN is sent to the receiver's bank account. Poll `GET /v1/payments/2S-RQ7YNM` until status is `settled`.

### Bank Confirmation (Single Phase)

For banks and financial institutions that manage their own users and fiat disbursement. The engine handles crypto deposit monitoring only — the bank confirms fiat delivery via a settlement token.

No `payer` or `receiver` required. Always uses `settlementMode: self`.

#### Step 1 — Create the session

```http
POST /v1/payments
X-API-Key: pk_xxxxx
X-Timestamp: <unix ms>
X-Signature: <hmac>
Content-Type: application/json

{
  "type": "bank_confirmation",
  "fiatAmount": 50000,
  "fiatCurrency": "NGN",
  "crypto": "USDT",
  "network": "trc20",
  "bankRef": "TXN-20260401-00123"
}
```

```json
{
  "success": true,
  "payment": {
    "reference": "2S-XXXXXX",
    "type": "bank_confirmation",
    "status": "pending",
    "depositAddress": "TQn8RE7rHWkDpAFGLamDj4R9bNHx2V3Kop",
    "cryptoAmount": 30.303,
    "crypto": "USDT",
    "network": "trc20",
    "fiatAmount": 50000,
    "fiatCurrency": "NGN",
    "transactionUsd": 30.30,
    "rate": 1650,
    "charge": {
      "fiat": 0,
      "crypto": 0.303,
      "usd": 0.18
    },
    "bankRef": "TXN-20260401-00123",
    "expiresAt": "2026-04-01T13:30:00.000Z"
  }
}
```

#### Step 2 — Customer sends crypto

Show the customer: *Send **30.303 USDT (TRC20)** to `TQn8RE7rHWkDpAFGLamDj4R9bNHx2V3Kop`.*

#### Step 3 — Monitor status

The deposit watcher confirms on-chain. When fully confirmed, the engine fires a `payment.settling` webhook to the bank — the payload includes a one-time `settlementToken`.

#### Step 4 — Bank confirms disbursement

Once the bank has sent fiat to the customer:

```http
POST /v1/payments/2S-XXXXXX/settle
X-API-Key: pk_xxxxx
X-Timestamp: <unix ms>
X-Signature: <hmac>
Content-Type: application/json

{
  "settlementToken": "<token_from_webhook_payload>",
  "settlementReference": "your-internal-disbursement-ref"
}
```

Session moves to `settled`.

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](./ARCHITECTURE.md) | System diagrams, state machines, and component overview |
| [Design](./DESIGN.md) | Merchant gateway and B2B integration design |
| [Implementation Plan](./IMPLEMENTATION.md) | Phased development roadmap |

## Features

- **Five Payment Types** - Transfer, Gift, Request, Merchant, and Bank Confirmation with appropriate flows
- **Flexible Fee Charging** - `chargeFrom: fiat` or `chargeFrom: crypto` per transfer; gifts and requests always charge from crypto
- **Multi-Provider Rate Engine** - Compares quotes from Busha, LiquidRamp, Anchor and the internal system rate; always locks the most conservative (lowest) rate
- **Rate Locking** - Exchange rate frozen at session creation; locked for the full payment window
- **HD Wallet Derivation** - Unlimited unique deposit addresses from a single seed phrase
- **Tiered Fees** - Configurable fee tiers based on transaction amount
- **Multi-Chain** - Support for BTC, ETH, BNB, TRX, USDT, and USDC across multiple networks
- **Multi-Provider Settlement** - Mongoro or self-settlement per API key
- **Per-Key Confirmation Thresholds** - Override required on-chain confirmations per chain per API key
- **Volume Analytics** - `transactionUsd` persisted on every session for processing volume tracking
- **State Machine** - Valid status transitions enforced per payment type

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ 2Settle Chat │  │ Merchant API │  │ Bank Integration │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
└─────────┼─────────────────┼───────────────────┼─────────────┘
          │                 │                   │
          ▼                 ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Payment Engine Core                       │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Session   │  │   Wallet    │  │   Rate    │ Charge  │ │
│  │   Manager   │  │    Pool     │  │  Engine   │ Calc    │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
          │                                    │
          ▼                                    ▼ (background job, every 30s)
┌──────────────────────────┐   ┌──────────────────────────────┐
│       Data Layer          │   │     External Rate Providers  │
│  ┌────────┐  ┌─────────┐ │   │  ┌────────┐  ┌───────────┐  │
│  │Sessions│  │  rates  │ │   │  │ Busha  │  │LiquidRamp │  │
│  └────────┘  └─────────┘ │   │  └────────┘  └───────────┘  │
│  ┌─────────────────────┐ │   │  ┌────────┐                  │
│  │   provider_rates    │◀┼───┼──│ Anchor │  (pluggable)     │
│  └─────────────────────┘ │   │  └────────┘                  │
└──────────────────────────┘   └──────────────────────────────┘
```

## Directory Structure

```
src/services/payment-engine/
├── index.ts                 # Public exports
├── payment-engine.ts        # Main facade class
├── types.ts                 # TypeScript interfaces
├── errors.ts                # Custom error classes
│
├── session/
│   ├── session-manager.ts   # Session orchestration
│   └── session-repository.ts # Database operations
│
├── wallet/
│   └── wallet-pool.ts       # Wallet assignment/release
│
├── rate/
│   ├── rate-service.ts      # Rate fetching, locking, crypto conversion
│   ├── rate-aggregator.ts   # Compares all provider quotes, selects lowest
│   ├── rate-fetch-job.ts    # Background job: polls providers every 30s → DB
│   ├── update-rate-job.ts   # Background job: updates system rate from CoinGecko
│   └── providers/
│       ├── types.ts         # RateProvider interface & RateQuote type
│       ├── http-provider.ts # Abstract base: fetchRate() reads DB, fetchLiveRate() does HTTP
│       ├── system.ts        # System provider: reads internal rates table
│       ├── busha.ts         # Busha adapter (plug in endpoint + parseResponse)
│       ├── liquidramp.ts    # LiquidRamp adapter
│       └── anchor.ts        # Anchor adapter
│
├── charges/
│   └── charge-calculator.ts # Fee calculation
│
├── utils/
│   └── id-generator.ts      # Payment ID generation
│
└── docs/
    ├── README.md            # This file
    ├── ARCHITECTURE.md      # Detailed diagrams
    ├── DESIGN.md            # Merchant gateway design
    └── IMPLEMENTATION.md    # Development roadmap
```

## Payment Session Lifecycle

### Transfer Flow
```
┌─────────┐    ┌────────────┐    ┌───────────┐    ┌──────────┐    ┌─────────┐
│ PENDING │───▶│ CONFIRMING │───▶│ CONFIRMED │───▶│ SETTLING │───▶│ SETTLED │
└─────────┘    └────────────┘    └───────────┘    └──────────┘    └─────────┘
```

### Gift Flow
```
┌─────────┐    ┌────────────┐    ┌───────────┐
│ PENDING │───▶│ CONFIRMING │───▶│ CONFIRMED │ (waiting for recipient to claim)
└─────────┘    └────────────┘    └───────────┘
                                       │ claim/confirm
                                       ▼
                              ┌──────────┐    ┌─────────┐
                              │ SETTLING │───▶│ SETTLED │
                              └──────────┘    └─────────┘
```

### Request Flow
```
┌─────────┐ (waiting for payer to fulfill)
│ CREATED │
└────┬────┘
     │ fulfill (payer chooses crypto)
     ▼
┌─────────┐    ┌────────────┐    ┌───────────┐    ┌──────────┐    ┌─────────┐
│ PENDING │───▶│ CONFIRMING │───▶│ CONFIRMED │───▶│ SETTLING │───▶│ SETTLED │
└─────────┘    └────────────┘    └───────────┘    └──────────┘    └─────────┘
```

### Bank Confirmation Flow
```
┌─────────┐    ┌────────────┐    ┌───────────┐    ┌──────────┐    ┌─────────┐
│ PENDING │───▶│ CONFIRMING │───▶│ CONFIRMED │───▶│ SETTLING │───▶│ SETTLED │
└─────────┘    └────────────┘    └───────────┘    └──────────┘    └─────────┘
                                                        │ bank calls /settle
                                                        │ with settlementToken
                                                        ▼
                                                   ┌─────────┐
                                                   │ SETTLED │
                                                   └─────────┘
```

## Status Definitions

| Status | Description |
|--------|-------------|
| `created` | **Request only** — session created, waiting for payer to fulfill |
| `pending` | Deposit address assigned, waiting for crypto deposit |
| `confirming` | Deposit detected on-chain, accumulating confirmations |
| `confirmed` | Deposit fully confirmed — settlement auto-triggers (or awaits claim for gifts) |
| `settling` | Fiat payout in progress |
| `settled` | Complete — receiver has been paid |
| `expired` | No deposit received before the deadline |
| `failed` | Unrecoverable error |
| `settlement_reversed` | Fiat payout reversed by provider |

## Fee Structure

| Fiat Amount | Fee |
|-------------|-----|
| ₦0 - ₦100,000 | ₦500 |
| ₦100,001 - ₦1,000,000 | ₦1,000 |
| ₦1,000,001 - ₦2,000,000 | ₦1,500 |

**Limits**: Min ₦1, Max ₦2,000,000

## Supported Networks

| Crypto | Networks |
|--------|----------|
| BTC | `bitcoin` |
| ETH | `ethereum` |
| BNB | `bsc` |
| TRX | `tron` |
| USDT | `erc20`, `bep20`, `trc20` |
| USDC | `erc20`, `bep20` |

## Rate Engine

The rate engine selects the exchange rate used to lock each payment session. It compares quotes from the internal system rate and any enabled external providers, always choosing the lowest (most conservative) rate.

### How it works

**Transaction path (zero external API calls):**

```
lockRate()
  → RateAggregator.getBestRate()
      → reads in-memory cache (60s TTL, shared within the process)
      → or: each provider reads its row from provider_rates table
      → selectBest: min(all quotes)
```

**Background job (the only thing that calls external APIs):**

```
RateFetchJob (every 30s)
  → provider.fetchLiveRate()    ← HTTP call to Busha / LiquidRamp / Anchor
  → INSERT ... ON DUPLICATE KEY UPDATE provider_rates
  → clearAggregatorCache()      ← next transaction sees fresh rates
```

This decoupling means external provider APIs are called at most ~120 times per hour regardless of transaction volume.

### Selection rule

The system rate acts as a ceiling:

| System | Busha | LiquidRamp | Selected |
|--------|-------|------------|----------|
| 1600 | 1580 | 1570 | **1570** (LiquidRamp — lowest of all) |
| 1600 | 1650 | 1640 | **1600** (system — lowest of all) |
| 1600 | 1580 | *(failed)* | **1580** (Busha — below system) |
| 1600 | *(failed)* | *(failed)* | **1600** (system fallback) |

If a provider's cached rate is more than 5 minutes old (stale), it is skipped for that round.

### Adding a provider

1. Create `src/services/payment-engine/rate/providers/yourprovider.ts` extending `HttpRateProvider`
2. Implement `buildRequest()` (Axios config) and `parseResponse()` (extract NGN/USD rate)
3. Register it in `rate-fetch-job.ts` `HTTP_PROVIDERS` array and `rate-aggregator.ts` `ALL_PROVIDERS` array
4. Add config block to `config/index.ts` and corresponding env vars

### Activating a provider

```env
# Enable one or more external providers
BUSHA_RATE_ENABLED=true
BUSHA_API_KEY=your_key
BUSHA_API_URL=https://api.busha.co

LIQUIDRAMP_RATE_ENABLED=true
LIQUIDRAMP_API_KEY=your_key
LIQUIDRAMP_API_URL=https://api.liquidramp.com

ANCHOR_RATE_ENABLED=true
ANCHOR_API_KEY=your_key
ANCHOR_API_URL=https://api.anchorfis.com

# How often the background job polls providers (default 30s)
RATE_FETCH_INTERVAL_MS=30000
```

### Database migration

Run before starting the server for the first time with external providers enabled:

```sql
source src/services/payment-engine/migrations/013_create_provider_rates.sql
```

---

## Configuration

```typescript
const DEFAULT_CONFIG = {
  sessionTtlMinutes: 30,      // Payment window
  rateLockTtlMinutes: 30,     // Rate validity
  giftClaimTtlDays: 30,       // Gift claim window
  requestTtlDays: 7,          // Request validity
  amountTolerance: 0.02,      // 2% tolerance for deposits
  confirmations: {
    bitcoin: 2,
    ethereum: 12,
    bsc: 15,
    tron: 19,
    polygon: 128,
    base: 12,
  },
};
```

## Utility Scripts

### Generate Paid Gifts

Use the gift generator to create paid gift records directly in the database. The script inserts into both `gifts` and `summaries`, marking the gift as paid on creation.

Dry run:

```bash
pnpm run generate:gift-ids -- --count 10 --amount 5000 --db settle_db_test --host 127.0.0.1 --port 3306 --user root --password PASSWORD
```

Apply changes:

```bash
pnpm run generate:gift-ids -- --count 10 --amount 5000 --db settle_db_test --host 127.0.0.1 --port 3306 --user root --password PASSWORD --apply
```

Arguments:
- `--count` number of gifts to create
- `--amount` naira amount for each gift
- `--total-dollar` dollar value to store in `summaries` for each gift. Defaults to the same value as `--amount`
- `--db` database name
- `--host` database host
- `--port` database port
- `--user` database user
- `--password` database password
- `--apply` actually writes to the database. Without this flag, the script only previews generated gift IDs

`pnpm` is the preferred command here because this repo already uses `pnpm`, but `npm run generate:gift-ids -- ...` also works.

## Testing

```bash
pnpm test                    # Run all tests
pnpm test payment-engine     # Run payment engine tests only
```

Tests are located in `__tests__/payment-engine/`:
- `id-generator.test.ts` - ID generation tests
- `charge-calculator.test.ts` - Fee calculation tests
- `rate-service.test.ts` - Rate locking tests
- `wallet-pool.test.ts` - Wallet assignment tests
- `session-manager.test.ts` - Session orchestration tests
