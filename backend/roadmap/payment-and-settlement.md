# 2Settle Payment Engine — Payment & Settlement Documentation

---

## Table of Contents

1. [Collection Methods](#1-collection-methods)
2. [Settlement Methods](#2-settlement-methods)
3. [Alternative Providers for Crypto-to-Fiat (Nigeria)](#3-alternative-providers)
4. [Short-Term Strategy](#4-short-term-strategy)
5. [Long-Term Strategy](#5-long-term-strategy)

---

## 1. Collection Methods

### Overview

2Settle collects payments by receiving cryptocurrency from payers into system-controlled deposit wallets. The platform does NOT collect fiat — it only accepts crypto deposits, which are then converted and settled as fiat to the receiver's bank account.

### Supported Cryptocurrencies

Validated in `session-manager.ts` (`VALID_CRYPTO_NETWORKS`):

| Asset | Networks                                     |
| ----- | -------------------------------------------- |
| BTC   | Bitcoin                                      |
| ETH   | Ethereum                                     |
| BNB   | BSC (BEP20)                                  |
| TRX   | Tron                                         |
| USDT  | Ethereum (ERC20), BSC (BEP20), Tron (TRC20)  |


> **Note:** USDC is defined as a `CryptoCurrency` type and has sweeper token contracts configured, but is not yet wired into the system to be collected as valid crypto payment. If a client sends USDC right now, it would be rejected. Pending whenwe enable it.

### Supported Fiat Currencies (Settlement Side)

- **NGN** (Nigerian Naira) — **only currency with working rate support**

> **Note:** GHS, KES, and ZAR are defined as `FiatCurrency` types, but we do not have rate service for them yet, so if we try to make a transaction with any of them, we would get an error, untill they are activated


### Payment Types

| Type                | Description                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `transfer`          | Payer sends crypto, receiver gets fiat in their bank. Requires payer chat ID, receiver bank details, crypto type, and network. |
| `gift`              | Payer sends crypto, receiver claims it later.    |
| `request`           | Receiver creates a payment request specifying fiat amount. Payer fulfills. |
| `merchant`          | Merchant-initiated payment flow for commerce integrations.                                     |
| `bank_confirmation` | Bank's internal reference tracking. Uses `bankRef` field for the bank's own transaction reference. |

### Collection Flow (Step by Step)

#### Step 1: Payment Session Created

- Client calls `POST /payments` with payment type, amounts, crypto/network, and payer/receiver details.
- System verifies receiver bank account via NUBAN API. Sandbox API keys skip real NUBAN verification and use placeholder values.
- Exchange rate is locked for 30 minutes:
  - **Exchange rate:** Fetched from internal `rates` DB table, then a **1% adjustment (reduction)** is applied as platform spread.
  - **Asset price:** Fetched from CoinGecko API, except USDT which is **hardcoded at $1**.
  - Both values are cached for 60 seconds.
- Fees are calculated based on fiat amount tier:

| Fiat Amount Range         | Fee    | Tier Name  |
| ------------------------- | ------ | ---------- |
| ₦1 – ₦100,000            | ₦500   | basic      |
| ₦100,001 – ₦1,000,000    | ₦1,000 | standard   |
| ₦1,000,001 – ₦2,000,000  | ₦1,500 | premium    |

- **Amount limits:** Min ₦1, Max ₦2,000,000.
- Fee can be charged from crypto (payer pays more, default) or deducted from fiat (receiver gets less).
- **Crypto-first mode:** If `cryptoAmount` is provided instead of `fiatAmount`, the system reverse-calculates the fiat amount. Not valid for `request` type.

#### Step 2: Deposit Wallet Assigned

Two wallet assignment strategies:

- **HD Wallet (preferred):** System derives a unique address per chain per session owner (payer). The same payer reuses the same address on subsequent payments on the same chain. Derivation uses BIP39 mnemonic with atomic index increments.

The deposit address and exact crypto amount to send are returned to the client.

#### Step 3: Blockchain Monitoring Begins

Deposit watcher starts polling the blockchain. Sandbox sessions skip the real watcher.

| Chain    | Adapter API              | Default Interval | Current .env Override |
| -------- | ------------------------ | ---------------- | --------------------- |
| Bitcoin  | Blockstream Esplora      | 60s              | 60s                   |
| Ethereum | Etherscan V2 API         | 15s              | 30s                   |
| BSC      | Etherscan V2 API (shared)| 5s               | 30s                   |
| Tron     | TronGrid                 | 5s               | 30s                   |

#### Step 4: Deposit Detected

- Transaction found matching the expected amount (within 20% tolerance).
- Session status moves to `confirming`.
- Transaction hash recorded.

#### Step 5: Deposit Confirmed

Required on-chain confirmations:

| Chain    | Confirmations Required |
| -------- | ---------------------- |
| Bitcoin  | 2                      |
| Ethereum | 12                     |
| BSC      | 15                     |
| Tron     | 19                     |


Session status moves to `confirmed`. Settlement process is triggered automatically.

#### Step 6: Fund Sweeping

After confirmation, crypto is swept from the derived deposit address to the parent hot wallet:

- **EVM chains:** Calculate balance → estimate gas → deduct fees → send remainder. EIP-1559 support.
- **EVM tokens (USDT/USDC):** Pre-fund derived address with native coin for gas, then call token contract `transfer()`.
- **Bitcoin:** Fetch UTXOs via Blockstream → build SegWit transaction → dynamic fee estimation → broadcast.
- **Tron:** Native TRX + TRC20 sweeping via TronWeb.

Minimum sweep thresholds:

| Asset     | Minimum |
| --------- | ------- |
| BTC       | 0.0001  |
| ETH       | 0.001   |
| BNB       | 0.01    |
| TRX       | 10      |
| USDT/USDC | 1       |

### Auto-Settle Mode

The `POST /payments` endpoint supports an `autoSettle` flag:
- **Sandbox:** Simulates the full lifecycle (fake tx hash → confirming → confirmed → settled).
- **Live:** Directly records the payment as settled with `settlement_provider='manual'`. Used to record manual/external transfers that have already been settled outside the system.

### Session Lifecycle

```
created → pending (request type, after fulfillment) → confirming → confirmed → settling → settled

Valid transitions per state:
  created    → pending, expired, failed
  pending    → confirming, expired, failed
  confirming → confirmed, failed
  confirmed  → settling, failed
  settling   → settled, failed, settlement_reversed
  settled    → (terminal)
  expired    → (terminal)
  failed     → (terminal)
  settlement_reversed → (terminal)
```

### Webhooks Sent to Integrators

Events fired at each state transition:

- `payment.created`
- `payment.confirming`
- `payment.confirmed`
- `payment.settling`
- `payment.settled`
- `payment.expired`
- `payment.failed`
- `payment.settlement_reversed`

Authenticated via HMAC-SHA256 signature in `X-Webhook-Signature` header for secure webhook communication to avoid transaction replay.

---

## 2. Settlement Methods

### Overview

Once a crypto deposit is confirmed on-chain, the platform initiates a fiat bank transfer to the receiver's Nigerian bank account. This is the "settlement."

### Settlement Modes

The system supports two settlement modes, configured per API key. The mode is fetched from the API key's `settlementMode` field and **defaults to `'mongoro'`** if unset right now.

#### Mode 1: Mongoro (Automatic — Default)


1. Session status updated to `settling`.
2. Settlement attempt record created in `settlement_attempts` table.
3. Direct API call to Mongoro transfer endpoint with receiver bank details, amount, and narration.
4. If Mongoro returns success with a reference → session records the reference and waits for webhook.
5. If Mongoro call fails → system triggers Telegram alert.
6. Mongoro webhook (IP-whitelisted) confirms success, failure, or reversal.

> **Current state:** Mongoro is not configured for live use, so payments route to manual settlement by default.

#### Mode 2: Self-Settlement (Integrator-Handled)

1. System generates a one-time settlement token (32-byte hex, 24-hour expiry).
2. Token stored in in the db as `settlement_token`.
3. Token sent to integrator via `payment.settling` webhook.
4. Integrator handles actual bank transfer using their own systems.
5. Integrator confirms completion: `POST /payments/:reference/settle` with the token.
6. Token is consumed (one-time use), verified via by system.

### Fallback Mechanism

If Mongoro settlement fails:

```
1. Mongoro API call fails
   ↓
2. Telegram alert sent to admins team on telegram
   ↓
3. Session stays in "settling" status (not marked failed immediately)
   ↓
4. Admin resolves via:
   - Telegram bot inline button ("Settlement completed")
   - Admin API: POST /admin/sessions/:reference/settle
   ↓
5. If Telegram also fails → payment marked as "failed"
```

### Settlement Providers Summary

| Provider        | Type                     | Status on `master`          |
| --------------- | ------------------------ | --------------------------- |
| Mongoro         | Automatic bank transfer  | **Code ready, but not configured**  |
| Manual/Telegram | Human-operated           | **Active**                  |
| Self-Settlement | Integrator-controlled    | **Active**                  |


### Settlement Tracking

All settlement attempts are logged in the `settlement_attempts` table:
- Provider, reference, status, amount, account details, error messages.
- Supports audit trail for multi-attempt scenarios.

---

## 3. Alternative Providers

### Current Providers in Use

| Provider   | Role                  | Status on `master`          |
| ---------- | --------------------- | --------------------------- |
| **Mongoro** | Sole automatic payout | Code ready, **not configured** |


This means **there is currently no live automatic settlement provider configured.** Settlement will either fail (triggering Telegram fallback) or must use self-settlement mode.

### Alternative Providers Worth Considering

#### A. Direct Bank Transfer APIs

| Provider | Description |
| -------- | ----------- |
| **Monnify (Moniepoint)** | Moniepoint's payment gateway. Supports NGN bank transfers, reserved accounts, and disbursements. High reliability, widely used in Nigeria. Strong API docs. |
| **Flutterwave** | Supports Nigerian bank transfers, mobile money, and international payouts. Well-documented API. Strong alternative. |
| **Korapay** | Nigerian fintech focused on payments infrastructure. Supports bank transfers, competitive fees. |
| **Bloc (getbloc.co)** | Banking-as-a-service. Offers direct bank transfers, virtual accounts, and card issuance. |
| **Fincra** | Pan-African payment infrastructure. Supports NGN payouts, collections, and cross-border transfers. |
| **Budpay** | Nigerian payment gateway with transfer/payout capabilities. API-first approach. |
| **Busha** | SEC-licensed Nigerian crypto infrastructure platform. API supports crypto-to-fiat conversion and direct NGN bank transfer payouts in one step. Also covers KES, GHS, UGX, TZS, XOF, RWF. |


#### B. Crypto-Specific Off-Ramp Providers

| Provider | Description |
| -------- | ----------- |
| **Coinprofile** | Nigerian crypto-to-fiat off-ramp. Converts crypto to NGN and pays to bank accounts. Handles conversion + payout in one step. |
| **Transak** | Global on/off-ramp with NGN support. Send crypto, they send fiat to the receiver. |
| **MoonPay** | Global on/off-ramp with NGN support. Similar to Transak. |
| **Onramp.money** | Off-ramp provider with varying Africa coverage. |

#### C. OTC Desk / P2P / Exchange Approaches

| Provider | Description |
| -------- | ----------- |
| **Binance P2P / OTC** | Sell crypto OTC on Binance, receive NGN in bank. Manual or semi-automated. Good for larger volumes. |
| **Quidax** | Nigerian crypto exchange with API. Sell crypto and withdraw NGN. OTC desk for larger volumes. |
| **Luno** | Crypto exchange with NGN support. API available for automated sell + withdraw. |
| **Yellow Card** | African crypto exchange. Supports NGN off-ramp with API access. |
| **Roqqu** | Nigerian exchange with API capabilities. |

#### D. Stablecoin-Specific Rails

| Provider | Description |
| -------- | ----------- |
| **Circle (USDC)** | Circle's payment rails for USDC conversion. Direct NGN support may be limited. |
| **Tether (USDT)** | Direct redemption requires significant volume. More practical to sell on local exchanges. |

### Provider Comparison Matrix

| Provider      | Type             | Speed       | Reliability  | Volume Limit | API Quality | KYC Burden |
| ------------- | ---------------- | ----------- | ------------ | ------------ | ----------- | ---------- |
| Mongoro       | Bank Transfer    | Fast        | Medium       | Medium       | Basic       | Low        |
| Monnify       | Bank Transfer    | Fast        | High         | High         | Good        | Low        |
| Flutterwave   | Bank Transfer    | Fast        | High         | High         | Good        | Low        |
| Korapay       | Bank Transfer    | Fast        | Medium-High  | Medium       | Good        | Low        |
| Paystack      | Bank Transfer    | Fast (<5min)| High         | High         | Excellent   | Low        |
| Quidax        | Exchange+Withdraw| 10-30min    | Medium       | Medium       | Basic       | Medium     |
| Transak       | Full Off-Ramp    | 10-60min    | Medium       | Medium       | Good        | High       |
| Binance OTC   | OTC Desk         | Varies      | High         | Very High    | N/A (manual)| High       |
| Yellow Card   | Exchange         | 10-30min    | Medium       | Medium       | Basic       | Medium     |
| Busha         | Crypto Off-Ramp + Bank Transfer | Fast   | Medium-High  | Medium       | Good        | Low        |

---

## 4. Short-Term Strategy

### Current Architecture Assessment

```
Crypto Deposit → HD Wallet → Blockchain Monitor → Confirm → Sweep to Hot Wallet → Fiat Payout (Mongoro) → Bank Account
```

This flow is architecturally sound, but the current deployment has critical gaps:
- **Mongoro is the only settlement provider and it's not configured** (credentials commented out)
- Paystack was fully removed — no backup provider exists
- Bitcoin and Ethereum hot wallet addresses are placeholders
- Only NGN rates work
- USDC is type-defined but not routable
- No automatic failover — if Mongoro fails, it's Telegram alert → manual

### 4.1. Get a Settlement Provider Live

**Problem:** There is currently **no configured settlement provider**. No automatic payouts can happen.

**Solution (pick one or both):**
Integrate a new provider (Flutterwave, Korapay). This time route the payment through a proxy infra

### 4.2. Multi-Provider Settlement with Failover

**Problem:** With only one provider, any downtime means all settlements stall.

**Solution:** Implement at least two providers with automatic failover:

```
Settlement Request
  → Try (primary provider)
    → If API error:
      → Try (secondary provider)
        → If secondary fails:
          → Telegram alert for manual settlement
```

This requires:
- Modifying payout to try a secondary provider on failure instead of going straight to manual payout
- Provider health checks
- Configurable priority ordering per API key

### 4.3. Pre-Fund Settlement Provider

**Problem:** Bank transfer providers (Mongoro, Paystack, Flutterwave) require pre-funded balances.

**Solution:**
- Set up balance monitoring with Telegram alerts at configurable thresholds.
- Implement a cron job for periodic balance checks.
- Start showing real-time provider balance vs. pending settlements on the admin dashboard.
- Pre-fund based on projected daily settlement volume.

### 4.4. Optimize Stablecoin Focus

**Problem:** Volatile crypto (BTC, ETH) creates rate risk during the 30-minute session window. Also, USDC is defined but not routable.

**Solution:**
- Encourage USDT/USDC payments (minimal price volatility — USDT is already hardcoded at $1).
- For volatile assets, consider shorter session TTLs or dynamic rate adjustments.
- The 1% spread may not be sufficient for volatile assets — consider a per-asset buffer.

### 4.5. Reduce TRC20 Sweep Costs with Energy Rental

**Problem:** Every TRC20 (USDT) sweep burns TRX for energy. The system pre-funds 10 TRX to each derived address (`prefundTronGas()`), which is permanently consumed. At scale, this adds up — 10 sweeps/day burns 50–100 TRX/day (~$15–$30) gone forever.

**Solution:** Integrate a Tron energy rental service (e.g., TronSave, TronEnergy) before each TRC20 sweep:
- Before sweeping, call the rental API to provision ~65,000 energy to the derived address.
- The derived address can then execute the TRC20 `transfer()` without burning TRX for energy.
- Cost is ~30–60% cheaper than burning TRX directly, with no upfront capital lock-up.
- Replaces the current `prefundTronGas()` flow for Tron token sweeps.

**Break-even:** Immediately cheaper than the current approach at any volume.

### 4.6. Improve Sweep Reliability

**Problem:** Failed sweeps can leave funds stranded in derived addresses.

**Solution:**
- The retry mechanism exists (max 3 retries). Increase monitoring.
- Add Telegram alerts for failed sweeps after max retries.
- Build an admin dashboard for sweep status monitoring.
- Consider batch sweeping during low-gas periods for EVM chains.

### 4.7. Settlement SLA Tracking

**Problem:** No formal tracking of settlement timing.

**Solution:**
- Add metrics: time from `confirmed` → `settled`.
- Alert on settlements taking longer than threshold (e.g., >15 minutes).
- Track provider-specific performance.

### 4.8. Redundant Blockchain Monitoring

**Problem:** Single adapter per chain. If Etherscan is down, Ethereum deposits are missed.

**Solution:**
- Add fallback RPC-based monitoring (query node directly).
- Or add secondary explorer APIs (e.g., Blockscout for Ethereum, Tronscan for Tron).

### 4.9. Immediate Configuration Action Items

Before going live:

1. **Configure Mongoro** — uncomment and fill in credentials in `.env`, or integrate an alternative provider.
2. **Set real hot wallet addresses** — Bitcoin and Ethereum hot wallets are placeholders. Tron appears to be set.
3. **Add USDC to `VALID_CRYPTO_NETWORKS`** in `session-manager.ts` if USDC payments should be supported.
4. **Tune polling intervals** — decide whether 30s for ETH/BSC/Tron is acceptable or if faster detection is needed.
5. **Secure the `.env`** — move secrets to a secrets manager for production.

---

## 5. Long-Term Strategy

### 5.1. Build a Liquidity Engine

**Current state:** The system sweeps crypto to a hot wallet but relies on a pre-funded Mongoro balance for fiat payouts. Crypto comes in, but fiat needs to already be there.

**Long-term solution:** Build or integrate a liquidity engine that:
- Automatically sells received crypto on exchanges (Binance, Quidax, etc.) for NGN.
- Manages order books and slippage for larger amounts.
- Maintains a fiat float that's replenished from crypto sales.
- Tracks P&L on the spread between buy rate (given to customer) and sell rate (on exchange).

```
Crypto In (HD Wallet)
  → Sweep to Hot Wallet
    → Transfer to Exchange
      → Sell Order (limit/market)
        → NGN in Exchange Account
          → Withdraw to Mongoro/Bank
```

### 5.2. Direct Bank Integration (Bypassing Mongoro)

**Why:** Every intermediary adds cost, latency, and a point of failure.

**Options:**
- Partner with a bank directly (e.g., Providus, Wema/ALAT) for direct NIP transfers.
- Use a BaaS provider like Bloc or Anchor for direct bank connectivity.
- Apply for a Payment Service Provider (PSP) license to operate your own settlement rail.

**Benefits:** Lower fees, faster settlement, no balance pre-funding, no third-party downtime dependency.

### 5.3. Multi-Currency Settlement Expansion

**Current:** NGN only.

**Future:**
- GHS settlement via local providers (Hubtel, Zeepay, MTN MoMo API).
- KES settlement via M-Pesa API or local banks.
- ZAR settlement via local payment providers.
- USD/GBP settlement for international corridors.

### 5.4. On-Chain Settlement (Stablecoin Payouts)

Instead of converting crypto to fiat, offer stablecoin payouts:
- Receiver gets USDT/USDC directly to their wallet.
- Eliminates fiat settlement entirely for crypto-native receivers.
- Useful for B2B payments, freelancer payments, cross-border transfers.
- Lower fees, instant settlement.

### 5.5. TRX Energy Staking for Zero-Cost TRC20 Sweeps

**Current state:** TRC20 sweeps either burn TRX (current) or rent energy from third-party services (short-term fix). Both have per-transaction costs.

**Long-term solution:** Stake a large TRX position on the hot wallet (or a dedicated staking address) and use `delegateResource()` to lend energy to derived addresses before each sweep:
- Stake TRX once — the capital stays yours and can be unstaked anytime.
- Before each TRC20 sweep, delegate energy from the staked address to the derived address.
- The derived address executes the TRC20 `transfer()` with zero TRX burn — energy is "free."
- Energy regenerates on the staked address over 24 hours.
- Eliminates both the `prefundTronGas()` flow and third-party energy rental dependency.

**Staking requirements (post-Proposal #104):**

| Daily TRC20 sweeps | TRX to stake | Capital required (~$0.27/TRX) |
|---------------------|-------------|-------------------------------|
| 1/day | ~5,000–7,000 | ~$1,350–$1,890 |
| 10/day | ~50,000–70,000 | ~$13,500–$18,900 |
| 100/day | ~500,000–700,000 | ~$135,000–$189,000 |

**Break-even vs energy rental:** At ~5+ sweeps/day, staking becomes cheaper than rental within a few weeks. The capital is not consumed — only locked.

### 5.6. Smart Contract Escrow

Replace centralized session management with smart contract escrow:
- Payer deposits to escrow contract.
- Contract holds funds until conditions are met (e.g., settlement confirmation).
- Automatic release or refund based on time locks.
- Trustless, transparent, auditable.

### 5.7. Provider Aggregator Model

Build an aggregation layer across multiple off-ramp providers:
- Route settlements to the cheapest/fastest provider dynamically.
- Load balance across providers to avoid single-provider limits.
- A/B test new providers with small percentages of traffic.
- Score providers on reliability, speed, and cost.

### 5.8. Compliance & Licensing

For long-term viability in Nigeria:
- Obtain relevant licenses (PSP, PSSP, or partner with licensed entity).
- Implement full AML/KYC pipeline for larger transaction volumes.
- Transaction monitoring and suspicious activity reporting.
- Work with regulators proactively — crypto regulation is evolving in Nigeria.

### 5.9. Treasury Management System

Build a proper treasury management layer:
- Real-time visibility into crypto holdings across all wallets (hot, cold, derived).
- Fiat balance tracking across all provider accounts.
- Automated rebalancing between providers.
- Risk management: exposure limits per crypto asset, hedging for volatile assets.
- Accounting integration: automated reconciliation of crypto in vs. fiat out.

### 5.10. Event-Driven Architecture

Migrate from polling-based blockchain monitoring to event-driven:
- Use WebSocket subscriptions for real-time transaction detection.
- Implement event sourcing for payment state management.
- Use message queues (Redis Streams, RabbitMQ) for reliable settlement processing.
- Enables horizontal scaling and better fault tolerance.

### 5.11. Redundancy and High Availability

- Multi-region deployment for the payment engine.
- Database replication with automatic failover.
- Circuit breakers for all external API calls.
- Chaos testing for provider outages.
- 99.9% uptime SLA for the payment processing pipeline.

---

## Summary

| Area       | Current State on `master`                         | Short-Term Priority                              | Long-Term Vision                                  |
| ---------- | ------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| Collection | Crypto deposit to HD wallets, blockchain polling   | Add fallback explorers, enable USDC               | Event-driven monitoring, smart contract escrow    |
| Settlement | Mongoro only (**not configured**), manual fallback | Get Mongoro live OR add new provider, add failover | Direct bank integration, liquidity engine         |
| Providers  | Mongoro (unconfigured), Paystack removed           | Configure Mongoro + add backup (Flutterwave/etc) | Aggregator model across 5+ providers              |
| Rates      | CoinMarketCap + internal DB (NGN only, 1% spread) | Better volatility protection, enable multi-currency| Real-time market making, exchange integration     |
| Sweep Costs| TRX burned per TRC20 sweep (10 TRX pre-fund)      | Energy rental to cut TRC20 sweep costs 30–60%     | TRX energy staking for zero-cost TRC20 sweeps     |
| Operations | Telegram alerts, basic admin API                   | SLA tracking, sweep monitoring dashboard          | Full treasury management system                   |
| Compliance | Basic                                              | Transaction limits, basic monitoring              | Full AML/KYC, licensing                           |
