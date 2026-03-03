/**
 * Wallet Repository
 * Database operations for watched wallets
 */

import pool from '../../lib/mysql';
import { WatchedWallet, WalletStatus } from './types';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import crypto from 'crypto';

interface WalletRow extends RowDataPacket {
  id: string;
  api_key_id: number;
  address: string;
  network: string;
  crypto: string;
  derivation_index: number;
  hd_chain: string;
  status: WalletStatus;
  tx_hash: string | null;
  amount: number | null;
  confirmations: number;
  detected_at: Date | null;
  confirmed_at: Date | null;
  sweep_tx_hash: string | null;
  swept_at: Date | null;
  webhook_deposit_sent: boolean;
  webhook_confirmed_sent: boolean;
  webhook_last_error: string | null;
  webhook_retry_count: number;
  metadata: string | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
}

function rowToWallet(row: WalletRow): WatchedWallet {
  // Handle metadata - may already be parsed by mysql2 if using JSON column
  let metadata: Record<string, unknown> | undefined;
  if (row.metadata) {
    metadata = typeof row.metadata === 'string'
      ? JSON.parse(row.metadata)
      : row.metadata;
  }

  return {
    id: row.id,
    apiKeyId: row.api_key_id,
    address: row.address,
    network: row.network,
    crypto: row.crypto,
    derivationIndex: row.derivation_index,
    hdChain: row.hd_chain,
    status: row.status,
    txHash: row.tx_hash || undefined,
    amount: row.amount ? Number(row.amount) : undefined,
    confirmations: row.confirmations,
    detectedAt: row.detected_at || undefined,
    confirmedAt: row.confirmed_at || undefined,
    sweepTxHash: row.sweep_tx_hash || undefined,
    sweptAt: row.swept_at || undefined,
    webhookDepositSent: row.webhook_deposit_sent,
    webhookConfirmedSent: row.webhook_confirmed_sent,
    webhookLastError: row.webhook_last_error || undefined,
    webhookRetryCount: row.webhook_retry_count,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at || undefined,
  };
}

/**
 * Generate a unique wallet ID
 */
export function generateWalletId(): string {
  const random = crypto.randomBytes(12).toString('base64url');
  return `wal_${random}`;
}

export interface CreateWalletData {
  apiKeyId: number;
  address: string;
  network: string;
  crypto: string;
  derivationIndex: number;
  hdChain: string;
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
}

/**
 * Create a new watched wallet
 */
