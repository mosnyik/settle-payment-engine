# Payment Engine Implementation Plan

## Progress Summary

| Phase | Status | Progress |
|-------|--------|----------|
| Phase 1: Core Engine | ✅ Complete | 100% |
| Phase 2: Transaction Types | 🔲 Not Started | 0% |
| Phase 3: Persistence & Migration | 🔲 Not Started | 0% |
| Phase 4: Chat Integration | 🔲 Not Started | 0% |
| Phase 5: Merchant API | 🔲 Not Started | 0% |
| Phase 6: Deposit Monitoring | 🔲 Not Started | 0% |
| Phase 7: Webhooks | 🔲 Not Started | 0% |
| Phase 8: Settlement Rails | 🔲 Not Started | 0% |
| Phase 9: Cashback | 🔲 Not Started | 0% |
| Phase 10: Admin Dashboard | 🔲 Not Started | 0% |
| Phase 11: Merchant Dashboard | 🔲 Not Started | 0% |

**Last Updated**: 2026-02-18

---

## Vision

Build a standalone payment engine that supports three core transaction types:

| Type | Description | Flow |
|------|-------------|------|
| **Transfer** | Direct crypto-to-fiat payment | Single phase: payer + receiver known upfront |
| **Gift** | Send crypto as claimable gift | Two phases: create (sender pays) → claim (receiver provides bank) |
| **Request** | Request payment from someone | Two phases: create (receiver specifies amount) → pay (payer sends crypto) |

**Target clients**: Banks, fintechs, e-commerce platforms, payment aggregators, end users via chat

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Client Layer                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ 2Settle Chat │  │ Merchant API │  │ Bank/Fintech Integration │  │
│  │ (existing)   │  │ (new)        │  │ (new)                    │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
└─────────┼─────────────────┼────────────────────────┼────────────────┘
          │                 │                        │
          ▼                 ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Payment Engine Core                             │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │   Session   │  │   Wallet    │  │    Rate     │  │  Charge    │ │
│  │   Manager   │  │    Pool     │  │   Service   │  │ Calculator │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    Transaction Types                             ││
│  │  ┌───────────┐  ┌─────────────────┐  ┌─────────────────────┐   ││
│  │  │ Transfer  │  │      Gift       │  │      Request        │   ││
│  │  │           │  │                 │  │                     │   ││
│  │  │ • create  │  │ • createGift    │  │ • createRequest     │   ││
│  │  │           │  │ • claimGift     │  │ • payRequest        │   ││
│  │  └───────────┘  └─────────────────┘  └─────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │  Deposit    │  │ Settlement  │  │  Webhook    │  │  Cashback  │ │
│  │  Monitor    │  │   Rails     │  │  Dispatcher │  │   Engine   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Data Layer                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ Sessions │  │ Wallets  │  │ Merchants│  │ Webhooks │            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Core Engine Foundation ✅ COMPLETE

**Goal**: Basic session management, wallet pool, rate service, charge calculation

**Duration**: 2 weeks

**Completed**: 2026-02-17

#### 1.1 Project Structure ✅
```
src/services/payment-engine/
├── index.ts                     # Public exports
├── payment-engine.ts            # PaymentEngine facade class
├── types.ts                     # All TypeScript interfaces
├── errors.ts                    # Custom error classes
│
├── session/
│   ├── index.ts                 # Session exports
│   ├── session-manager.ts       # Create, get, update sessions
│   └── session-repository.ts    # DB operations for sessions
│
├── wallet/
│   ├── index.ts                 # Wallet exports
│   └── wallet-pool.ts           # Assign/release wallets with FOR UPDATE
│
├── rate/
│   ├── index.ts                 # Rate exports
│   └── rate-service.ts          # Fetch & lock rates with caching
│
├── charges/
│   ├── index.ts                 # Charges exports
│   └── charge-calculator.ts     # Tiered fee calculation
│
├── utils/
│   ├── index.ts                 # Utils exports
│   └── id-generator.ts          # Generate payment IDs & references
│
└── docs/
    ├── README.md                # Quick start guide
    ├── ARCHITECTURE.md          # System diagrams
    ├── DESIGN.md                # Merchant gateway design
    └── IMPLEMENTATION.md        # This file
```

