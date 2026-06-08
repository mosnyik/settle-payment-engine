# Product Backlog

Last updated: 2026-04-08

---

## Build Priorities (active queue)

| # | Item | Status |
|---|------|--------|
| 5 | **Sandbox / Testnet Mode** — mock confirmation flow, testnet mode for developer onboarding | ❌ Not started |
| 6 | **Multi-currency Rate Support** — GHS, KES, TZS, ZMW (NGN only today, others throw error) | ❌ Not started |
| 7 | **WaaS Transaction History + Balance** — `GET /v1/wallets/:id/transactions`, balance endpoint | ❌ Not started |

---

## Per-product Backlog

### Product 1 — Offramp

#### User Identity + Bank Account Storage
**Scope:** Introduce a first-party user account concept for consumers initiating offramp payments directly.

- New `users` table: `id`, `phone`, `email`, `password_hash` (or OTP-only), `kyc_status`, timestamps
- New `user_bank_accounts` table: linked to `users`, stores `bank_code`, `account_number`, `account_name`, `bank_name`, `is_default`
- Endpoints:
  - `POST /v1/users/register` — phone/email + password or OTP
  - `POST /v1/users/login`
  - `GET /v1/users/me/bank-accounts` — list saved accounts
  - `POST /v1/users/me/bank-accounts` — add account (resolves via NUBAN)
  - `DELETE /v1/users/me/bank-accounts/:id`
- Payments created by a logged-in user should auto-populate receiver from their saved account

**Prerequisite:** None — can build independently of KYC.

---

#### KYC System
**Scope:** Verify user identity before allowing withdrawals above a threshold.

**Blocked on:**
- Provider decision: Smile Identity, Dojah, or Mono (BVN lookup for Nigeria)
- Compliance decision: what checks are required at which amount tiers (BVN-only? NIN? Liveness?)
- Data retention policy: who stores PII, for how long, under what regulation

**Do not build until the above decisions are made.**

Once decided, implementation involves:
- KYC provider SDK/API integration
- `kyc_submissions` table: status, provider reference, tier, timestamps
- Tier-gated limits: e.g. unverified → ₦50k/day, BVN-verified → ₦500k/day, full KYC → unlimited
- Admin review queue for manual escalations

---

#### Consumer-Facing UI
**Scope:** A web or mobile interface where consumers log in and initiate transfers themselves.

**Prerequisite:** User identity + bank account storage must be done first.

- Stack: Next.js (web) or React Native (mobile) — decision pending
- Core screens: login/register, dashboard, initiate transfer, payment status, saved bank accounts
- Backend already supports everything — this is purely frontend work

---

### Product 2 — Merchant

#### Merchant Self-Onboarding
**Scope:** Let merchants register and get API credentials without admin intervention.

- `POST /v1/auth/register` — merchant name, email, password, business info
- Email verification step (or skip for MVP and return credentials immediately)
- On verify: auto-provision API key with `standard` tier and `mongoro` settlement mode
- `POST /v1/auth/login` — returns JWT or session for merchant dashboard access
- Merchant dashboard: view own payments, download reports, manage webhooks

**Notes:**
- Admin retains ability to upgrade tier, change settlement mode, revoke keys
- Self-registered merchants start on `standard` tier with no IP whitelist
