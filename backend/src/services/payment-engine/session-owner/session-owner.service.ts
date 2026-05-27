/**
 * Session Owner Service
 *
 * Manages the reusable wallet owner for payment sessions. A session owner is
 * the actor paying crypto into a payment session deposit address.
 */

import { HDChain, Network, SessionOwnerInput } from '../types';

export interface SessionOwnerRecord {
  id: number;
  ownerScope: string;
  ownerRef: string;
  phone?: string;
  walletAddress?: string;
  email?: string;
}

export interface SessionOwnerChainWallet {
  address: string;
  derivationIndex: number;
  hdChain: HDChain;
}

type SessionOwnerWalletColumnSet = {
  hdChain: HDChain;
  addressColumn: string;
  derivationIndexColumn: string;
};

function getSessionOwnerWalletColumns(network: Network): SessionOwnerWalletColumnSet {
  switch (network) {
    case 'bitcoin':
      return {
        hdChain: 'bitcoin',
        addressColumn: 'bitcoin_wallet_address',
        derivationIndexColumn: 'bitcoin_derivation_index',
      };
    case 'tron':
    case 'trc20':
      return {
        hdChain: 'tron',
        addressColumn: 'tron_wallet_address',
        derivationIndexColumn: 'tron_derivation_index',
      };
    case 'ethereum':
    case 'erc20':
    case 'bsc':
    case 'bep20':
    case 'polygon':
    case 'base':
      return {
        hdChain: 'ethereum',
        addressColumn: 'ethereum_wallet_address',
        derivationIndexColumn: 'ethereum_derivation_index',
      };
  }
}

export function getSessionOwnerScope(apiKeyId?: number | null): string {
  return apiKeyId ? `api_key:${apiKeyId}` : 'system';
}

export class SessionOwnerService {
  async getOrCreateSessionOwner(input: SessionOwnerInput): Promise<number> {
    const pool = (await import('../../../lib/mysql')).default;
    const ownerScope = input.ownerScope.trim();
    const ownerRef = input.ownerRef.trim();
    const phone = input.phone?.trim() || null;
    const walletAddress = input.walletAddress?.trim() || null;
    const email = input.email?.trim() || null;

    if (!ownerScope) {
      throw new Error('Session owner scope is required');
    }

    if (!ownerRef) {
      throw new Error('Session owner ref is required');
    }

    const [result] = await pool.query(
      `INSERT INTO session_owners (
         owner_scope, owner_ref, phone, wallet_address, email
       ) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
         phone = COALESCE(VALUES(phone), phone),
         wallet_address = COALESCE(VALUES(wallet_address), wallet_address),
         email = COALESCE(VALUES(email), email)`,
      [ownerScope, ownerRef, phone, walletAddress, email]
    ) as [any, any];

    return Number(result.insertId);
  }

  async getSessionOwnerChainWallet(
    sessionOwnerId: number,
    network: Network
  ): Promise<SessionOwnerChainWallet | null> {
    const pool = (await import('../../../lib/mysql')).default;
    const columns = getSessionOwnerWalletColumns(network);

    const [rows] = await pool.query(
      `SELECT ${columns.addressColumn} AS address,
              ${columns.derivationIndexColumn} AS derivation_index
       FROM session_owners
       WHERE id = ?
       LIMIT 1`,
      [sessionOwnerId]
    ) as [any[], any];

    if (!rows || rows.length === 0 || !rows[0].address || rows[0].derivation_index == null) {
      return null;
    }

    return {
      address: rows[0].address,
      derivationIndex: Number(rows[0].derivation_index),
      hdChain: columns.hdChain,
    };
  }

  async saveSessionOwnerChainWallet(
    sessionOwnerId: number,
    network: Network,
    wallet: SessionOwnerChainWallet
  ): Promise<void> {
    const pool = (await import('../../../lib/mysql')).default;
    const columns = getSessionOwnerWalletColumns(network);

    await pool.query(
      `UPDATE session_owners
       SET ${columns.addressColumn} = ?,
           ${columns.derivationIndexColumn} = ?
       WHERE id = ?`,
      [wallet.address, wallet.derivationIndex, sessionOwnerId]
    );
  }
}

let sessionOwnerServiceInstance: SessionOwnerService | null = null;

export function getSessionOwnerService(): SessionOwnerService {
  if (!sessionOwnerServiceInstance) {
    sessionOwnerServiceInstance = new SessionOwnerService();
  }
  return sessionOwnerServiceInstance;
}

export const sessionOwnerService = getSessionOwnerService();
