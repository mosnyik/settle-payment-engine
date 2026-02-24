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
│   │   ├── wallet/             # Wallet pool
│   │   ├── rate/               # Rate service
│   │   ├── charges/            # Fee calculation
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
    └── IMPLEMENTATION.md       # Implementation details
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

## Database

MySQL with tables:
- `payment_sessions` - Transaction state
- `wallets` - Wallet pool with per-chain flags
- `payers`, `receivers` - Participant details
- `rates` - Exchange rates
- `api_keys` - API authentication
- `audit_logs` - Security audit trail

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
