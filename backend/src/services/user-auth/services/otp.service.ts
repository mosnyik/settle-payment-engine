/**
 * OTP Service
 * Passwordless login via email/phone: generate + deliver a short-lived code,
 * then verify it and resolve to a user account.
 */

import crypto from 'crypto';
import pool from '../../../lib/mysql';
import { RowDataPacket } from 'mysql2';
import { sha256 } from '../../../security/utils/crypto';
import config from '../../../config';
import { OtpChannel, OtpDelivery, User } from '../types';
import { InvalidOtpError, OtpRateLimitedError } from '../errors';
import { getOtpProvider, resolveOtpDelivery } from '../otp/providers';
import { findOrCreateUserByIdentity } from './user.service';

interface OtpCodeRow extends RowDataPacket {
  id: number;
  delivery_method: OtpDelivery | null;
  code_hash: string;
  attempts: number;
  consumed_at: Date | null;
  expires_at: Date;
  created_at: Date;
}

function generateCode(length: number): string {
  const max = 10 ** length;
  const code = crypto.randomInt(0, max);
  return code.toString().padStart(length, '0');
}

/**
 * Whether a new code may be sent despite the resend cooldown. The one
 * exception is falling back from WhatsApp to SMS: a number that isn't on
 * WhatsApp is still accepted by Meta, so the user would otherwise wait out
 * the cooldown for a message that never arrives. Only that direction is
 * allowed, so at most two messages go out per cooldown window.
 */
export function canBypassCooldown(previous: OtpDelivery | null, next: OtpDelivery): boolean {
  return previous === 'whatsapp' && next === 'sms';
}

/**
 * Request a login code for an email/phone identifier. Enforces a resend
 * cooldown so a single identifier can't be used to spam the delivery
 * provider or run up SMS/WhatsApp costs. Phone codes go by SMS unless
 * `via: 'whatsapp'` - both resolve to the same 'phone' identity.
 */
export async function requestOtp(
  channel: OtpChannel,
  identifier: string,
  ipAddress?: string,
  via?: 'sms' | 'whatsapp'
): Promise<{ expiresInSec: number; delivery: OtpDelivery }> {
  const { otp } = config.auth;
  const delivery = resolveOtpDelivery(channel, via);

  const [recentRows] = await pool.query<OtpCodeRow[]>(
    `SELECT * FROM user_otp_codes
     WHERE channel = ? AND identifier = ? AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [channel, identifier]
  );

  const recent = recentRows[0];
  if (recent && !canBypassCooldown(recent.delivery_method, delivery)) {
    const elapsedSec = (Date.now() - recent.created_at.getTime()) / 1000;
    if (elapsedSec < otp.resendCooldownSec) {
      throw new OtpRateLimitedError(Math.ceil(otp.resendCooldownSec - elapsedSec));
    }
  }

  const code = generateCode(otp.codeLength);
  const expiresAt = new Date(Date.now() + otp.expiresInSec * 1000);

  await pool.query(
    `INSERT INTO user_otp_codes (channel, delivery_method, identifier, code_hash, expires_at, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [channel, delivery, identifier, sha256(code), expiresAt, ipAddress || null]
  );

  await getOtpProvider(delivery).send(identifier, code);

  return { expiresInSec: otp.expiresInSec, delivery };
}

/**
 * Verify a login code and resolve/create the associated user account.
 */
export async function verifyOtp(
  channel: OtpChannel,
  identifier: string,
  code: string
): Promise<User> {
  const { otp } = config.auth;

  const [rows] = await pool.query<OtpCodeRow[]>(
    `SELECT * FROM user_otp_codes
     WHERE channel = ? AND identifier = ? AND consumed_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [channel, identifier]
  );

  const row = rows[0];
  if (!row || row.attempts >= otp.maxAttempts) {
    throw new InvalidOtpError();
  }

  if (row.code_hash !== sha256(code)) {
    await pool.query(`UPDATE user_otp_codes SET attempts = attempts + 1 WHERE id = ?`, [row.id]);
    throw new InvalidOtpError();
  }

  await pool.query(`UPDATE user_otp_codes SET consumed_at = NOW() WHERE id = ?`, [row.id]);

  return findOrCreateUserByIdentity(channel, identifier, true);
}
