# Payment Engine

A standalone Express API for crypto-to-fiat payment processing. Supports transfers, gifts, and payment requests.

## Quick Start

```bash
pnpm install
pnpm dev        # Development server on port 3001
pnpm build      # Compile TypeScript
pnpm test       # Run tests with vitest
```

## Project Structure

```
src/
├── index.ts                    # Express app entry point
├── config/                     # Environment configuration
├── routes/                     # API route handlers
│   ├── transfer.routes.ts
│   ├── gift.routes.ts
│   ├── request.routes.ts
│   ├── transaction.routes.ts
│   ├── rate.routes.ts
│   ├── bank.routes.ts
│   └── crypto.routes.ts
├── services/
│   ├── payment-engine/         # Core payment engine
│   │   ├── payment-engine.ts   # Main facade
│   │   ├── session/            # Session management
│   │   ├── wallet/             # Wallet pool (deprecated when HD enabled)
│   │   ├── hd-wallet/          # HD wallet derivation (planned)
│   │   ├── sweeper/            # Fund sweeper to hot wallet (planned)
│   │   ├── rate/               # Rate service
│   │   ├── charges/            # Fee calculation
│   │   ├── watcher/            # Deposit watcher (blockchain monitoring)
│   │   ├── settlement/         # Fiat payout (Mongoro + Telegram fallback)
│   │   └── types.ts            # Type definitions
│   └── transaction/            # Transaction persistence
├── security/                   # Security module
│   ├── middleware/             # Auth, rate limit, audit
│   ├── services/               # API keys, HMAC, audit logs
│   ├── utils/                  # Crypto utilities
│   └── migrations/             # Security tables SQL
├── validation/                 # Zod schemas
├── middleware/                 # Error handling
├── lib/                        # MySQL connection pool
└── docs/                       # Documentation
    ├── DESIGN.md               # System design
    ├── ARCHITECTURE.md         # Architecture diagrams
    ├── SECURITY.md             # Security integration guide
    ├── IMPLEMENTATION.md       # Implementation details
    └── HD_WALLET_DESIGN.md     # HD wallet & sweeper design (planned)
```

## Security Model

API Key + HMAC Signature authentication. See `src/docs/SECURITY.md` for full details.

### Required Headers (Protected Endpoints)

```
X-API-Key: pk_xxxxx           # Public key ID
X-Timestamp: 1708267200000    # Unix timestamp (ms)
X-Signature: abc123...        # HMAC-SHA256 signature
```

### Signature Generation

```
payload = "{timestamp}|{METHOD}|{path}|{SHA256(body)}"
signature = HMAC-SHA256(keyHash, payload)
```

### Public Endpoints (No HMAC Auth)

- `GET /health`
- `GET /rate/current`
- `GET /banks`, `GET /banks/:code`
- `GET /crypto/prices`

### Admin Endpoints (Bearer Token Auth)

Requires `Authorization: Bearer <ADMIN_SECRET>` header.

```
POST   /admin/api-keys              # Create API key (returns secret once)
GET    /admin/api-keys?merchantId=  # List keys for merchant
GET    /admin/api-keys/:keyId       # Get key details
PATCH  /admin/api-keys/:keyId       # Update key settings
DELETE /admin/api-keys/:keyId       # Revoke key
```

### Security Features

- **Rate Limiting**: 100/1000/10000 requests per minute by tier
- **IP Whitelisting**: Per-API-key with CIDR support
- **Audit Logging**: All requests logged with timestamps, IPs, response times
- **Security Headers**: XSS, HSTS, CSP, no-cache

## Deposit Watcher

On-demand blockchain monitoring - only polls addresses with active payment sessions.

- Starts watching when a session is created (wallet assigned)
- Stops watching when deposit is confirmed or session expires
- No unnecessary API calls when idle

### Supported Chains

| Chain | API | Confirmations | Polling Interval |
|-------|-----|---------------|------------------|
| Bitcoin | Blockstream.info | 2 | 60s |
| Ethereum/ERC20 | Etherscan | 12 | 15s |
| BSC/BEP20 | BscScan | 15 | 5s |
| Tron/TRC20 | TronGrid | 19 | 5s |

### Enable Watcher

```env
WATCHER_ENABLED=true

# Required API keys (get free from respective sites)
ETHERSCAN_API_KEY=your_key
BSCSCAN_API_KEY=your_key
TRONGRID_API_KEY=your_key  # Optional but recommended
```

### Fraud Protection

- **Zero-confirmation rejection** - Never acts on unconfirmed transactions
- **RBF detection** - Flags Bitcoin Replace-by-Fee transactions
- **Fake token protection** - Whitelists verified contract addresses only
- **Dust filtering** - Ignores tiny deposits below threshold
- **Reorg detection** - Alerts when confirmed transactions disappear
- **Amount validation** - Rejects underpaid deposits (2% tolerance)

