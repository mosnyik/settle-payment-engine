# HD Wallet & Fund Sweeper Design

> **Status**: Implementation pending

## Overview

This document describes the planned replacement of the static wallet pool with HD (Hierarchical Deterministic) wallet derivation and automatic fund sweeping.

### Current System (Wallet Pool)

- Pre-generated wallets stored in `wallets` table
- Per-chain availability flags (bitcoin_flag, ethereum_flag, etc.)
- Wallets assigned via `assignWallet()` with `FOR UPDATE` row lock
- Wallets released back to pool via `releaseWallet()` after confirmation/expiry
- **Problem**: Finite pool can be exhausted, requires manual provisioning

### New System (HD Wallet)

- Addresses derived on-the-fly from master seed
- Atomic index increment per chain
- Each payment gets unique address (never reused)
- Funds automatically swept to hot wallet after confirmation
- **Benefit**: Unlimited addresses, no pool exhaustion, simpler logic

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Payment Session Created                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      HD Wallet Service                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  deriveNextAddress(network)                               │  │
│  │  1. Map network → chain (bitcoin/ethereum/tron)           │  │
│  │  2. SELECT next_index FROM hd_wallet_config FOR UPDATE    │  │
│  │  3. UPDATE next_index = next_index + 1                    │  │
│  │  4. Derive address from seed + path + index               │  │
│  │  5. Record in derived_addresses table                     │  │
│  │  6. Return { address, derivationIndex, chain }            │  │
│  └───────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Deposit Watcher monitors address                                │
│  → Deposit detected → confirming → confirmed                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Sweeper Service                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  sweep(request)                                           │  │
│  │  1. Get private key from HD wallet (chain + index)        │  │
│  │  2. Get hot wallet address for chain                      │  │
│  │  3. Build sweep transaction (native or token)             │  │
│  │  4. Sign and broadcast                                    │  │
│  │  5. Record in sweep_transactions table                    │  │
│  └───────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Funds arrive in Hot Wallet                                      │
│  Settlement proceeds normally (fiat payout via Mongoro)         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Derivation Paths

Using BIP44/BIP84 standard paths:

| Chain | Derivation Path | Address Format | Networks |
|-------|-----------------|----------------|----------|
| Bitcoin | `m/84'/0'/0'/0/{index}` | bc1q... (Native SegWit) | bitcoin |
| Ethereum | `m/44'/60'/0'/0/{index}` | 0x... | ethereum, bsc, polygon, base, erc20, bep20 |
| Tron | `m/44'/195'/0'/0/{index}` | T... | tron, trc20 |

**Note**: EVM chains (Ethereum, BSC, Polygon, Base) share the same derivation path because they use identical address generation.

---

## Database Schema

### hd_wallet_config

Tracks derivation state per chain.

```sql
CREATE TABLE hd_wallet_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chain ENUM('bitcoin', 'ethereum', 'tron') NOT NULL UNIQUE,
  derivation_path_base VARCHAR(100) NOT NULL,
  next_index BIGINT UNSIGNED NOT NULL DEFAULT 0,
  hot_wallet_address VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Initial data
INSERT INTO hd_wallet_config (chain, derivation_path_base, next_index, hot_wallet_address) VALUES
  ('bitcoin', "m/84'/0'/0'/0", 0, ''),
  ('ethereum', "m/44'/60'/0'/0", 0, ''),
  ('tron', "m/44'/195'/0'/0", 0, '');
```

### derived_addresses

Audit trail of all derived addresses.

```sql
CREATE TABLE derived_addresses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chain ENUM('bitcoin', 'ethereum', 'tron') NOT NULL,
  derivation_index BIGINT UNSIGNED NOT NULL,
  address VARCHAR(100) NOT NULL,
  session_id VARCHAR(36) NULL,
  derived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  swept_at TIMESTAMP NULL,
  sweep_tx_hash VARCHAR(100) NULL,
  UNIQUE KEY idx_chain_index (chain, derivation_index),
  UNIQUE KEY idx_address (address),
  INDEX idx_session (session_id)
);
```

### sweep_transactions

Audit trail for all sweep operations.

