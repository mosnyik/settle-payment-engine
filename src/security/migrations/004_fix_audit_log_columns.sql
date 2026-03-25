-- Fix audit_logs column sizes
-- resource_type VARCHAR(50) is too small for full paths like .well-known/acme-challenge/...
-- action VARCHAR(100) can also be tight for long paths

ALTER TABLE audit_logs
  MODIFY COLUMN resource_type VARCHAR(500),
  MODIFY COLUMN action VARCHAR(200);