### Run Watcher Migration

```sql
source src/services/payment-engine/watcher/migrations/001_create_watcher_tables.sql
```

## Settlement (Fiat Payout)

Automatic fiat payout to receiver's bank account after deposit is confirmed.

### Flow

1. Deposit confirmed → Settlement triggered automatically
2. Mongoro API called for bank transfer
3. Success → Wait for webhook confirmation → `settled`
4. Failure → Telegram alert → Admin pays manually → `/settle {ref}` → `settled`

### Settlement States

- `settling` - Payout initiated, waiting for confirmation
- `settled` - Payout confirmed successful
- `settlement_reversed` - Payout reversed after initial success (needs manual resolution)

### Configuration

```env
SETTLEMENT_ENABLED=true
MONGORO_CALLBACK_URL=https://yourapp.com/webhooks/mongoro
TELEGRAM_ALERTS_ENABLED=true
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### Endpoints

- `POST /webhooks/mongoro` - Receives Mongoro status updates
- `POST /admin/sessions/:reference/settle` - Mark session as settled after manual payment

### Run Settlement Migration

```sql
source src/services/payment-engine/settlement/migrations/001_create_settlement_tables.sql
```

## HD Wallet (Planned)

> **Status**: Implementation pending. See `src/docs/HD_WALLET_DESIGN.md` for full design.

Replacing the static wallet pool with HD (Hierarchical Deterministic) wallet derivation:

- **Unlimited addresses** - No pool exhaustion, each payment gets unique address
- **On-the-fly derivation** - Addresses derived from master seed as needed
- **Automatic sweeping** - Funds consolidated to hot wallet after deposit confirmation

### Derivation Paths

| Chain | Path | Networks |
|-------|------|----------|
| Bitcoin | `m/84'/0'/0'/0/{index}` | bitcoin |
| Ethereum | `m/44'/60'/0'/0/{index}` | ethereum, bsc, polygon, base, erc20, bep20 |
| Tron | `m/44'/195'/0'/0/{index}` | tron, trc20 |

### Planned Configuration

```env
HD_WALLET_ENABLED=true
HD_SEED_PHRASE_ENCRYPTED=<AES-256 encrypted mnemonic>
HD_SEED_ENCRYPTION_KEY=<32-byte hex key>

# Hot wallets (sweep destinations)
HOT_WALLET_BITCOIN=bc1q...
HOT_WALLET_ETHEREUM=0x...
HOT_WALLET_TRON=T...

# Sweeper
SWEEPER_ENABLED=true
```

### New Tables (after migration)

- `hd_wallet_config` - Derivation state per chain
- `derived_addresses` - Audit trail of all derived addresses
- `sweep_transactions` - Sweep operation audit trail

## Database

MySQL with tables:
- `payment_sessions` - Transaction state
- `wallets` - Wallet pool with per-chain flags (deprecated when HD wallet enabled)
- `payers`, `receivers` - Participant details
- `rates` - Exchange rates
- `api_keys` - API authentication
- `audit_logs` - Security audit trail
- `watcher_processed_transactions` - Deposit tracking (deduplication)
- `watcher_state` - Watcher monitoring stats
- `watcher_fraud_events` - Security events for review
- `settlement_attempts` - Fiat payout audit trail

### Run Security Migration

```sql
source src/security/migrations/001_create_security_tables.sql
```

## Transaction Types

1. **Transfer**: Payer sends crypto, receiver gets fiat (both known at creation)
2. **Gift**: Sender pays crypto, recipient claims later with bank details
3. **Request**: Requester creates invoice, payer fulfills with crypto

## Configuration

Environment variables (`.env`):

```
PORT=3001
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=2settle
COINMARKETCAP_API_KEY=
MONGORO_TOKEN=
MONGORO_TRANSFERPIN=

# Admin (required for /admin/* endpoints)
ADMIN_SECRET=your-secure-admin-secret-here

# Security (optional)
RATE_LIMIT_ENABLED=true
IP_WHITELIST_ENABLED=true
AUDIT_LOG_ENABLED=true
HMAC_TIMESTAMP_TOLERANCE_MS=300000

# Deposit Watcher (optional)
WATCHER_ENABLED=false
ETHERSCAN_API_KEY=
BSCSCAN_API_KEY=
TRONGRID_API_KEY=
```

## Code Style

- TypeScript strict mode
- Zod for validation
- Parameterized SQL queries (no raw interpolation)
- Error classes extend `PaymentEngineError` or `SecurityError`

## Testing

```bash
pnpm test           # Watch mode
pnpm test:run       # Single run
pnpm coverage       # With coverage
```
