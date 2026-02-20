# Payment Engine Architecture

This document provides detailed diagrams of the payment engine's architecture and flows for all three transaction types: Transfer, Gift, and Request.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Component Diagram](#component-diagram)
3. [Transaction Type Flows](#transaction-type-flows)
   - [Transfer Flow](#transfer-flow)
   - [Gift Flow (Create + Claim)](#gift-flow)
   - [Request Flow (Create + Pay)](#request-flow)
4. [Session State Machine](#session-state-machine)
5. [Wallet Pool Flow](#wallet-pool-flow)
6. [Rate Locking Flow](#rate-locking-flow)
7. [Database Schema](#database-schema)
8. [Integration Points](#integration-points)

---

## System Architecture

### High-Level Overview

```
                                    ┌─────────────────────────────────────┐
                                    │           CLIENTS                    │
                                    └─────────────────────────────────────┘
                                                    │
                    ┌───────────────────────────────┼───────────────────────────────┐
                    │                               │                               │
                    ▼                               ▼                               ▼
        ┌───────────────────┐           ┌───────────────────┐           ┌───────────────────┐
        │   2Settle Chat    │           │   Merchant API    │           │  Bank/Fintech     │
        │                   │           │                   │           │   Integration     │
        │  • Chatbot UI     │           │  • REST API       │           │                   │
        │  • User wallet    │           │  • Hosted checkout│           │  • Bulk payments  │
        │  • Step machine   │           │  • JS SDK         │           │  • White-label    │
        └─────────┬─────────┘           └─────────┬─────────┘           └─────────┬─────────┘
                  │                               │                               │
                  └───────────────────────────────┼───────────────────────────────┘
                                                  │
                                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                              │
│                              PAYMENT ENGINE CORE                                             │
│                                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              PaymentEngine (Facade)                                    │  │
│  │                                                                                        │  │
│  │   TRANSFER          GIFT                      REQUEST                                  │  │
│  │   ─────────         ────────────────          ───────────────────                      │  │
│  │   createPayment()   createGift()              createRequest()                          │  │
│  │                     claimGift()               payRequest()                             │  │
│  │                                                                                        │  │
│  │   COMMON: recordDeposit() │ confirmPayment() │ settlePayment() │ getSession()         │  │
│  └──────────────────────────────────────────────────────────────────────────────────────┘  │
│                                          │                                                  │
│          ┌───────────────────────────────┼───────────────────────────────┐                 │
│          │                               │                               │                 │
│          ▼                               ▼                               ▼                 │
│  ┌───────────────┐               ┌───────────────┐               ┌───────────────┐        │
│  │    Session    │               │    Wallet     │               │     Rate      │        │
│  │    Manager    │◄─────────────▶│     Pool      │               │    Service    │        │
│  │               │               │               │               │               │        │
│  │ • Create      │               │ • Assign      │               │ • Fetch       │        │
│  │ • Update      │               │ • Release     │               │ • Lock        │        │
│  │ • Validate    │               │ • Status      │               │ • Cache       │        │
│  │ • Claim/Pay   │               │ • Expiry      │               │ • Convert     │        │
│  └───────┬───────┘               └───────────────┘               └───────────────┘        │
│          │                                                               │                 │
│          │                       ┌───────────────┐                       │                 │
│          │                       │    Charge     │◄──────────────────────┘                 │
│          │                       │   Calculator  │                                         │
│          │                       │               │                                         │
│          │                       │ • Tiered fees │                                         │
│          │                       │ • Conversion  │                                         │
│          │                       └───────────────┘                                         │
│          │                                                                                 │
│          │                       ┌───────────────┐                                         │
│          └──────────────────────▶│     Utils     │                                         │
│                                  │               │                                         │
│                                  │ • ID Gen      │                                         │
│                                  │ • Validation  │                                         │
│                                  └───────────────┘                                         │
│                                                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                      DATA LAYER                                              │
│                                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   payment_   │  │   wallets    │  │    rates     │  │    payers    │  │  receivers   │  │
│  │   sessions   │  │              │  │              │  │              │  │              │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Diagram

### Module Dependencies

```
┌─────────────────────────────────────────────────────────────────┐
│                         index.ts                                 │
│                    (Public Exports)                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     payment-engine.ts                            │
│                    (Facade Pattern)                              │
│                                                                  │
│   TRANSFER:                                                      │
│   • createPayment(input)                                         │
│                                                                  │
│   GIFT:                                                          │
│   • createGift(input)      → Returns giftId, depositAddress      │
│   • claimGift(giftId, receiver) → Triggers settlement            │
│                                                                  │
│   REQUEST:                                                       │
│   • createRequest(input)   → Returns requestId                   │
│   • payRequest(requestId, payer, crypto) → Returns depositAddr   │
│                                                                  │
│   COMMON:                                                        │
│   • getSession(id)                                               │
│   • recordDeposit(id, txHash, amount)                            │
│   • confirmPayment(id)                                           │
│   • settlePayment(id)                                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ session/        │ │ wallet/         │ │ rate/           │
│                 │ │                 │ │                 │
│ session-manager │ │ wallet-pool.ts  │ │ rate-service.ts │
│ session-repo    │ │                 │ │                 │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ charges/        │ │ utils/          │ │ errors.ts       │
│                 │ │                 │ │                 │
│ charge-calc.ts  │ │ id-generator.ts │ │ Custom errors   │
└─────────────────┘ └─────────────────┘ └─────────────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │    types.ts     │
                    │                 │
                    │ All interfaces  │
                    └─────────────────┘
```

---

## Transaction Type Flows

### Transfer Flow

**Description**: User initiates payment, provides bank details upfront, pays crypto, recipient receives fiat.

**Participants**:
- **Payer**: Known at creation (provides crypto)
- **Receiver**: Known at creation (provides bank details)

**Status Flow**: `created → pending → confirming → confirmed → settling → settled`

---

### Gift Flow

**Description**: Two-phase transaction. Sender creates gift and pays crypto. Recipient claims gift later by providing bank details.

**Participants**:
- **Sender (Payer)**: Known at creation (provides crypto)
- **Receiver**: Unknown at creation, known at claim (provides bank details)

**Status Flow**: `created → pending → confirming → confirmed → pending_claim → settling → settled`

---

### Request Flow

**Description**: Two-phase transaction. User creates a payment request specifying fiat amount and bank details. Payer later fulfills the request by paying crypto.

**Participants**:
- **Requester (Receiver)**: Known at creation (provides bank details, specifies amount)
- **Payer**: Unknown at creation, known when paying

**Status Flow**: `created → pending_payment → pending → confirming → confirmed → settling → settled`

---

## Session State Machine

### Transition Table by Type

| Type | From | To | Trigger | Actions |
|------|------|----|---------|---------|
| ALL | - | `created` | `createSession()` | Generate ID |
| **Transfer** | `created` | `pending` | `createPayment()` | Lock rate, calc charges, assign wallet |
| **Gift** | `created` | `pending` | `createGift()` | Lock rate, calc charges, assign wallet |
| **Request** | `created` | `pending_payment` | `createRequest()` | Validate receiver bank, NO wallet yet |
| **Request** | `pending_payment` | `pending` | `payRequest()` | Lock rate, calc charges, assign wallet |
| ALL | `pending` | `confirming` | Deposit detected | Record tx hash |
| ALL | `pending` | `expired` | Timeout | Release wallet |
| ALL | `confirming` | `confirmed` | Confirmations met | Release wallet |
| **Transfer/Request** | `confirmed` | `settling` | Auto-trigger | Initiate fiat payout |
| **Gift** | `confirmed` | `pending_claim` | Auto-trigger | Wait for claim |
| **Gift** | `pending_claim` | `settling` | `claimGift()` | Add receiver, initiate payout |
| **Gift** | `pending_claim` | `expired` | Timeout (30 days) | Mark expired |
| ALL | `settling` | `settled` | Payout confirmed | Complete |
| ALL | `settling` | `failed` | Payout error | Log error |

---

## Wallet Pool Flow

### When Wallet is Assigned (by Transaction Type)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        WALLET ASSIGNMENT TIMING                              │
│                                                                              │
│   TRANSFER:                                                                  │
│   ┌──────────────┐                                                           │
│   │ createPayment│──▶ Wallet assigned IMMEDIATELY                           │
│   └──────────────┘    (payer and receiver both known)                        │
│                                                                              │
│   GIFT:                                                                      │
│   ┌──────────────┐                                                           │
│   │  createGift  │──▶ Wallet assigned IMMEDIATELY                           │
│   └──────────────┘    (sender pays now, receiver claims later)              │
│                                                                              │
│   REQUEST:                                                                   │
│   ┌──────────────┐                                                           │
│   │createRequest │──▶ NO wallet assigned                                     │
│   └──────────────┘    (just creates the request, stores receiver info)       │
│          │                                                                   │
│          │ (later, when payer calls payRequest)                              │
│          ▼                                                                   │
│   ┌──────────────┐                                                           │
│   │  payRequest  │──▶ Wallet assigned NOW                                    │
│   └──────────────┘    (rate locked, crypto amount calculated)               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Wallet Release Timing

| Transaction Type | When Wallet is Released |
|------------------|------------------------|
| **Transfer** | After crypto deposit is confirmed (`confirmed` status) |
| **Gift** | After crypto deposit is confirmed (before `pending_claim`) |
| **Request** | After crypto deposit is confirmed (`confirmed` status) |
| **Expired** | When session expires without deposit |

---

## Rate Locking Flow

### When Rate is Locked (by Transaction Type)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          RATE LOCKING TIMING                                 │
│                                                                              │
│   TRANSFER:                                                                  │
│   ┌──────────────┐                                                           │
│   │ createPayment│──▶ Rate locked IMMEDIATELY                               │
│   └──────────────┘    (fiat amount known, crypto calculated)                 │
│                                                                              │
│   GIFT:                                                                      │
│   ┌──────────────┐                                                           │
│   │  createGift  │──▶ Rate locked IMMEDIATELY                               │
│   └──────────────┘    (fiat amount known, crypto calculated)                 │
│                                                                              │
│   REQUEST:                                                                   │
│   ┌──────────────┐                                                           │
│   │createRequest │──▶ NO rate locked                                         │
│   └──────────────┘    (fiat amount stored, but no crypto yet)                │
│          │                                                                   │
│          │ (later, when payer calls payRequest with crypto choice)          │
│          ▼                                                                   │
│   ┌──────────────┐                                                           │
│   │  payRequest  │──▶ Rate locked NOW                                        │
│   └──────────────┘    (crypto/network chosen, rate locked, amount calc'd)   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Key Schema Differences by Type

| Field | Transfer | Gift | Request |
|-------|----------|------|---------|
| `payer_id` | Set at creation | Set at creation | Set at `payRequest()` |
| `receiver_id` | Set at creation | Set at `claimGift()` | Set at creation |
| `wallet_id` | Set at creation | Set at creation | Set at `payRequest()` |
| `exchange_rate` | Locked at creation | Locked at creation | Locked at `payRequest()` |
| `crypto_amount` | Calculated at creation | Calculated at creation | Calculated at `payRequest()` |
| `gift_id` | NULL | Generated | NULL |
| `request_id` | NULL | NULL | Generated |
| `gift_claim_expires_at` | NULL | Set (30 days) | NULL |

---

## Integration Points

### How Different Clients Use the Engine

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        2SETTLE CHAT (Existing)                       │    │
│  │                                                                      │    │
│  │   TRANSFER:                                                          │    │
│  │   User ──▶ Chatbot ──▶ Handler ──▶ PaymentEngine.createPayment()    │    │
│  │                                                                      │    │
│  │   GIFT:                                                              │    │
│  │   Sender ──▶ Chatbot ──▶ Handler ──▶ PaymentEngine.createGift()     │    │
│  │   Recipient ──▶ Chatbot ──▶ Handler ──▶ PaymentEngine.claimGift()   │    │
│  │                                                                      │    │
│  │   REQUEST:                                                           │    │
│  │   Requester ──▶ Chatbot ──▶ Handler ──▶ PaymentEngine.createRequest()│   │
│  │   Payer ──▶ Chatbot ──▶ Handler ──▶ PaymentEngine.payRequest()      │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        MERCHANT API (New)                            │    │
│  │                                                                      │    │
│  │   Merchant ──▶ POST /api/v1/payments ──▶ PaymentEngine.create()     │    │
│  │                                                                      │    │
│  │   Features:                                                          │    │
│  │   • REST API with API keys                                           │    │
│  │   • Hosted checkout page                                             │    │
│  │   • Webhook notifications                                            │    │
│  │   • JS SDK for inline integration                                    │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     BANK/FINTECH INTEGRATION (Future)                │    │
│  │                                                                      │    │
│  │   Bank System ──▶ Bulk API ──▶ PaymentEngine.createBatch()          │    │
│  │                                                                      │    │
│  │   Features:                                                          │    │
│  │   • White-label checkout                                             │    │
│  │   • Bulk payment processing                                          │    │
│  │   • Custom settlement schedules                                      │    │
│  │   • Dedicated support                                                │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```