#### 1.2 Core Types ✅
- [x] `PaymentStatus` type with all states including `pending_claim`, `pending_payment`
- [x] `CreatePaymentInput` interface
- [x] `PaymentSession` interface
- [x] `WalletAssignment` interface
- [x] `RateLock` interface
- [x] `Network` type with token standards
- [x] Error types

#### 1.3 Components ✅
- [x] Session Manager - basic CRUD
- [x] Wallet Pool - assign/release with concurrency
- [x] Rate Service - fetch, lock, cache
- [x] Charge Calculator - tiered fees

#### 1.4 Tests ✅ (144 tests passing)
- [x] `id-generator.test.ts` — 23 tests
- [x] `charge-calculator.test.ts` — 34 tests
- [x] `rate-service.test.ts` — 22 tests
- [x] `wallet-pool.test.ts` — 25 tests
- [x] `session-manager.test.ts` — 40 tests

**Deliverable**: ✅ Basic payment engine with transfer flow

---

### Phase 2: Transaction Types 🔜 NEXT

**Goal**: Implement Gift and Request flows on top of Phase 1 foundation

**Duration**: 2 weeks

**Prerequisites**: Phase 1 ✅

#### 2.1 Types Extension

```typescript
// types.ts additions

// Payment session type
type PaymentType = 'transfer' | 'gift' | 'request' | 'merchant';

// Extended status for gift/request
type PaymentStatus =
  | 'created'
  | 'pending_payment'    // Request: waiting for payer
  | 'pending'            // Wallet assigned, waiting for deposit
  | 'confirming'
  | 'confirmed'
  | 'pending_claim'      // Gift: waiting for recipient
  | 'settling'
  | 'settled'
  | 'expired'
  | 'failed';

// Gift-specific input
interface CreateGiftInput {
  fiatAmount: number;
  fiatCurrency: string;
  crypto: CryptoAsset;
  network: Network;
  sender: {
    chatId: string;
    phone: string;
    name?: string;       // Display name for gift message
  };
  message?: string;      // Gift message
}

// Gift claim input
interface ClaimGiftInput {
  giftId: string;
  receiver: {
    bankCode: string;
    accountNumber: string;
    accountName: string;
    phone?: string;
  };
}

// Request-specific input
interface CreateRequestInput {
  fiatAmount: number;
  fiatCurrency: string;
  receiver: {
    chatId: string;
    phone: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
  };
  description?: string;
}

// Pay request input
interface PayRequestInput {
  requestId: string;
  crypto: CryptoAsset;
  network: Network;
  payer: {
    chatId: string;
    phone: string;
  };
}
```

#### 2.2 Session Manager Extensions

```typescript
// session-manager.ts additions

class SessionManager {
  // Existing
  async createSession(input: CreatePaymentInput): Promise<PaymentSession>;

  // NEW: Gift methods
  async createGift(input: CreateGiftInput): Promise<GiftSession>;
  async claimGift(input: ClaimGiftInput): Promise<PaymentSession>;
  async getGiftByGiftId(giftId: string): Promise<GiftSession | null>;

  // NEW: Request methods
  async createRequest(input: CreateRequestInput): Promise<RequestSession>;
  async payRequest(input: PayRequestInput): Promise<PaymentSession>;
  async getRequestByRequestId(requestId: string): Promise<RequestSession | null>;
}
```

#### 2.3 State Machine Updates

```typescript
// Valid transitions by type
const VALID_TRANSITIONS: Record<PaymentType, Record<PaymentStatus, PaymentStatus[]>> = {
  transfer: {
    created: ['pending'],
    pending: ['confirming', 'expired'],
    confirming: ['confirmed'],
    confirmed: ['settling'],
    settling: ['settled', 'failed'],
    // Terminal states
    settled: [],
    expired: [],
    failed: [],
  },

  gift: {
    created: ['pending'],
    pending: ['confirming', 'expired'],
    confirming: ['confirmed'],
    confirmed: ['pending_claim'],         // Gift waits for claim
    pending_claim: ['settling', 'expired'], // Claim or expire
    settling: ['settled', 'failed'],
    settled: [],
    expired: [],
    failed: [],
  },

  request: {
    created: ['pending_payment'],         // Request waits for payer
    pending_payment: ['pending', 'expired'], // Payer joins or expires
    pending: ['confirming', 'expired'],
    confirming: ['confirmed'],
    confirmed: ['settling'],
    settling: ['settled', 'failed'],
    settled: [],
    expired: [],
    failed: [],
  },
};
```

