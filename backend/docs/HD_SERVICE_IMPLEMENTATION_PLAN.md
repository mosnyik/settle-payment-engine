# HD Wallet Service - External API Implementation Plan

## Overview

Expose the HD Wallet + Watcher + Sweeper as a tiered external service, allowing third-party merchants to generate unique deposit addresses, monitor for payments, and automatically sweep funds to their wallets.

---

## Service Model

### What Merchants Get

1. **Unique Deposit Addresses** - HD-derived addresses per transaction
2. **Automatic Deposit Watching** - Monitor blockchain for incoming payments
3. **Automatic Sweeping** - Funds swept to merchant's wallet after confirmation
4. **Webhook Notifications** - Real-time updates on deposit status
5. **Dashboard/API Access** - Track all deposits and history

### Fee Structure

```
Fee = max(1% of deposit amount, $0.50 minimum)
Network fees deducted separately from sweep amount.
```

| Deposit | Service Fee | Network Fee* | Merchant Receives |
|---------|-------------|--------------|-------------------|
| $50 USDT | $0.50 | ~$1.00 | ~$48.50 |
| $100 USDT | $1.00 | ~$1.00 | ~$98.00 |
| $500 USDT | $5.00 | ~$1.00 | ~$494.00 |

*Network fees vary by chain

---

## Tiered Access

| Feature | Free | Standard | Premium | Enterprise |
|---------|------|----------|---------|------------|
| **Price** | $0 | $49/mo | $199/mo | Custom |
| **Rate Limit** | 10/min | 100/min | 1000/min | Unlimited |
| **Active Deposits** | 5 | 50 | 500 | Unlimited |
| **Expiry Window** | 30 min | 60 min | 24 hrs | Custom |
| **Webhooks** | ❌ | ✅ | ✅ Priority | ✅ + SLA |
| **Networks** | Tron only | All | All | All |
| **Support** | Community | Email | Priority | Dedicated |

---

## Implementation Phases

### Phase 1: Database Schema
**Files to create:**
- `src/services/deposit-service/migrations/001_create_deposit_tables.sql`

**Tables:**
```sql
-- Merchant deposit sessions
CREATE TABLE merchant_deposits (
  id                VARCHAR(36) PRIMARY KEY,

  -- Ownership
  merchant_id       VARCHAR(50) NOT NULL,
  api_key_id        VARCHAR(50) NOT NULL,

  -- Deposit address (HD derived)
  deposit_address   VARCHAR(100) NOT NULL UNIQUE,
  network           VARCHAR(20) NOT NULL,
  chain             VARCHAR(20) NOT NULL,
  derivation_index  INT NOT NULL,

  -- Merchant's destination
  sweep_to_address  VARCHAR(100) NOT NULL,

  -- Status
  status            ENUM('pending', 'detected', 'confirming', 'confirmed', 'sweeping', 'swept', 'expired', 'failed') DEFAULT 'pending',

  -- Deposit tracking
  tx_hash           VARCHAR(100) NULL,
  received_amount   DECIMAL(18, 8) NULL,
  confirmations     INT DEFAULT 0,
  detected_at       TIMESTAMP NULL,
  confirmed_at      TIMESTAMP NULL,

  -- Sweep tracking
  sweep_tx_hash     VARCHAR(100) NULL,
  swept_at          TIMESTAMP NULL,
  swept_amount      DECIMAL(18, 8) NULL,
  service_fee       DECIMAL(18, 8) NULL,
  network_fee       DECIMAL(18, 8) NULL,

  -- Webhooks
  callback_url      VARCHAR(500) NULL,

  -- Lifecycle
  expires_at        TIMESTAMP NOT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Merchant reference
  reference         VARCHAR(100) NULL,
  metadata          JSON NULL,

  INDEX idx_merchant (merchant_id),
  INDEX idx_api_key (api_key_id),
  INDEX idx_address (deposit_address),
  INDEX idx_status (status),
  INDEX idx_expires (expires_at),
  INDEX idx_reference (merchant_id, reference)
);

-- Webhook delivery tracking
CREATE TABLE webhook_deliveries (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  deposit_id        VARCHAR(36) NOT NULL,
  event_type        ENUM('deposit.detected', 'deposit.confirmed', 'deposit.swept', 'deposit.expired', 'deposit.failed') NOT NULL,

  -- Delivery
  payload           JSON NOT NULL,
  attempt           INT DEFAULT 1,
  max_attempts      INT DEFAULT 5,

  -- Response
  response_status   INT NULL,
  response_body     TEXT NULL,

  -- Timing
  next_retry_at     TIMESTAMP NULL,
  delivered_at      TIMESTAMP NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_deposit (deposit_id),
  INDEX idx_pending (delivered_at, next_retry_at)
);

-- Merchant tier configuration (extend existing api_keys table)
ALTER TABLE api_keys
  ADD COLUMN deposit_tier ENUM('free', 'standard', 'premium', 'enterprise') DEFAULT 'free',
  ADD COLUMN deposit_active_count INT DEFAULT 0,
  ADD COLUMN deposit_monthly_count INT DEFAULT 0,
  ADD COLUMN deposit_monthly_reset TIMESTAMP NULL;
```

