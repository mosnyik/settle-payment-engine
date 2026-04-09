-- Migration 009: Add sandbox flag to api_keys
-- Sandbox keys use pk_test_/sk_test_ prefixes and skip real blockchain/settlement I/O.

ALTER TABLE api_keys
  ADD COLUMN is_sandbox BOOLEAN NOT NULL DEFAULT FALSE
  AFTER is_active;

ALTER TABLE api_keys
  ADD INDEX idx_sandbox (is_sandbox);