export async function createWallet(data: CreateWalletData): Promise<WatchedWallet> {
  const id = generateWalletId();

  await pool.query(
    `INSERT INTO watched_wallets (
      id, api_key_id, address, network, crypto,
      derivation_index, hd_chain, metadata, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.apiKeyId,
      data.address,
      data.network,
      data.crypto,
      data.derivationIndex,
      data.hdChain,
      data.metadata ? JSON.stringify(data.metadata) : null,
      data.expiresAt || null,
    ]
  );

  const wallet = await getWalletById(id);
  if (!wallet) {
    throw new Error('Failed to create wallet');
  }

  return wallet;
}

/**
 * Get wallet by ID
 */
export async function getWalletById(id: string): Promise<WatchedWallet | null> {
  const [rows] = await pool.query<WalletRow[]>(
    'SELECT * FROM watched_wallets WHERE id = ?',
    [id]
  );

  if (rows.length === 0) {
    return null;
  }

  return rowToWallet(rows[0]);
}

/**
 * Get wallet by address and network
 */
export async function getWalletByAddress(
  address: string,
  network: string
): Promise<WatchedWallet | null> {
  const [rows] = await pool.query<WalletRow[]>(
    'SELECT * FROM watched_wallets WHERE address = ? AND network = ?',
    [address, network]
  );

  if (rows.length === 0) {
    return null;
  }

  return rowToWallet(rows[0]);
}

/**
 * List wallets by API key
 */
export async function listWalletsByApiKey(
  apiKeyId: number,
  options: {
    status?: WalletStatus;
    limit?: number;
    offset?: number;
  } = {}
): Promise<WatchedWallet[]> {
  const { status, limit = 100, offset = 0 } = options;

  let sql = 'SELECT * FROM watched_wallets WHERE api_key_id = ?';
  const params: unknown[] = [apiKeyId];

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const [rows] = await pool.query<WalletRow[]>(sql, params);

  return rows.map(rowToWallet);
}

/**
 * Get all wallets with 'watching' status for the watcher
 */
export async function getWatchingWallets(): Promise<WatchedWallet[]> {
  const [rows] = await pool.query<WalletRow[]>(
    `SELECT * FROM watched_wallets
     WHERE status = 'watching'
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at ASC`
  );

  return rows.map(rowToWallet);
}

/**
 * Update wallet status and deposit info
 */
export async function updateWalletDeposit(
  id: string,
  data: {
    status: WalletStatus;
    txHash?: string;
    amount?: number;
    confirmations?: number;
    detectedAt?: Date;
    confirmedAt?: Date;
  }
): Promise<WatchedWallet | null> {
  const updates: string[] = ['status = ?'];
  const values: unknown[] = [data.status];

  if (data.txHash !== undefined) {
    updates.push('tx_hash = ?');
    values.push(data.txHash);
  }
  if (data.amount !== undefined) {
    updates.push('amount = ?');
    values.push(data.amount);
  }
  if (data.confirmations !== undefined) {
    updates.push('confirmations = ?');
    values.push(data.confirmations);
  }
  if (data.detectedAt !== undefined) {
    updates.push('detected_at = ?');
    values.push(data.detectedAt);
  }
  if (data.confirmedAt !== undefined) {
    updates.push('confirmed_at = ?');
    values.push(data.confirmedAt);
  }

  values.push(id);

  await pool.query(
    `UPDATE watched_wallets SET ${updates.join(', ')} WHERE id = ?`,
    values
  );

  return getWalletById(id);
}

/**
 * Update wallet sweep info
 */
export async function updateWalletSweep(
  id: string,
  sweepTxHash: string
): Promise<WatchedWallet | null> {
  await pool.query(
    `UPDATE watched_wallets
     SET status = 'swept', sweep_tx_hash = ?, swept_at = NOW()
     WHERE id = ?`,
    [sweepTxHash, id]
  );

  return getWalletById(id);
}

/**
 * Update webhook delivery status
 */
export async function updateWebhookStatus(
  id: string,
  data: {
    webhookDepositSent?: boolean;
    webhookConfirmedSent?: boolean;
    webhookLastError?: string;
    webhookRetryCount?: number;
  }
): Promise<void> {
  const updates: string[] = [];
  const values: unknown[] = [];

  if (data.webhookDepositSent !== undefined) {
    updates.push('webhook_deposit_sent = ?');
    values.push(data.webhookDepositSent);
  }
  if (data.webhookConfirmedSent !== undefined) {
    updates.push('webhook_confirmed_sent = ?');
    values.push(data.webhookConfirmedSent);
  }
  if (data.webhookLastError !== undefined) {
    updates.push('webhook_last_error = ?');
    values.push(data.webhookLastError);
  }
  if (data.webhookRetryCount !== undefined) {
    updates.push('webhook_retry_count = ?');
    values.push(data.webhookRetryCount);
  }

  if (updates.length === 0) return;

  values.push(id);

  await pool.query(
    `UPDATE watched_wallets SET ${updates.join(', ')} WHERE id = ?`,
    values
  );
}

/**
 * Get wallets needing webhook retry
 */
export async function getWalletsNeedingWebhook(): Promise<WatchedWallet[]> {
  const [rows] = await pool.query<WalletRow[]>(
    `SELECT * FROM watched_wallets
     WHERE (
       (status = 'deposit_detected' AND webhook_deposit_sent = FALSE)
       OR (status IN ('confirmed', 'swept') AND webhook_confirmed_sent = FALSE)
     )
     AND webhook_retry_count < 5
     ORDER BY created_at ASC`
  );

  return rows.map(rowToWallet);
}

/**
 * Expire old watching wallets
 */
export async function expireOldWallets(): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE watched_wallets
     SET status = 'expired'
     WHERE status = 'watching'
       AND expires_at IS NOT NULL
       AND expires_at < NOW()`
  );

  return result.affectedRows;
}