---

### Phase 2: Core Service
**Files to create:**
- `src/services/deposit-service/deposit.service.ts`
- `src/services/deposit-service/deposit.repository.ts`
- `src/services/deposit-service/types.ts`
- `src/services/deposit-service/errors.ts`
- `src/services/deposit-service/index.ts`

**DepositService responsibilities:**
```typescript
class DepositService {
  // Create new deposit session
  async createDeposit(input: CreateDepositInput): Promise<MerchantDeposit>

  // Get deposit by ID
  async getDeposit(depositId: string): Promise<MerchantDeposit>

  // List deposits for merchant
  async listDeposits(merchantId: string, filters: DepositFilters): Promise<PaginatedDeposits>

  // Cancel pending deposit
  async cancelDeposit(depositId: string): Promise<void>

  // Internal: called by watcher when deposit detected
  async onDepositDetected(depositId: string, txHash: string, amount: number): Promise<void>

  // Internal: called by watcher when deposit confirmed
  async onDepositConfirmed(depositId: string, confirmations: number): Promise<void>

  // Internal: called by sweeper when sweep complete
  async onDepositSwept(depositId: string, sweepTxHash: string, amounts: SweepAmounts): Promise<void>

  // Internal: expire stale deposits
  async expireStaleDeposits(): Promise<number>
}
```

---

### Phase 3: Tier Enforcement
**Files to modify:**
- `src/security/services/apiKey.service.ts` - Add tier fields
- `src/security/middleware/rateLimit.ts` - Check deposit-specific limits

**Files to create:**
- `src/services/deposit-service/tier.service.ts`

**Tier checks:**
```typescript
class DepositTierService {
  // Check if merchant can create new deposit
  async canCreateDeposit(apiKeyId: string): Promise<{ allowed: boolean; reason?: string }>

  // Get tier limits for API key
  async getTierLimits(apiKeyId: string): Promise<TierLimits>

  // Increment active deposit count
  async incrementActiveCount(apiKeyId: string): Promise<void>

  // Decrement active deposit count
  async decrementActiveCount(apiKeyId: string): Promise<void>

  // Get expiry window for tier
  getExpiryWindow(tier: DepositTier): number // seconds

  // Get allowed networks for tier
  getAllowedNetworks(tier: DepositTier): Network[]
}
```

---

### Phase 4: Webhook Service
**Files to create:**
- `src/services/deposit-service/webhook.service.ts`

**Webhook functionality:**
```typescript
class WebhookService {
  // Queue webhook for delivery
  async queueWebhook(depositId: string, event: WebhookEvent): Promise<void>

  // Process pending webhooks (called by background job)
  async processPendingWebhooks(): Promise<number>

  // Retry failed webhooks
  async retryFailedWebhooks(): Promise<number>

  // Sign webhook payload
  signPayload(payload: object, secret: string): string
}
```

**Webhook events:**
- `deposit.detected` - Deposit seen on chain (0 confirmations)
- `deposit.confirmed` - Required confirmations reached
- `deposit.swept` - Funds sent to merchant's address
- `deposit.expired` - Session expired without deposit
- `deposit.failed` - Error occurred

