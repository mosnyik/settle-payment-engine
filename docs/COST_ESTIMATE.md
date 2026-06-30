# Platform Transaction Cost Estimate

> Estimated at **10,000 transactions/month** across all supported assets.
> Prices sourced June 30, 2026. Gas prices use average-conditions scenario.

---

## Price Assumptions

| Variable | Value |
|---|---|
| BTC | $58,937 |
| ETH | $1,571 |
| BNB | $547 |
| TRX | $0.32 |
| USDT / USDC | $1.00 |
| ETH gas (avg) | 5 gwei |
| BSC gas (avg) | 1 gwei |
| BTC fee rate (avg) | 8 sat/vbyte |
| TRX energy rental | 3 TRX / transaction (65k energy, ~1hr) |
| Avg session watcher active time | 30 minutes |
| Avg concurrent sessions | 7 |
| Etherscan plan | Lite — $49/month |

---

## Transaction Lifecycle: Where Costs Occur

Every transaction passes through five stages. Not every stage has an on-chain or API cost.

```
Session Creation → Address Derivation → Deposit Watching → Fund Sweeping → Settlement
     (rate API)        (free, local)        (block APIs)      (on-chain gas)   (Mongoro)
```

### Stage 1 — Session Creation (Rate Fetch)

| Asset | External API Call |
|---|---|
| BTC, ETH, BNB, TRX, USDC | 1 CoinMarketCap call (cached 60s, free tier) |
| USDT (all networks) | None — hardcoded at $1.00 |

No on-chain cost. CoinMarketCap free tier (10,000 calls/month) covers this at current volume.

### Stage 2 — HD Wallet Derivation

Zero cost. Derivation is local math — no API calls, no on-chain transactions.

### Stage 3 — Deposit Watcher (API cost)

| Chain | API | Poll Interval | Calls/Poll | Confirmations |
|---|---|---|---|---|
| Bitcoin | Blockstream (free, no key) | 60s | ~2 | 2 blocks |
| Ethereum | Etherscan V2 | 15s | ~3–5 | 12 blocks |
| BSC | Etherscan V2 (chainId=56, shared quota) | 5s | ~3–5 | 15 blocks |
| Tron | TronGrid (API key) | 5s | ~2–5 | 19 blocks |

**ETH and BSC share the same Etherscan API key and daily quota.**
BSC's 5s polling burns quota ~4× faster than ETH. At 7 concurrent BSC sessions the $49
Lite plan (200k calls/day) can be approached during peak hours. If this becomes an issue,
increasing BSC poll interval in `config/index.ts` from 5s → 15s brings daily usage to
~161k/day and keeps it within the cap.

### Stage 4 — Fund Sweeping (On-Chain Cost — Real Money)

This is the primary platform cost. See per-asset breakdown below.

### Stage 5 — Settlement (Mongoro)

One HTTP POST to Mongoro per settled session. Mongoro deducts their own transfer fee
internally. The fee is returned in `response.data.fee` but is currently not logged or tracked
against P&L — this is a blind spot in accounting.

---

## Per-Asset Cost Breakdown

### Bitcoin (BTC)

**Sweep mechanics:** 1 on-chain transaction. Fee is deducted from received BTC (no pre-fund needed).

| Component | Calculation | Cost |
|---|---|---|
| Sweep tx (1 UTXO, 110 vbytes) | 880 sat × ($58,937 / 100,000,000) | $0.519 |
| Blockstream API | Free | $0.000 |
| Etherscan API share | N/A | $0.000 |
| **Total per transaction** | | **$0.519** |
| **10,000 transactions** | | **$5,190** |

Minimum sweep threshold: **0.0001 BTC**. Gate: amount must be ≥ 2× fee.

---

### Ethereum (ETH)

**Sweep mechanics:** 1 on-chain transaction. Gas deducted from received ETH balance.

| Component | Calculation | Cost |
|---|---|---|
| Sweep tx (23,100 gas × 5 gwei) | 0.0001155 ETH × $1,571 | $0.181 |
| Etherscan API ($49 / 10,000 txns) | | $0.005 |
| **Total per transaction** | | **$0.186** |
| **10,000 transactions** | | **$1,860** |