```sql
CREATE TABLE sweep_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  chain ENUM('bitcoin', 'ethereum', 'tron') NOT NULL,
  network VARCHAR(20) NOT NULL,
  from_address VARCHAR(100) NOT NULL,
  to_address VARCHAR(100) NOT NULL,
  asset_type ENUM('native', 'token') NOT NULL,
  token_contract VARCHAR(100) NULL,
  amount_raw VARCHAR(78) NOT NULL,
  amount_decimal DECIMAL(36, 18) NOT NULL,
  tx_hash VARCHAR(100) NULL,
  status ENUM('pending', 'submitted', 'confirmed', 'failed') DEFAULT 'pending',
  error_message TEXT NULL,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP NULL,
  INDEX idx_session (session_id),
  INDEX idx_status (status)
);
```

### payment_sessions modifications

```sql
ALTER TABLE payment_sessions
  ADD COLUMN derivation_index BIGINT UNSIGNED NULL AFTER wallet_id,
  ADD COLUMN hd_chain VARCHAR(20) NULL AFTER network,
  MODIFY COLUMN wallet_id INT NULL;
```

---

## Supported Assets

### Native Coins

| Chain | Coin | Sweep Method |
|-------|------|--------------|
| Bitcoin | BTC | UTXO consolidation |
| Ethereum | ETH | Simple transfer (balance - gas) |
| BSC | BNB | Simple transfer (balance - gas) |
| Tron | TRX | Bandwidth-based transfer |

### Tokens

| Chain | Token | Contract Address |
|-------|-------|------------------|
| Ethereum | USDT | 0xdAC17F958D2ee523a2206206994597C13D831ec7 |
| Ethereum | USDC | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 |
| BSC | USDT | 0x55d398326f99059fF775485246999027B3197955 |
| BSC | USDC | 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d |
| Tron | USDT | TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t |

---

## Configuration

### Environment Variables

```env
# HD Wallet
HD_WALLET_ENABLED=true
HD_SEED_PHRASE_ENCRYPTED=<AES-256-CBC encrypted mnemonic, hex encoded>
HD_SEED_ENCRYPTION_KEY=<32-byte key, hex encoded>

# Hot Wallets (sweep destinations)
HOT_WALLET_BITCOIN=bc1q...
HOT_WALLET_ETHEREUM=0x...
HOT_WALLET_TRON=T...

# Sweeper
SWEEPER_ENABLED=true
SWEEPER_MAX_RETRIES=3
SWEEPER_RETRY_DELAY_MS=60000

# Sweep Thresholds (skip if below)
SWEEP_MIN_BTC=0.0001
SWEEP_MIN_ETH=0.001
SWEEP_MIN_BNB=0.01
SWEEP_MIN_TRX=10
SWEEP_MIN_USDT=1
SWEEP_MIN_USDC=1

# RPC Endpoints (for transaction broadcast)
ETHEREUM_RPC_URL=https://eth.llamarpc.com
BSC_RPC_URL=https://bsc-dataseed.binance.org
```

### Seed Encryption

The seed phrase is stored encrypted at rest:

```typescript
// Encryption (setup)
const key = crypto.randomBytes(32);
const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
const encrypted = Buffer.concat([iv, cipher.update(seedPhrase), cipher.final()]);
// Store encrypted.toString('hex') in HD_SEED_PHRASE_ENCRYPTED
// Store key.toString('hex') in HD_SEED_ENCRYPTION_KEY

// Decryption (runtime)
const encrypted = Buffer.from(process.env.HD_SEED_PHRASE_ENCRYPTED, 'hex');
const key = Buffer.from(process.env.HD_SEED_ENCRYPTION_KEY, 'hex');
const iv = encrypted.slice(0, 16);
const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
const seedPhrase = decipher.update(encrypted.slice(16)) + decipher.final();
```

---

## File Structure

