# 2Settle Payment Engine

A standalone crypto-to-fiat payment engine that enables banks, fintechs, and merchants to accept cryptocurrency payments and settle in local fiat currency.

## Transaction Types

The payment engine supports three core transaction types:

| Type | Description | Phases |
|------|-------------|--------|
| **Transfer** | Direct crypto-to-bank payment | Single phase: pay crypto, receive fiat |
| **Gift** | Send crypto as a claimable gift | Two phases: create gift, claim gift |
| **Request** | Request payment from someone | Two phases: create request, pay request |

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

**Fiat-first** (deliver a specific NGN amount):

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
    "id": 17,
    "reference": "2S-K4M9PX",
    "type": "transfer",
    "status": "pending",
    "depositAddress": "TQn8RE7rHWkDpAFGLamDj4R9bNHx2V3Kop",
    "cryptoAmount": 31.2658,
    "crypto": "USDT",
    "network": "trc20",
    "fiatAmount": 50000,
    "fiatCurrency": "NGN",
    "rate": 1620.5,
    "chargeAmount": 500,
    "expiresAt": "2026-04-01T13:30:00.000Z"
  }
}
```

**Crypto-first** (payer sends a fixed crypto amount, engine calculates fiat after fees):

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
    "id": 18,
    "reference": "2S-R7NW2Q",
    "type": "transfer",
    "status": "pending",
    "depositAddress": "TQn8RE7rHWkDpAFGLamDj4R9bNHx2V3Kop",
    "cryptoAmount": 31.2658,
    "crypto": "USDT",
    "network": "trc20",
    "fiatAmount": 49500,
    "fiatCurrency": "NGN",
    "rate": 1620.5,
    "chargeAmount": 500,
    "expiresAt": "2026-04-01T13:30:00.000Z"
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

> Documentation coming soon.

### Request (Two-Phase)

> Documentation coming soon.

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](./ARCHITECTURE.md) | System diagrams, state machines, and component overview |
| [Design](./DESIGN.md) | Merchant gateway and B2B integration design |
| [Implementation Plan](./IMPLEMENTATION.md) | Phased development roadmap |

## Features

- **Three Transaction Types** - Transfer, Gift, and Request with appropriate flows
- **Rate Locking** - Freeze exchange rates during payment window
- **Wallet Pool** - Automatic wallet assignment with concurrency safety
- **Tiered Fees** - Configurable fee tiers based on transaction amount
- **Multi-Chain** - Support for BTC, ETH, BNB, TRX, and USDT (ERC20/BEP20/TRC20)
- **State Machine** - Valid status transitions enforced per transaction type

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
│  │   Manager   │  │    Pool     │  │  Service  │ Calc    │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                       Data Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Sessions   │  │   Wallets    │  │      Rates       │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
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
│   └── rate-service.ts      # Rate fetching & locking
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
┌─────────┐    ┌─────────┐    ┌────────────┐    ┌───────────┐    ┌──────────┐    ┌─────────┐
│ CREATED │───▶│ PENDING │───▶│ CONFIRMING │───▶│ CONFIRMED │───▶│ SETTLING │───▶│ SETTLED │
└─────────┘    └─────────┘    └────────────┘    └───────────┘    └──────────┘    └─────────┘
```

### Gift Flow
```
┌─────────┐    ┌─────────┐    ┌────────────┐    ┌───────────┐    ┌─────────────────┐
│ CREATED │───▶│ PENDING │───▶│ CONFIRMING │───▶│ CONFIRMED │───▶│ PENDING_CLAIM   │
└─────────┘    └─────────┘    └────────────┘    └───────────┘    └────────┬────────┘
                                                                          │ claimGift()
                                                                          ▼
                                                                 ┌──────────┐    ┌─────────┐
                                                                 │ SETTLING │───▶│ SETTLED │
                                                                 └──────────┘    └─────────┘
```

### Request Flow
```
┌─────────┐    ┌─────────────────┐
│ CREATED │───▶│ PENDING_PAYMENT │ (waiting for payer)
└─────────┘    └────────┬────────┘
                        │ payRequest()
                        ▼
               ┌─────────┐    ┌────────────┐    ┌───────────┐    ┌──────────┐    ┌─────────┐
               │ PENDING │───▶│ CONFIRMING │───▶│ CONFIRMED │───▶│ SETTLING │───▶│ SETTLED │
               └─────────┘    └────────────┘    └───────────┘    └──────────┘    └─────────┘
```

## Status Definitions

| Status | Description |
|--------|-------------|
| `created` | Session initialized |
| `pending` | Wallet assigned, waiting for crypto deposit |
| `confirming` | Deposit detected, waiting for blockchain confirmations |
| `confirmed` | Deposit confirmed on-chain |
| `pending_claim` | **Gift only**: Crypto received, waiting for recipient to claim |
| `pending_payment` | **Request only**: Request created, waiting for payer |
| `settling` | Fiat payout in progress |
| `settled` | Complete - recipient received fiat |
| `expired` | No deposit/claim received within time window |
| `failed` | Error occurred during processing |

## Fee Structure

| Fiat Amount | Fee |
|-------------|-----|
| ₦0 - ₦100,000 | ₦500 |
| ₦100,001 - ₦1,000,000 | ₦1,000 |
| ₦1,000,001 - ₦2,000,000 | ₦1,500 |

**Limits**: Min ₦0, Max ₦2,000,000

## Supported Networks

| Crypto | Networks |
|--------|----------|
| BTC | `bitcoin` |
| ETH | `ethereum` |
| BNB | `bsc` |
| TRX | `tron` |
| USDT | `erc20`, `bep20`, `trc20` |

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