Minimum sweep threshold: **0.001 ETH**. Gate: amount ≥ 2× gas cost.

---

### BNB Smart Chain (BNB)

**Sweep mechanics:** 1 on-chain transaction. Gas deducted from received BNB balance.

| Component | Calculation | Cost |
|---|---|---|
| Sweep tx (23,100 gas × 1 gwei) | 0.0000231 BNB × $547 | $0.013 |
| Etherscan API ($49 / 10,000 txns) | | $0.005 |
| **Total per transaction** | | **$0.018** |
| **10,000 transactions** | | **$180** |

Minimum sweep threshold: **0.01 BNB**.

> BNB is the cheapest asset to process at this volume. On-chain fee is negligible — the
> Etherscan subscription is the dominant cost.

---

### Tron (TRX)

**Sweep mechanics:** 1 on-chain transaction. 1 TRX is permanently reserved in each child
address for bandwidth. This is not a fee — it is stranded, unrecoverable capital per session.

| Component | Calculation | Cost |
|---|---|---|
| 1 TRX stranded in child address | 1 TRX × $0.32 | $0.320 |
| Bandwidth fee (if no frozen bandwidth) | ~0.267 TRX × $0.32 | ~$0.085 |
| TronGrid API | Free tier | $0.000 |
| **Total per transaction (est.)** | | **~$0.32–$0.40** |
| **10,000 transactions** | | **~$3,200–$4,000** |

Minimum sweep threshold: **10 TRX**.

> The 1 TRX reserve accumulates across all child addresses and is never recovered.
> At 10,000 transactions that is 10,000 TRX ($3,200) permanently locked across child wallets.

---

### USDT — ERC20 (Ethereum)

**Sweep mechanics:** 2 on-chain transactions. The child address holds only USDT and has no
ETH for gas, so the platform must pre-fund it with ETH first.

| Transaction | Component | Calculation | Cost |
|---|---|---|---|
| Tx 1 | Gas for pre-fund transfer (merchant wallet) | 21,000 gas × 5 gwei × $1,571 | $0.165 |
| Tx 1 | ETH sent to child (75,000 × gasPrice) | 0.000375 ETH × $1,571 | $0.589 |
| Tx 2 | USDT transfer gas consumed from child | 65,000 gas × 5 gwei × $1,571 | $0.511 |
| — | Leftover ETH stranded in child (10,000 gas worth) | 0.000050 ETH × $1,571 | $0.079 |
| — | Etherscan API | Free tier for token txs | $0.005 |

**Net ETH out of platform:** 96,000 gas × 5 gwei = 0.000480 ETH × $1,571

| Metric | Value |
|---|---|
| **Total per transaction** | **$0.759** |
| **10,000 transactions** | **$7,590** |

Minimum sweep threshold: **1 USDT**. Gate: USDT USD value must be ≥ 10× gas cost.

> Most expensive EVM asset. The double-transaction overhead plus ~$0.079 stranded ETH per
> sweep adds up significantly. Gas spikes on mainnet (30–100 gwei) can push this to $4–$15/txn.

---

### USDT — BEP20 (BSC)

**Sweep mechanics:** 2 on-chain transactions (same pattern as ERC20 but using BNB for gas).

| Transaction | Component | Calculation | Cost |
|---|---|---|---|
| Tx 1 | BNB sent to child + gas (96,000 gas × 1 gwei) | 0.000096 BNB × $547 | $0.053 |
| — | Etherscan API ($49 / 10,000 txns) | | $0.005 |

| Metric | Value |
|---|---|
| **Total per transaction** | **$0.058** |
| **10,000 transactions** | **$580** |

Minimum sweep threshold: **1 USDT**.

> Note: USDT on BSC uses **18 decimals**, unlike ERC20 USDT which uses 6. The token
> contract address is `0x55d398326f99059fF775485246999027B3197955`.

---

### USDT — TRC20 (Tron) — Energy Rental Mode

**Sweep mechanics:** 1 on-chain transaction. Energy is rented from a provider immediately
before the sweep so no TRX is burned for gas.

