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

User provides bank details and pays crypto in one flow:

```typescript
import { PaymentEngine } from '@/services/payment-engine';

const session = await PaymentEngine.createPayment({
  type: 'transfer',
  fiatAmount: 50000,        // ₦50,000
  fiatCurrency: 'NGN',
  crypto: 'USDT',
  network: 'bep20',
  payer: {
    chatId: 'user_123',
    phone: '08012345678'
  },
  receiver: {
    bankCode: '058',
    accountNumber: '1234567890',
    accountName: 'John Doe'
  }
});

console.log(session.depositAddress);  // Where user sends crypto
console.log(session.cryptoAmount);    // How much to send
console.log(session.reference);       // Human-readable reference (2S-XXXXXX)
```

### Gift (Two-Phase)

**Phase 1: Create Gift** - Sender pays crypto, gets a gift ID:

```typescript
const gift = await PaymentEngine.createGift({
  fiatAmount: 25000,        // ₦25,000 worth
  fiatCurrency: 'NGN',
  crypto: 'USDT',
  network: 'bep20',
  sender: {
    chatId: 'sender_123',
    phone: '08011111111',
    name: 'Alice'           // Optional sender name for gift message
  },
  message: 'Happy Birthday!'  // Optional gift message
});

console.log(gift.depositAddress);  // Sender pays crypto here
console.log(gift.cryptoAmount);    // Amount to send
console.log(gift.giftId);          // Share this with recipient (e.g., GIFT-XXXXXX)
```

**Phase 2: Claim Gift** - Recipient provides bank details to receive fiat:

```typescript
const claimed = await PaymentEngine.claimGift({
  giftId: 'GIFT-ABC123',
  receiver: {
    bankCode: '058',
    accountNumber: '0987654321',
    accountName: 'Bob Smith',
    phone: '08022222222'
  }
});

console.log(claimed.status);        // 'settling' - fiat payout initiated
console.log(claimed.fiatAmount);    // ₦25,000 to be received
```

### Request (Two-Phase)

**Phase 1: Create Request** - User specifies how much fiat they want to receive:

```typescript
const request = await PaymentEngine.createRequest({
  fiatAmount: 100000,       // ₦100,000 requested
  fiatCurrency: 'NGN',
  receiver: {
    chatId: 'requester_123',
    phone: '08033333333',
    bankCode: '058',
    accountNumber: '1234567890',
    accountName: 'Charlie Brown'
  },
  description: 'Payment for freelance work'  // Optional
});

console.log(request.requestId);     // Share with payer (e.g., REQ-XXXXXX)
console.log(request.fiatAmount);    // ₦100,000
```

**Phase 2: Pay Request** - Payer pays the crypto equivalent:

```typescript
const payment = await PaymentEngine.payRequest({
  requestId: 'REQ-XYZ789',
  crypto: 'BTC',            // Payer chooses crypto
  network: 'bitcoin',
  payer: {
    chatId: 'payer_456',
    phone: '08044444444'
  }
});

console.log(payment.depositAddress);  // Payer sends crypto here
console.log(payment.cryptoAmount);    // BTC equivalent of ₦100,000
console.log(payment.status);          // 'pending' - waiting for deposit
```

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
