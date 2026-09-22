/**
 * User Service
 * Handles user account + identity lookup, creation, and linking.
 */

import pool from '../../../lib/mysql';
import { RowDataPacket } from 'mysql2';
import { generateUUID } from '../../../security/utils/crypto';
import { IdentityType, User, UserIdentity } from '../types';
import { IdentityAlreadyLinkedError, UserNotFoundError } from '../errors';

interface UserRow extends RowDataPacket {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  status: 'active' | 'suspended';
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface UserIdentityRow extends RowDataPacket {
  id: number;
  user_id: string;
  type: IdentityType;
  identifier: string;
  verified_at: Date | null;
  created_at: Date;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    status: row.status,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToIdentity(row: UserIdentityRow): UserIdentity {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    identifier: row.identifier,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  };
}

export async function getUserById(userId: string): Promise<User | null> {
  const [rows] = await pool.query<UserRow[]>(`SELECT * FROM users WHERE id = ?`, [userId]);
  return rows.length ? rowToUser(rows[0]) : null;
}

export async function getIdentity(type: IdentityType, identifier: string): Promise<UserIdentity | null> {
  const [rows] = await pool.query<UserIdentityRow[]>(
    `SELECT * FROM user_identities WHERE type = ? AND identifier = ?`,
    [type, identifier]
  );
  return rows.length ? rowToIdentity(rows[0]) : null;
}

export async function getIdentitiesForUser(userId: string): Promise<UserIdentity[]> {
  const [rows] = await pool.query<UserIdentityRow[]>(
    `SELECT * FROM user_identities WHERE user_id = ? ORDER BY created_at ASC`,
    [userId]
  );
  return rows.map(rowToIdentity);
}

async function createUser(displayName: string | null = null, avatarUrl: string | null = null): Promise<User> {
  const id = generateUUID();
  await pool.query(
    `INSERT INTO users (id, display_name, avatar_url) VALUES (?, ?, ?)`,
    [id, displayName, avatarUrl]
  );
  const user = await getUserById(id);
  return user!;
}

export async function linkIdentity(
  userId: string,
  type: IdentityType,
  identifier: string,
  verified: boolean
): Promise<void> {
  await pool.query(
    `INSERT INTO user_identities (user_id, type, identifier, verified_at) VALUES (?, ?, ?, ?)`,
    [userId, type, identifier, verified ? new Date() : null]
  );
}

export async function markIdentityVerified(identityId: number): Promise<void> {
  await pool.query(
    `UPDATE user_identities SET verified_at = COALESCE(verified_at, NOW()) WHERE id = ?`,
    [identityId]
  );
}

/**
 * Find the user already linked to (type, identifier), or create a brand new
 * user + identity pair. Used by the OTP and wallet login flows, where the
 * identity is the sole signal of account ownership.
 */
export async function findOrCreateUserByIdentity(
  type: IdentityType,
  identifier: string,
  verified: boolean
): Promise<User> {
  const existing = await getIdentity(type, identifier);
  if (existing) {
    if (verified && !existing.verifiedAt) {
      await markIdentityVerified(existing.id);
    }
    const user = await getUserById(existing.userId);
    return user!;
  }

  const user = await createUser();
  await linkIdentity(user.id, type, identifier, verified);
  return user;
}

/**
 * Attach a newly-proven identity (phone/email/wallet) to the currently
 * authenticated user's account, once the caller has already verified
 * ownership (OTP code or wallet signature checked out).
 *
 * Idempotent if the identity already belongs to this same user. Rejects if
 * it belongs to a different account — cross-account takeover is not allowed
 * here, unlike the Google login flow's automatic email match, which is safe
 * only because Google itself attests the email.
 */
export async function linkIdentityToUser(
  userId: string,
  type: IdentityType,
  identifier: string
): Promise<UserIdentity> {
  const existing = await getIdentity(type, identifier);

  if (existing) {
    if (existing.userId !== userId) {
      throw new IdentityAlreadyLinkedError(type);
    }
    if (!existing.verifiedAt) {
      await markIdentityVerified(existing.id);
    }
    return (await getIdentity(type, identifier))!;
  }

  await linkIdentity(userId, type, identifier, true);
  return (await getIdentity(type, identifier))!;
}

/**
 * Google-specific variant: if the Google account's email is verified and
 * already matches an existing email identity, link the Google identity to
 * that same user instead of creating a new account. Google itself attests
 * email ownership, so this is the one case where cross-method linking is safe
 * to do automatically.
 */
export async function findOrCreateUserForGoogle(
  googleId: string,
  email: string | null,
  emailVerified: boolean,
  displayName: string | null,
  avatarUrl: string | null
): Promise<User> {
  const existingGoogleIdentity = await getIdentity('google', googleId);
  if (existingGoogleIdentity) {
    const user = await getUserById(existingGoogleIdentity.userId);
    return user!;
  }

  if (email && emailVerified) {
    const existingEmailIdentity = await getIdentity('email', email);
    if (existingEmailIdentity) {
      await linkIdentity(existingEmailIdentity.userId, 'google', googleId, true);
      return (await getUserById(existingEmailIdentity.userId))!;
    }
  }

  const user = await createUser(displayName, avatarUrl);
  await linkIdentity(user.id, 'google', googleId, true);
  if (email && emailVerified) {
    await linkIdentity(user.id, 'email', email, true);
  }
  return user;
}

export async function touchLastLogin(userId: string): Promise<void> {
  await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [userId]);
}

/**
 * Partial update of the caller's own profile — only the fields present in
 * `updates` are touched, so a client can send just displayName or just
 * avatarUrl without clobbering the other.
 */
export async function updateUserProfile(
  userId: string,
  updates: { displayName?: string | null; avatarUrl?: string | null }
): Promise<User> {
  const columns: string[] = [];
  const values: (string | null)[] = [];

  if (updates.displayName !== undefined) {
    columns.push('display_name = ?');
    values.push(updates.displayName);
  }
  if (updates.avatarUrl !== undefined) {
    columns.push('avatar_url = ?');
    values.push(updates.avatarUrl);
  }

  if (columns.length > 0) {
    await pool.query(`UPDATE users SET ${columns.join(', ')} WHERE id = ?`, [...values, userId]);
  }

  const user = await getUserById(userId);
  if (!user) throw new UserNotFoundError();
  return user;
}