#### 2.4 ID Generation

```typescript
// utils/id-generator.ts additions

// Generate gift ID: GIFT-XXXXXX
function generateGiftId(): string;

// Generate request ID: REQ-XXXXXX
function generateRequestId(): string;
```

#### 2.5 Tasks

- [ ] Add `pending_claim` and `pending_payment` to `PaymentStatus` type
- [ ] Add `type` field to session: `'transfer' | 'gift' | 'request'`
- [ ] Add gift-specific fields: `giftId`, `giftMessage`, `giftSenderName`, `giftClaimExpiresAt`
- [ ] Add request-specific fields: `requestId`, `requestDescription`, `requestExpiresAt`
- [ ] Implement `createGift()` - locks rate, assigns wallet, generates giftId
- [ ] Implement `claimGift()` - validates gift, adds receiver, triggers settlement
- [ ] Implement `createRequest()` - stores receiver info, NO wallet yet
- [ ] Implement `payRequest()` - locks rate, assigns wallet, starts payment flow
- [ ] Update state machine with type-specific transitions
- [ ] Add `generateGiftId()` and `generateRequestId()` utilities
- [ ] Update `getSession()` to handle gift/request lookups

#### 2.6 Tests

- [ ] `gift-flow.test.ts` — Create gift, claim gift, expiry
- [ ] `request-flow.test.ts` — Create request, pay request, expiry
- [ ] `state-machine.test.ts` — Verify transitions per type
- [ ] Update existing tests for backward compatibility

**Deliverable**: Full gift and request flows working

---

### Phase 3: Persistence & Migration

**Goal**: Clean database schema, proper repository layer

**Duration**: 1 week

**Prerequisites**: Phase 2

#### 3.1 Database Schema

