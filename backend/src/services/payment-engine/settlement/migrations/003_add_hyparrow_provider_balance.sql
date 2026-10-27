-- Hyparrow Provider Balance Migration
-- Run: mysql -u root -p 2settle < src/services/payment-engine/settlement/migrations/003_add_hyparrow_provider_balance.sql
--
-- Hyparrow replaces Mongoro as the settlement provider. The router only picks
-- a provider whose ledger row can cover the payout, so Hyparrow needs a row.
-- It starts at zero — credit it via POST /v1/admin/settlement-providers/hyparrow/credit
-- after funding the Hyparrow wallet.

INSERT IGNORE INTO settlement_provider_balances (provider, currency, balance, reserved)
VALUES ('hyparrow', 'NGN', 0, 0);
