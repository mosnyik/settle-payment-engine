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
import { OtpChannel, User, UserIdentity } from '../types';
import { InvalidOtpError, OtpRateLimitedError } from '../errors';
import { getOtpProvider } from '../otp/providers';
import { findOrCreateUserByIdentity, linkIdentityToUser } from './user.service';

interface OtpCodeRow extends RowDataPacket {
  id: number;
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
 * Request a login code for an email/phone identifier. Enforces a resend
 * cooldown so a single identifier can't be used to spam the delivery
 * provider or run up SMS costs.
 */
export async function requestOtp(
  channel: OtpChannel,
  identifier: string,
  ipAddress?: string
): Promise<{ expiresInSec: number }> {
  const { otp } = config.auth;

  const [recentRows] = await pool.query<OtpCodeRow[]>(
    `SELECT * FROM user_otp_codes
     WHERE channel = ? AND identifier = ? AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [channel, identifier]
  );

  const recent = recentRows[0];
  if (recent) {
    const elapsedSec = (Date.now() - recent.created_at.getTime()) / 1000;
    if (elapsedSec < otp.resendCooldownSec) {
      throw new OtpRateLimitedError(Math.ceil(otp.resendCooldownSec - elapsedSec));
    }
  }

  const code = generateCode(otp.codeLength);
  const expiresAt = new Date(Date.now() + otp.expiresInSec * 1000);

  await pool.query(
    `INSERT INTO user_otp_codes (channel, identifier, code_hash, expires_at, ip_address)
     VALUES (?, ?, ?, ?, ?)`,
    [channel, identifier, sha256(code), expiresAt, ipAddress || null]
  );

  await getOtpProvider(channel).send(identifier, code);

  // TEMPORARY: also surface email codes in the server log so you can log in
  // yourself without waiting on SMS (blocked pending MNO approval). Remove
  // once phone delivery is live — this prints a real login code to logs.
  if (channel === 'email') {
    console.log(`[OTP:email] code for ${identifier}: ${code}`);
  }

  return { expiresInSec: otp.expiresInSec };
}

/**
 * Check a submitted code against the most recent unconsumed one for this
 * identifier and consume it. Shared by login and account-linking — proving
 * control of the identifier is the same operation either way; what differs
 * is what the caller does with that proof afterward.
 */
async function consumeValidOtp(
  channel: OtpChannel,
  identifier: string,
  code: string
): Promise<void> {
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
}

/**
 * Verify a login code and resolve/create the associated user account.
 */
export async function verifyOtp(
  channel: OtpChannel,
  identifier: string,
  code: string
): Promise<User> {
  await consumeValidOtp(channel, identifier, code);
  return findOrCreateUserByIdentity(channel, identifier, true);
}

/**
 * Verify a code and link the identifier to an already-authenticated user's
 * account instead of resolving/creating a separate one. Request the code via
 * the same public POST /v1/users/auth/otp/request — there's no
 * linking-specific send step.
 */
export async function verifyOtpForLinking(
  userId: string,
  channel: OtpChannel,
  identifier: string,
  code: string
): Promise<UserIdentity> {
  await consumeValidOtp(channel, identifier, code);
  return linkIdentityToUser(userId, channel, identifier);
}