```
src/services/payment-engine/
├── hd-wallet/
│   ├── index.ts                    # Exports
│   ├── types.ts                    # HDChain, DerivationResult
│   ├── hd-wallet.service.ts        # Main service
│   ├── derivation/
│   │   ├── index.ts
│   │   ├── bitcoin.derivation.ts   # BIP84 SegWit
│   │   ├── evm.derivation.ts       # BIP44 Ethereum
│   │   └── tron.derivation.ts      # BIP44 Tron
│   └── migrations/
│       └── 001_create_hd_wallet_tables.sql
├── sweeper/
│   ├── index.ts
│   ├── types.ts                    # SweepRequest, SweepResult
│   ├── sweeper.service.ts          # Main orchestrator
│   ├── chains/
│   │   ├── index.ts
│   │   ├── bitcoin.sweeper.ts      # UTXO-based
│   │   ├── evm.sweeper.ts          # ETH/BNB native
│   │   ├── evm-token.sweeper.ts    # ERC20/BEP20
│   │   └── tron.sweeper.ts         # TRX + TRC20
│   └── utils/
│       └── gas-estimator.ts
└── wallet/
    └── wallet-pool.ts              # Deprecated (keep for backwards compat)
```

---

## Dependencies

New packages required:

```json
{
  "@scure/bip32": "^1.3.3",
  "@scure/bip39": "^1.2.2",
  "@scure/btc-signer": "^1.2.1",
  "ethers": "^6.9.0",
  "tronweb": "^5.3.0"
}
```

---

## Integration Points

### Session Manager

Replace `assignWallet()` with `deriveNextAddress()`:

```typescript
// Before
const wallet = await assignWallet(input.network, ttl);
sessionData.depositAddress = wallet.address;
sessionData.walletId = wallet.walletId;

// After
const derivation = await hdWallet.deriveNextAddress(input.network);
sessionData.depositAddress = derivation.address;
sessionData.derivationIndex = derivation.derivationIndex;
sessionData.hdChain = derivation.chain;
```

Remove all `releaseWallet()` calls (addresses are never reused).

### Deposit Watcher

Trigger sweep on confirmation:

```typescript
// In checkConfirmations(), after confirmDeposit():
if (sweeperEnabled) {
  sweeper.sweep({
    sessionId: session.id,
    chain: session.hdChain,
    network: session.network,
    fromAddress: session.depositAddress,
    derivationIndex: session.derivationIndex,
    amount: tx.amount,
    cryptoCurrency: session.cryptoCurrency,
    tokenContract: tx.tokenAddress,
  }).catch(err => {
    // Non-blocking - log error, settlement proceeds
  });
}
```

---

## Error Handling

### Sweep Failures

| Error | Action |
|-------|--------|
| Insufficient gas (token sweep) | Skip, retry later or fund gas |
| RPC timeout | Retry with exponential backoff |
| Transaction rejected | Log error, require manual review |
| Network congestion | Increase gas price, retry |

Failed sweeps are recorded in `sweep_transactions` with `status = 'failed'` and can be retried via admin endpoint or background job.

### Recovery

- **Derived addresses** are permanently recorded for audit/recovery
- **Sweep transactions** track all attempts with status
- **Hot wallet balance** should be monitored for anomalies

---

## Testing Strategy

### Unit Tests

- Deterministic derivation (same seed + index = same address)
- Atomic index increment (concurrent requests get unique indices)
- Each chain derivation produces valid address format

### Integration Tests

1. Create session → verify address derived
2. Check `derived_addresses` table → verify record created
3. Simulate deposit confirmation
4. Check `sweep_transactions` table → verify sweep initiated
5. Verify funds arrive in hot wallet (testnet)

### Testnet First

| Chain | Network |
|-------|---------|
| Bitcoin | testnet3 |
| Ethereum | Sepolia |
| BSC | testnet |
| Tron | Shasta |

---

## Migration Plan

1. **Phase 1**: Deploy database migrations (new tables)
2. **Phase 2**: Deploy HD wallet service (disabled)
3. **Phase 3**: Enable HD wallet (`HD_WALLET_ENABLED=true`)
4. **Phase 4**: Deploy sweeper (disabled)
5. **Phase 5**: Enable sweeper (`SWEEPER_ENABLED=true`)
6. **Phase 6**: Monitor, validate, deprecate wallet pool

### Backwards Compatibility

- `wallet_id` column remains nullable
- Old sessions (with wallet_id) continue working
- New sessions use `derivation_index`
- Watcher handles both scenarios

### Rollback

Set `HD_WALLET_ENABLED=false` to revert to wallet pool.