| Component | Calculation | Cost |
|---|---|---|
| Energy rental (65,000 energy, ~1hr) | 3 TRX × $0.32 | $0.960 |
| TRC20 transfer gas (covered by rented energy) | ~0 TRX | $0.000 |
| TronGrid API | Free tier | $0.000 |
| **Total per transaction** | | **$0.960** |
| **10,000 transactions** | | **$9,600** |

Energy providers (failover order): TronSave → TronZap → TronEnergyRent.
Minimum energy: 65,000 units. Rental duration: 600 seconds (configurable).

> Most expensive asset per transaction at current TRX price. The rental fee is drawn from
> prepaid provider balances and must be topped up regularly. If energy rental fails, the
> sweeper falls back to pre-funding 10 TRX directly, costing ~$3.20/txn instead.

---

## 10,000 Transactions/Month — Full Summary

Sorted cheapest to most expensive:

| Asset | On-Chain Cost | Etherscan ($49/mo) | Monthly Total | Per Transaction |
|---|---|---|---|---|
| BNB | $130 | $49 ÷ 10k = $0.005 | **$179** | **$0.018** |
| USDT-BEP20 | $530 | $0.005 | **$579** | **$0.058** |
| ETH | $1,810 | $0.005 | **$1,859** | **$0.186** |
| TRX | $3,200 | $0 | **$3,200** | **$0.320** |
| BTC | $5,190 | $0 | **$5,190** | **$0.519** |
| USDT-ERC20 | $7,540 | $0.005 | **$7,590** | **$0.759** |
| USDT-TRC20 | $9,600 | $0 | **$9,600** | **$0.960** |

*Etherscan $49/month is a shared fixed cost across all Etherscan-dependent assets
(ETH, BNB, USDT-ERC20, USDT-BEP20). The per-txn figure above assumes all 10,000
transactions are of that single asset type.*

---

## Gas Sensitivity (ETH — USDT-ERC20 Worst Case)

USDT-ERC20 cost swings the most with gas price changes.

| ETH Gas Price | Cost per USDT-ERC20 Txn | 10,000 Txn Monthly Cost |
|---|---|---|
| 1 gwei (current low) | $0.151 | $1,510 |
| 5 gwei (average) | $0.759 | $7,590 |
| 30 gwei (busy period) | $4.524 | $45,240 |
| 100 gwei (spike) | $15.080 | $150,800 |

> At extreme gas prices, USDT-ERC20 should be rate-limited or paused. The sweeper has
> a built-in gate: token value must be ≥ 10× gas cost, so very small deposits are
> automatically skipped.

---

## Known Cost Gaps (Not Yet Tracked)

| Item | Status | Impact |
|---|---|---|
| Mongoro settlement fee (`data.fee`) | Returned in API response, never logged | Unknown — could be 0.5–1.5% per transfer |
| USDC deposit detection | **Non-functional** — watcher only resolves token addresses for USDT | USDC sessions will never confirm |
| Stranded ETH in child addresses | ~$0.079 per USDT-ERC20 sweep permanently locked | $790 per 10,000 USDT-ERC20 txns |
| TRX child address reserves | 1 TRX per TRX session, never recovered | $3,200 per 10,000 TRX txns |
| CoinMarketCap overages | 10,000 free calls/month — matches non-USDT volume exactly | Upgrade to Basic ($29/mo) if non-USDT traffic exceeds 10k |

---

## Infrastructure Subscriptions (Monthly Fixed Costs)

| Service | Plan | Monthly | What It Covers |
|---|---|---|---|
| Etherscan V2 | Lite | $49 | ETH + BSC deposit watching |
| TronGrid | Free (API key) | $0 | Tron + TRC20 deposit watching |
| Blockstream Esplora | Free | $0 | Bitcoin deposit watching |
| CoinMarketCap | Free (10k calls) | $0 | Live rates for BTC/ETH/BNB/TRX |
| TronSave / TronZap / TronEnergyRent | Pay-per-use (prepaid balance) | Variable | USDT-TRC20 energy rental |
| Mongoro | Pay-per-transfer | Variable | Fiat settlement payout |
| **Total fixed** | | **$49/month** | |

---

*Last updated: June 30, 2026*
*Source files: `src/services/payment-engine/sweeper/`, `src/services/payment-engine/charges/`, `src/services/payment-engine/watcher/`, `src/config/index.ts`*
