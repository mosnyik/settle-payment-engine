-- =============================================================================
-- OTP delivery method
-- =============================================================================
-- Phone codes can now go out by SMS or WhatsApp (same 'phone' channel, same
-- user identity). Recording which one was used lets the resend cooldown allow
-- a single WhatsApp -> SMS fallback, and shows the delivery split.
-- NULL for rows created before this migration.

ALTER TABLE user_otp_codes
  ADD COLUMN delivery_method ENUM('email', 'sms', 'whatsapp') NULL AFTER channel;
