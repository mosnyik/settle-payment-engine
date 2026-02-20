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

#### 2.2 Tasks

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

#### 2.3 Tests

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

---

### Phase 4: Chat Integration

**Goal**: Refactor existing chatbot to use the payment engine

**Duration**: 1.5 weeks

**Prerequisites**: Phase 3

---

### Phase 5: Merchant API

**Goal**: REST API for external clients

**Duration**: 2 weeks

**Prerequisites**: Phase 4

---

### Phase 6: Deposit Monitoring

**Goal**: Automated on-chain deposit detection

**Duration**: 2 weeks

**Prerequisites**: Phase 5

---

### Phase 7: Webhooks

**Goal**: Notify clients of payment events

**Duration**: 1 week

**Prerequisites**: Phase 6

---

### Phase 8: Settlement Rails

**Goal**: Automated fiat payout

**Duration**: 1.5 weeks

**Prerequisites**: Phase 7

---

### Phase 9: Cashback System

**Goal**: Reward users for transactions

**Duration**: 1 week

**Prerequisites**: Phase 8

---

### Phase 10: Admin Dashboard

**Goal**: Internal operations tools

**Duration**: 2 weeks

**Prerequisites**: Phase 9

---

### Phase 11: Merchant Dashboard

**Goal**: Self-service portal for merchants

**Duration**: 2 weeks

**Prerequisites**: Phase 10

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