**Webhook payload:**
```json
{
  "event": "deposit.confirmed",
  "timestamp": "2024-01-01T12:00:00Z",
  "data": {
    "id": "dep_abc123",
    "status": "confirmed",
    "depositAddress": "TXyz...",
    "sweepToAddress": "TMerchant...",
    "network": "trc20",
    "receivedAmount": "100.00000000",
    "txHash": "abc123...",
    "confirmations": 19,
    "reference": "order_456"
  }
}
```

**Signature header:**
```
X-Signature: sha256=<HMAC-SHA256(payload, webhook_secret)>
X-Timestamp: 1704110400
```

---

### Phase 5: API Routes
**Files to create:**
- `src/routes/deposit.routes.ts`

**Endpoints:**

```
POST   /v1/deposits
       Create new deposit session
       Body: { network, sweepToAddress, callbackUrl?, reference?, metadata? }
       Returns: { id, depositAddress, network, expiresAt, ... }

GET    /v1/deposits/:id
       Get deposit details
       Returns: { id, status, depositAddress, receivedAmount, ... }

GET    /v1/deposits
       List deposits with filters
       Query: ?status=pending&limit=20&offset=0
       Returns: { deposits: [...], total, limit, offset }

DELETE /v1/deposits/:id
       Cancel pending deposit (only if status=pending)
       Returns: { success: true }

GET    /v1/deposits/networks
       List supported networks for current tier
       Returns: { networks: [...] }

GET    /v1/deposits/usage
       Get current usage stats
       Returns: { activeDeposits, monthlyDeposits, limits, tier }
```

---

### Phase 6: Watcher Integration
**Files to modify:**
- `src/services/payment-engine/watcher/deposit-watcher.ts`

**Changes:**
- Add support for `MerchantDeposit` sessions (not just `PaymentSession`)
- Call `depositService.onDepositDetected()` when deposit found
- Call `depositService.onDepositConfirmed()` when confirmed

**New watch interface:**
```typescript
interface WatchableDeposit {
  sessionId: string;
  depositAddress: string;
  network: Network;
  expectedAmount?: number;  // Optional for merchant deposits
  expiresAt: Date;
  type: 'payment' | 'merchant';  // Distinguish internal vs external
}
```

---

### Phase 7: Sweeper Integration
**Files to modify:**
- `src/services/payment-engine/sweeper/sweeper.service.ts`

