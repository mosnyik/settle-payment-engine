/**
 * Wallet Auth Service
 * SIWE-style login: the server issues a nonce + message, the client signs it
 * with their wallet's private key, and the server verifies the recovered
 * address matches - proving ownership without the private key ever leaving
 * the client.
 */

import { ethers } from 'ethers';
import pool from '../../../lib/mysql';
import { RowDataPacket } from 'mysql2';
import { generateSecureToken } from '../../../security/utils/crypto';
import config from '../../../config';
import { User, UserIdentity } from '../types';
import { InvalidWalletSignatureError, WalletNonceExpiredError } from '../errors';
import { findOrCreateUserByIdentity, linkIdentityToUser } from './user.service';

interface WalletNonceRow extends RowDataPacket {
  id: number;
  wallet_address: string;
  nonce: string;
  message: string;
  consumed_at: Date | null;
  expires_at: Date;
}

function normalizeAddress(address: string): string {
  try {
    return ethers.getAddress(address).toLowerCase();
  } catch {
    throw new InvalidWalletSignatureError('Invalid wallet address');
  }
}

/**
 * Issue a fresh nonce + message for a wallet address to sign.
 */
export async function createNonce(address: string): Promise<{ nonce: string; message: string; expiresInSec: number }> {
  const normalized = normalizeAddress(address);
  const { wallet } = config.auth;

  const nonce = generateSecureToken(16);
  const message = [
    wallet.messageStatement,
    '',
    `Address: ${normalized}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join('\n');

  const expiresAt = new Date(Date.now() + wallet.nonceExpiresInSec * 1000);

  await pool.query(
    `INSERT INTO user_wallet_nonces (wallet_address, nonce, message, expires_at) VALUES (?, ?, ?, ?)`,
    [normalized, nonce, message, expiresAt]
  );

  return { nonce, message, expiresInSec: wallet.nonceExpiresInSec };
}

/**
 * Check a signed nonce message and consume it. Shared by login and
 * account-linking — recovering and validating the signer is the same
 * operation either way; what differs is what the caller does with the
 * proven address afterward. Returns the normalized (checksummed, lowercased)
 * address.
 */
async function consumeValidSignature(address: string, signature: string): Promise<string> {
  const normalized = normalizeAddress(address);

  const [rows] = await pool.query<WalletNonceRow[]>(
    `SELECT * FROM user_wallet_nonces
     WHERE wallet_address = ? AND consumed_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [normalized]
  );

  const row = rows[0];
  if (!row) {
    throw new WalletNonceExpiredError();
  }

  let recovered: string;
  try {
    recovered = ethers.verifyMessage(row.message, signature);
  } catch {
    throw new InvalidWalletSignatureError();
  }

  if (recovered.toLowerCase() !== normalized) {
    throw new InvalidWalletSignatureError();
  }

  await pool.query(`UPDATE user_wallet_nonces SET consumed_at = NOW() WHERE id = ?`, [row.id]);

  return normalized;
}

/**
 * Verify a signed nonce message and resolve/create the associated user account.
 */
export async function verifySignature(address: string, signature: string): Promise<User> {
  const normalized = await consumeValidSignature(address, signature);
  return findOrCreateUserByIdentity('wallet', normalized, true);
}

/**
 * Verify a signed nonce message and link the wallet to an already-authenticated
 * user's account instead of resolving/creating a separate one. Request the
 * nonce via the same public POST /v1/users/auth/wallet/nonce — there's no
 * linking-specific nonce step.
 */
export async function verifySignatureForLinking(
  userId: string,
  address: string,
  signature: string
): Promise<UserIdentity> {
  const normalized = await consumeValidSignature(address, signature);
  return linkIdentityToUser(userId, 'wallet', normalized);
}
