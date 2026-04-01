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

A gift lets the sender pay crypto upfront without knowing the recipient's bank details. The recipient claims later by providing their account.

#### Phase 1 — Sender creates the gift

No receiver needed at creation. The sender gets a deposit address and shares the `reference` with the recipient.

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
    "id": 31,
    "reference": "2S-GFT4XW",
    "type": "gift",
    "status": "pending",
    "depositAddress": "TQn8RE7rHWkDpAFGLamDj4R9bNHx2V3Kop",
    "cryptoAmount": 12.5,
    "crypto": "USDT",
    "network": "trc20",
    "fiatAmount": 20000,
    "fiatCurrency": "NGN",
    "rate": 1620.5,
    "chargeAmount": 500,
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
    "id": 54,
    "reference": "2S-RQ7YNM",
    "type": "request",
    "status": "created",
    "depositAddress": null,
    "cryptoAmount": null,
    "crypto": null,
    "network": null,
    "fiatAmount": 15000,
    "fiatCurrency": "NGN",
    "rate": null,
    "chargeAmount": null,
    "expiresAt": null
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
    "id": 54,
    "reference": "2S-RQ7YNM",
    "status": "pending",
    "depositAddress": "TQn8RE7rHWkDpAFGLamDj4R9bNHx2V3Kop",
    "cryptoAmount": 9.5812,
    "crypto": "USDT",
    "network": "trc20",
    "fiatAmount": 15000,
    "fiatCurrency": "NGN",
    "rate": 1620.5,
    "chargeAmount": 500,
    "expiresAt": "2026-04-01T15:30:00.000Z"
  }
}
```

**Step 3 — Payer sends crypto**

> Send **9.5812 USDT (TRC20)** to `TQn8RE7rHWkDpAFGLamDj4R9bNHx2V3Kop`. Expires in 30 minutes.

The deposit watcher detects the transaction automatically. Once confirmed, settlement fires and NGN is sent to the receiver's bank account. Poll `GET /v1/payments/2S-RQ7YNM` until status is `settled`.

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](./backend/ARCHITECTURE.md) | System diagrams, state machines, and component overview |
| [Design](./backend/DESIGN.md) | Merchant gateway and B2B integration design |
| [Implementation Plan](./backend/IMPLEMENTATION.md) | Phased development roadmap |

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

**Limits**: Min ₦0, Max ₦2,000,000

## Supported Networks

| Crypto | Networks |
|--------|----------|
| BTC | `bitcoin` |
| ETH | `ethereum` |
| BNB | `bsc` |
| TRX | `tron` |
| USDT | `erc20`, `bep20`, `trc20` |
| USDC | `erc20`, `bep20` |

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

Tests are located in `backend/__tests__/payment-engine/`:
- `id-generator.test.ts` - ID generation tests
- `charge-calculator.test.ts` - Fee calculation tests
- `rate-service.test.ts` - Rate locking tests
- `wallet-pool.test.ts` - Wallet assignment tests
- `session-manager.test.ts` - Session orchestration tests
