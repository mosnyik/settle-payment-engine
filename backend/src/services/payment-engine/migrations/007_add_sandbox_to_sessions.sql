-- Migration 007: Add sandbox flag to payment_sessions
-- Sandbox sessions skip real watcher polling and real settlement I/O.

ALTER TABLE payment_sessions
  ADD COLUMN is_sandbox BOOLEAN NOT NULL DEFAULT FALSE
  AFTER api_key_id;

ALTER TABLE payment_sessions
  ADD INDEX idx_ps_sandbox (is_sandbox);