```sql
-- Add timestamp columns to wallets table
ALTER TABLE wallets
  ADD COLUMN bitcoin_last_assigned DATETIME DEFAULT NULL,
  ADD COLUMN ethereum_last_assigned DATETIME DEFAULT NULL,
  ADD COLUMN binance_last_assigned DATETIME DEFAULT NULL,
  ADD COLUMN tron_last_assigned DATETIME DEFAULT NULL,
  ADD COLUMN erc20_last_assigned DATETIME DEFAULT NULL,
  ADD COLUMN bep20_last_assigned DATETIME DEFAULT NULL,
  ADD COLUMN trc20_last_assigned DATETIME DEFAULT NULL;

-- Create unified payment_sessions table
CREATE TABLE payment_sessions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payment_id VARCHAR(32) NOT NULL UNIQUE,
  reference VARCHAR(12) NOT NULL UNIQUE,

  -- Type & status
  type ENUM('transfer', 'gift', 'request', 'merchant') NOT NULL,
  status ENUM('created', 'pending_payment', 'pending', 'confirming',
              'confirmed', 'pending_claim', 'settling', 'settled',
              'expired', 'failed') DEFAULT 'created',

  -- Amounts
  fiat_amount DECIMAL(15, 2) NOT NULL,
  fiat_currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
  crypto_amount DECIMAL(18, 8) NULL,      -- NULL for requests until paid
  crypto_asset VARCHAR(10) NULL,
  network VARCHAR(10) NULL,

  -- Rate (locked when applicable)
  exchange_rate DECIMAL(12, 4) NULL,
  asset_price DECIMAL(18, 8) NULL,
  rate_locked_at DATETIME NULL,
  rate_expires_at DATETIME NULL,

  -- Charges
  fiat_charge DECIMAL(10, 2) NULL,
  crypto_charge DECIMAL(18, 8) NULL,
  fee_tier VARCHAR(20) NULL,

  -- Wallet assignment (NULL for requests until paid)
  wallet_id INT DEFAULT NULL,
  deposit_address VARCHAR(100) DEFAULT NULL,
  wallet_assigned_at DATETIME DEFAULT NULL,
  wallet_expires_at DATETIME DEFAULT NULL,

  -- Deposit tracking
  deposit_tx_hash VARCHAR(100) DEFAULT NULL,
  deposit_amount DECIMAL(18, 8) DEFAULT NULL,
  deposit_confirmed_at DATETIME DEFAULT NULL,

  -- Settlement
  settlement_tx_hash VARCHAR(100) DEFAULT NULL,
  settled_at DATETIME DEFAULT NULL,

  -- Participants (nullable based on type/phase)
  payer_id INT DEFAULT NULL,              -- NULL for requests until paid
  receiver_id INT DEFAULT NULL,           -- NULL for gifts until claimed

  -- Gift-specific
  gift_id VARCHAR(20) DEFAULT NULL UNIQUE,
  gift_message TEXT DEFAULT NULL,
  gift_sender_name VARCHAR(100) DEFAULT NULL,
  gift_claim_expires_at DATETIME DEFAULT NULL,
  gift_claimed_at DATETIME DEFAULT NULL,

  -- Request-specific
  request_id VARCHAR(20) DEFAULT NULL UNIQUE,
  request_description TEXT DEFAULT NULL,
  request_expires_at DATETIME DEFAULT NULL,

  -- Merchant (for API)
  merchant_id INT DEFAULT NULL,
  metadata JSON DEFAULT NULL,

  -- Timestamps
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  confirmed_at DATETIME DEFAULT NULL,

  -- Indexes
  INDEX idx_type_status (type, status),
  INDEX idx_gift_id (gift_id),
  INDEX idx_request_id (request_id),
  INDEX idx_payer (payer_id),
  INDEX idx_receiver (receiver_id),
  INDEX idx_merchant (merchant_id),
  INDEX idx_deposit_address (deposit_address),
  INDEX idx_pending_claim (status, gift_claim_expires_at),
  INDEX idx_pending_payment (status, request_expires_at),

  -- Foreign keys
  FOREIGN KEY (wallet_id) REFERENCES wallets(id),
  FOREIGN KEY (payer_id) REFERENCES payers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

#### 3.2 Repository Layer

```
src/services/payment-engine/
├── repositories/
│   ├── index.ts
│   ├── session-repository.ts    # Full CRUD for payment_sessions
│   ├── wallet-repository.ts     # Wallet pool DB operations
│   └── types.ts                 # Repository interfaces
```

#### 3.3 Tasks

- [ ] Create migration file for wallets table alterations
- [ ] Create migration file for payment_sessions table
- [ ] Implement `SessionRepository` with all CRUD operations
- [ ] Implement `WalletRepository` with atomic assignment
- [ ] Add transaction wrapper for multi-table operations
- [ ] Run migrations on development database
- [ ] Test foreign key constraints

**Deliverable**: Clean database schema, repository layer

---

### Phase 4: Chat Integration

**Goal**: Refactor existing chatbot to use the payment engine

**Duration**: 1.5 weeks

**Prerequisites**: Phase 3

#### 4.1 Adapter Layer

```
src/features/chatbot/adapters/
├── payment-engine-adapter.ts    # Bridge between chatbot and engine
└── legacy-adapter.ts            # Keep old flow working during migration
```

#### 4.2 Handler Mapping

| Chat Handler | Engine Method |
|--------------|---------------|
| `transferHandler` | `PaymentEngine.createPayment()` |
| `giftHandler` (create) | `PaymentEngine.createGift()` |
| `giftHandler` (claim) | `PaymentEngine.claimGift()` |
| `requestHandler` (create) | `PaymentEngine.createRequest()` |
| `requestHandler` (pay) | `PaymentEngine.payRequest()` |

#### 4.3 Tasks

- [ ] Create `PaymentEngineAdapter` class
- [ ] Refactor `transferHandler` to use adapter
- [ ] Refactor `giftHandler` (create flow) to use adapter
- [ ] Refactor `giftHandler` (claim flow) to use adapter
- [ ] Refactor `requestHandler` (create flow) to use adapter
- [ ] Refactor `requestHandler` (pay flow) to use adapter
- [ ] Update stores to work with `PaymentSession` type
- [ ] Add `USE_PAYMENT_ENGINE` feature flag
- [ ] Test all flows via chatbot

**Deliverable**: Chat product works on new engine

---

### Phase 5: Merchant API

**Goal**: REST API for external clients

**Duration**: 2 weeks

**Prerequisites**: Phase 4

#### 5.1 API Endpoints

```
src/pages/api/v1/
├── payments/
│   ├── initialize.ts            # POST - Create transfer payment
│   ├── [id].ts                  # GET - Get payment by ID
│   └── verify/[reference].ts    # GET - Verify by reference
├── gifts/
│   ├── create.ts                # POST - Create gift
│   ├── claim.ts                 # POST - Claim gift
│   └── [giftId].ts              # GET - Get gift status
├── requests/
│   ├── create.ts                # POST - Create request
│   ├── pay.ts                   # POST - Pay request
│   └── [requestId].ts           # GET - Get request status
├── rates.ts                     # GET - Current rates
└── merchants/
    └── me.ts                    # GET - Merchant profile
