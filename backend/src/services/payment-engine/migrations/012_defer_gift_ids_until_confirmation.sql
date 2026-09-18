-- Apply BEFORE deploying the deferred-gift-ID API. Do not rerun gift generators
-- to migrate existing payments; this migration preserves funded claim codes.
ALTER TABLE payment_sessions
  ADD COLUMN gift_id VARCHAR(20) NULL DEFAULT NULL,
  ADD UNIQUE KEY uk_payment_gift_id (gift_id);

-- Existing funded gifts retain their previously distributed codes.
UPDATE payment_sessions
SET gift_id = reference
WHERE type = 'gift'
  AND (confirmed_at IS NOT NULL OR receiver_id IS NOT NULL
       OR status IN ('confirmed', 'settling', 'settled'));

-- New gift sessions leave gift_id NULL. A legacy unpaid row may still exist
-- from before migration, but it is not accepted by the new claim endpoint.