**Changes:**
- Accept custom destination address (merchant's `sweepToAddress`)
- Calculate and deduct service fee
- Return actual amounts swept and fees

**Updated sweep interface:**
```typescript
interface SweepRequest {
  chain: HDChain;
  fromAddress: string;
  toAddress: string;        // Hot wallet OR merchant's address
  derivationIndex: number;
  amount: number;
  type: 'internal' | 'merchant';
}

interface SweepResult {
  txHash: string;
  grossAmount: number;      // Total received
  networkFee: number;       // Gas/blockchain fee
  serviceFee: number;       // Our fee
  netAmount: number;        // Amount sent to destination
}
```

---

### Phase 8: Background Jobs
**Files to create:**
- `src/jobs/deposit-expiry.job.ts`
- `src/jobs/webhook-processor.job.ts`

**Jobs to run:**
```typescript
// Every minute: expire stale deposits
async function runDepositExpiryJob() {
  const expired = await depositService.expireStaleDeposits();
  console.log(`[Job] Expired ${expired} deposits`);
}

// Every 10 seconds: process webhook queue
async function runWebhookProcessorJob() {
  const sent = await webhookService.processPendingWebhooks();
  const retried = await webhookService.retryFailedWebhooks();
  console.log(`[Job] Sent ${sent} webhooks, retried ${retried}`);
}
```

---

### Phase 9: Configuration
**Files to modify:**
- `src/config/index.ts`
- `.env.example`

**New config:**
```typescript
depositService: {
  enabled: process.env.DEPOSIT_SERVICE_ENABLED === 'true',

  // Fee structure
  feePercentage: parseFloat(process.env.DEPOSIT_FEE_PERCENT || '1.0'),
  feeMinimum: parseFloat(process.env.DEPOSIT_FEE_MINIMUM || '0.50'),

  // Tier limits
  tiers: {
    free: {
      rateLimit: 10,
      maxActive: 5,
      expirySeconds: 1800,
      networks: ['tron', 'trc20'],
      webhooks: false,
    },
    standard: {
      rateLimit: 100,
      maxActive: 50,
      expirySeconds: 3600,
      networks: ['bitcoin', 'ethereum', 'tron', 'bsc', 'erc20', 'bep20', 'trc20'],
      webhooks: true,
    },
    premium: {
      rateLimit: 1000,
      maxActive: 500,
      expirySeconds: 86400,
      networks: ['bitcoin', 'ethereum', 'tron', 'bsc', 'polygon', 'base', 'erc20', 'bep20', 'trc20'],
      webhooks: true,
    },
    enterprise: {
      rateLimit: Infinity,
      maxActive: Infinity,
      expirySeconds: 604800, // 7 days
      networks: ['all'],
      webhooks: true,
    },
  },

  // Webhook settings
  webhook: {
    maxRetries: 5,
    retryDelayMs: [1000, 5000, 30000, 300000, 3600000], // Exponential backoff
    timeoutMs: 10000,
  },
}
```

**New env vars:**
```env
# Deposit Service
DEPOSIT_SERVICE_ENABLED=true
DEPOSIT_FEE_PERCENT=1.0
DEPOSIT_FEE_MINIMUM=0.50

# Webhook settings
DEPOSIT_WEBHOOK_MAX_RETRIES=5
DEPOSIT_WEBHOOK_TIMEOUT_MS=10000
```

---

### Phase 10: Documentation & Testing
**Files to create:**
- `docs/DEPOSIT_API.md` - API documentation for merchants
- `src/services/deposit-service/__tests__/deposit.service.test.ts`
- `src/routes/__tests__/deposit.routes.test.ts`

---

## File Summary

### New Files (15)
```
src/services/deposit-service/
├── index.ts
├── types.ts
├── errors.ts
├── deposit.service.ts
├── deposit.repository.ts
├── tier.service.ts
├── webhook.service.ts
└── migrations/
    └── 001_create_deposit_tables.sql

src/routes/
└── deposit.routes.ts

src/jobs/
├── deposit-expiry.job.ts
└── webhook-processor.job.ts

docs/
└── DEPOSIT_API.md
```

### Modified Files (7)
```
src/config/index.ts                    - Add deposit service config
src/routes/index.ts                    - Mount deposit routes
src/security/services/apiKey.service.ts - Add tier fields
src/services/payment-engine/watcher/   - Support merchant deposits
src/services/payment-engine/sweeper/   - Support custom destination
.env.example                           - Add new env vars
CLAUDE.md                              - Document new endpoints
```

---

## Implementation Order

1. **Phase 1: Database** - Create tables, run migration
2. **Phase 2: Core Service** - DepositService, repository, types
3. **Phase 3: Tier Enforcement** - Limits checking
4. **Phase 5: API Routes** - External endpoints (can test manually)
5. **Phase 6: Watcher Integration** - Detect deposits
6. **Phase 7: Sweeper Integration** - Sweep to merchant
7. **Phase 4: Webhook Service** - Notifications
8. **Phase 8: Background Jobs** - Expiry, webhook processing
9. **Phase 9: Configuration** - Finalize config
10. **Phase 10: Documentation** - API docs, tests

---

## Estimated Effort

| Phase | Complexity | Time Estimate |
|-------|------------|---------------|
| Phase 1: Database | Low | 1 hour |
| Phase 2: Core Service | Medium | 3-4 hours |
| Phase 3: Tier Enforcement | Low | 1-2 hours |
| Phase 4: Webhook Service | Medium | 2-3 hours |
| Phase 5: API Routes | Low | 2 hours |
| Phase 6: Watcher Integration | Medium | 2-3 hours |
| Phase 7: Sweeper Integration | Medium | 2-3 hours |
| Phase 8: Background Jobs | Low | 1 hour |
| Phase 9: Configuration | Low | 1 hour |
| Phase 10: Documentation | Low | 2 hours |
| **Total** | | **~18-22 hours** |

---

## Success Criteria

- [ ] Merchant can create deposit via API
- [ ] Unique HD address generated per deposit
- [ ] Watcher detects incoming payments
- [ ] Sweeper sends to merchant's address (minus fees)
- [ ] Webhooks delivered reliably
- [ ] Tier limits enforced
- [ ] Expired deposits cleaned up
- [ ] All flows tested end-to-end