```

#### 5.2 Hosted Checkout Pages

```
src/pages/
├── pay/[paymentId].tsx          # Transfer checkout
├── gift/[giftId].tsx            # Gift claim page
└── request/[requestId].tsx      # Request payment page
```

#### 5.3 Tasks

- [ ] Create merchant schema (merchants, api_keys, settlement_accounts)
- [ ] Implement API key generation and validation
- [ ] Build transfer endpoints (initialize, verify)
- [ ] Build gift endpoints (create, claim, status)
- [ ] Build request endpoints (create, pay, status)
- [ ] Build rates endpoint
- [ ] Create hosted checkout page for transfers
- [ ] Create gift claim page
- [ ] Create request payment page
- [ ] Add rate limiting middleware
- [ ] Add request logging

**Deliverable**: Working merchant API with hosted pages

---

### Phase 6: Deposit Monitoring

**Goal**: Automated on-chain deposit detection

**Duration**: 2 weeks

**Prerequisites**: Phase 5

#### 6.1 Monitor Architecture

```
src/services/payment-engine/monitoring/
├── deposit-monitor.ts           # Main monitor orchestrator
├── chain-adapters/
│   ├── types.ts                 # ChainAdapter interface
│   ├── bitcoin-adapter.ts       # BTC monitoring
│   ├── evm-adapter.ts           # ETH, BSC, Polygon
│   └── tron-adapter.ts          # TRON monitoring
└── confirmation-tracker.ts      # Track confirmation counts
```

#### 6.2 Tasks

- [ ] Define `ChainAdapter` interface
- [ ] Implement Bitcoin adapter (blockstream.info or mempool.space)
- [ ] Implement EVM adapter (Alchemy/Infura)
- [ ] Implement TRON adapter (TronGrid)
- [ ] Build deposit monitor cron job
- [ ] Implement amount matching with tolerance
- [ ] Handle expiry (releases wallet, fires webhook)
- [ ] Add monitoring for `pending_claim` expiry (gifts)
- [ ] Add monitoring for `pending_payment` expiry (requests)

**Deliverable**: Automated deposit detection

---

### Phase 7: Webhooks

**Goal**: Notify clients of payment events

**Duration**: 1 week

**Prerequisites**: Phase 6

#### 7.1 Events

| Event | Transaction Types |
|-------|-------------------|
| `payment.pending` | All (when wallet assigned) |
| `payment.confirming` | All |
| `payment.confirmed` | All |
| `gift.pending_claim` | Gift |
| `gift.claimed` | Gift |
| `payment.settled` | All |
| `payment.expired` | All |
| `payment.failed` | All |

#### 7.2 Tasks

- [ ] Create webhook_deliveries table
- [ ] Implement webhook dispatcher with retry
- [ ] Implement HMAC-SHA512 signing
- [ ] Add delivery logging
- [ ] Hook into session manager status changes
- [ ] Add gift-specific events (pending_claim, claimed)

**Deliverable**: Reliable webhook delivery

---

### Phase 8: Settlement Rails

**Goal**: Automated fiat payout

**Duration**: 1.5 weeks

**Prerequisites**: Phase 7

#### 8.1 Architecture

```
src/services/payment-engine/settlement/
├── settlement-engine.ts         # Orchestrator
├── rails/
│   ├── types.ts                 # SettlementRail interface
│   ├── ngn-rail.ts              # Nigerian Naira
│   ├── ghs-rail.ts              # Ghanaian Cedi (future)
│   └── kes-rail.ts              # Kenyan Shilling (future)
└── settlement-repository.ts     # DB operations
```

#### 8.2 Tasks

- [ ] Define `SettlementRail` interface
- [ ] Implement NGN rail using existing bank transfer logic
- [ ] Create settlements table
- [ ] Build settlement trigger on confirmation
- [ ] Handle settlement for gifts (after claim)
- [ ] Handle settlement for requests (after confirm)
- [ ] Add settlement status tracking

**Deliverable**: Automated fiat settlement

---

### Phase 9: Cashback System

**Goal**: Reward users for transactions

**Duration**: 1 week

**Prerequisites**: Phase 8

#### 9.1 Tasks

- [ ] Create cashback_rules table
- [ ] Create cashback_ledger table
- [ ] Implement rule-based calculation
- [ ] Support percentage and fixed amounts
- [ ] Add user balance tracking
- [ ] Implement redemption logic

**Deliverable**: Working cashback system

---

### Phase 10: Admin Dashboard

**Goal**: Internal operations tools

**Duration**: 2 weeks

**Prerequisites**: Phase 9

#### 10.1 Features

- [ ] Payment monitoring (all types, all statuses)
- [ ] Gift tracking (pending claims, expired)
- [ ] Request tracking (pending payments, expired)
- [ ] Wallet pool status
- [ ] Merchant management
- [ ] Settlement overview
- [ ] Webhook delivery logs
- [ ] Cashback rules management

**Deliverable**: Admin dashboard

---

### Phase 11: Merchant Dashboard

**Goal**: Self-service portal for merchants

**Duration**: 2 weeks

**Prerequisites**: Phase 10

#### 11.1 Features

- [ ] Payment history (transfers, gifts, requests)
- [ ] Settlement reports
- [ ] API key management
- [ ] Webhook configuration
- [ ] Settlement account management
- [ ] Analytics & charts

**Deliverable**: Merchant self-service portal

---

## Timeline Summary

| Phase | Duration | Cumulative |
|-------|----------|------------|
| 1. Core Engine ✅ | 2 weeks | 2 weeks |
| 2. Transaction Types | 2 weeks | 4 weeks |
| 3. Persistence | 1 week | 5 weeks |
| 4. Chat Integration | 1.5 weeks | 6.5 weeks |
| 5. Merchant API | 2 weeks | 8.5 weeks |
| 6. Deposit Monitoring | 2 weeks | 10.5 weeks |
| 7. Webhooks | 1 week | 11.5 weeks |
| 8. Settlement Rails | 1.5 weeks | 13 weeks |
| 9. Cashback | 1 week | 14 weeks |
| 10. Admin Dashboard | 2 weeks | 16 weeks |
| 11. Merchant Dashboard | 2 weeks | 18 weeks |

**Total: ~18 weeks (4.5 months) for full platform**

---

## MVP Scope (10 weeks)

For a working product with all transaction types:

1. ✅ Phase 1: Core Engine (2 weeks)
2. ✅ Phase 2: Transaction Types (2 weeks) ← **Gift & Request flows**
3. ✅ Phase 3: Persistence (1 week)
4. ✅ Phase 4: Chat Integration (1.5 weeks)
5. ✅ Phase 5: Merchant API (2 weeks)
6. ✅ Phase 6: Deposit Monitoring (2 weeks)

**MVP in 10 weeks** = All three transaction types working via chat + API, with automated deposit detection.

Settlement (Phase 8) can be triggered manually initially. Webhooks (Phase 7) can be added shortly after.

---

## Success Metrics

| Metric | Description |
|--------|-------------|
| Transfer Success Rate | % of transfers that reach `settled` |
| Gift Claim Rate | % of gifts claimed before expiry |
| Request Fulfillment Rate | % of requests paid before expiry |
| Avg Time to Claim | Time from gift confirmation to claim |
| Avg Time to Pay Request | Time from request creation to payment |
| Wallet Pool Utilization | % of wallets in use at any time |
| Webhook Delivery Rate | % delivered on first attempt |
| Settlement Success Rate | % of settlements completed |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Wallet pool exhaustion | Monitor utilization, scale pool proactively |
| Gift ID guessing | Use crypto-random 12+ char IDs |
| Request spam | Rate limit per user, add captcha |
| Unclaimed gifts | Clear 30-day expiry, notify sender |
| Rate volatility | Short lock windows, margin buffer |
| Blockchain API limits | Multiple providers, caching |

---

## Next Steps

1. Review and approve this plan
2. Begin Phase 2: Transaction Types
3. Implement `createGift()` and `claimGift()`
4. Implement `createRequest()` and `payRequest()`
5. Update state machine for all types
6. Write tests for gift and request flows
