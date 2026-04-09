import pool from '../../lib/mysql';
import { generateApiKeyPair, sha256, generateWebhookSecret } from '../utils/crypto';
import {
  ApiKey,
  CreateApiKeyInput,
  ApiKeyWithSecret,
  AuthenticationError,
} from '../types';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { getHDWalletService } from '../../services/payment-engine/hd-wallet';

/**
 * API Key Service
 * Handles API key CRUD operations and validation
 */

interface ApiKeyRow extends RowDataPacket {
  id: number;
  key_id: string;
  key_hash: string;
  merchant_id: string;
  name: string;
  permissions: string | null;
  rate_limit_tier: 'standard' | 'premium' | 'unlimited';
  ip_whitelist: string | null;
  is_active: boolean;
  expires_at: Date | null;
  created_at: Date;
  last_used_at: Date | null;
  // Wallet-as-a-Service fields
  webhook_url: string | null;
  webhook_secret: string | null;
  sweep_address: string | null;
  settlement_mode: 'mongoro' | 'paystack' | 'self';
  // Per-key merchant wallets
  funding_wallet_index: number | null;
  funding_wallet_bitcoin: string | null;
  funding_wallet_ethereum: string | null;
  funding_wallet_tron: string | null;
  parent_wallet_bitcoin: string | null;
  parent_wallet_ethereum: string | null;
  parent_wallet_tron: string | null;
  confirmation_thresholds: string | null;
  is_sandbox: boolean;
}

/**
 * Convert database row to ApiKey object
 */
function rowToApiKey(row: ApiKeyRow): ApiKey {
  // Handle permissions - may already be parsed by mysql2 if using JSON column
  let permissions: string[] = [];
  if (row.permissions) {
    permissions = typeof row.permissions === 'string'
      ? JSON.parse(row.permissions)
      : row.permissions;
  }

  // Handle ipWhitelist - may already be parsed by mysql2 if using JSON column
  let ipWhitelist: string[] | null = null;
  if (row.ip_whitelist) {
    ipWhitelist = typeof row.ip_whitelist === 'string'
      ? JSON.parse(row.ip_whitelist)
      : row.ip_whitelist;
  }

  return {
    id: row.id,
    keyId: row.key_id,
    keyHash: row.key_hash,
    merchantId: row.merchant_id,
    name: row.name,
    permissions,
    rateLimitTier: row.rate_limit_tier,
    ipWhitelist,
    isActive: row.is_active,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    webhookUrl: row.webhook_url,
    webhookSecret: row.webhook_secret,
    sweepAddress: row.sweep_address,
    settlementMode: row.settlement_mode ?? 'paystack',
    fundingWalletIndex: row.funding_wallet_index ?? null,
    fundingWalletBitcoin: row.funding_wallet_bitcoin ?? null,
    fundingWalletEthereum: row.funding_wallet_ethereum ?? null,
    fundingWalletTron: row.funding_wallet_tron ?? null,
    parentWalletBitcoin: row.parent_wallet_bitcoin ?? null,
    parentWalletEthereum: row.parent_wallet_ethereum ?? null,
    parentWalletTron: row.parent_wallet_tron ?? null,
    confirmationThresholds: row.confirmation_thresholds
      ? (typeof row.confirmation_thresholds === 'string'
          ? JSON.parse(row.confirmation_thresholds)
          : row.confirmation_thresholds)
      : null,
    isSandbox: Boolean(row.is_sandbox),
  };
}

/**
 * Create a new API key for a merchant
 * Returns the secret key only once - it cannot be retrieved later
 */
export async function createApiKey(input: CreateApiKeyInput): Promise<ApiKeyWithSecret & { webhookSecret?: string }> {
  const { keyId, secretKey } = generateApiKeyPair(input.isSandbox ?? false);
  const keyHash = sha256(secretKey);

  // Generate webhook secret if webhook URL is provided
  const webhookSecret = input.webhookUrl ? generateWebhookSecret() : null;

  // Allocate merchant funding wallets if HD wallet is enabled
  let fundingWalletIndex: number | null = null;
  let fundingWalletBitcoin: string | null = null;
  let fundingWalletEthereum: string | null = null;
  let fundingWalletTron: string | null = null;

  const hdWallet = getHDWalletService();
  if (hdWallet?.isEnabled()) {
    try {
      const wallets = await hdWallet.allocateMerchantFundingWallets();
      fundingWalletIndex = wallets.index;
      fundingWalletBitcoin = wallets.bitcoin;
      fundingWalletEthereum = wallets.ethereum;
      fundingWalletTron = wallets.tron;
    } catch (err) {
      console.warn('[ApiKey] Failed to allocate merchant funding wallets:', err);
    }
  }

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO api_keys (
      key_id, key_hash, merchant_id, name, permissions, rate_limit_tier,
      ip_whitelist, is_active, is_sandbox, expires_at, webhook_url, webhook_secret, sweep_address,
      settlement_mode, confirmation_thresholds,
      funding_wallet_index, funding_wallet_bitcoin, funding_wallet_ethereum, funding_wallet_tron
    ) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      keyId,
      keyHash,
      input.merchantId,
      input.name,
      input.permissions ? JSON.stringify(input.permissions) : null,
      input.rateLimitTier || 'standard',
      input.ipWhitelist ? JSON.stringify(input.ipWhitelist) : null,
      input.isSandbox ? 1 : 0,
      input.expiresAt || null,
      input.webhookUrl || null,
      webhookSecret,
      input.sweepAddress || null,
      input.settlementMode || 'paystack',
      input.confirmationThresholds ? JSON.stringify(input.confirmationThresholds) : null,
      fundingWalletIndex,
      fundingWalletBitcoin,
      fundingWalletEthereum,
      fundingWalletTron,
    ]
  );

  const apiKey = await getApiKeyById(result.insertId);
  if (!apiKey) {
    throw new Error('Failed to create API key');
  }

  const { keyHash: _, webhookSecret: __, ...apiKeyWithoutSecrets } = apiKey;

  const response: ApiKeyWithSecret & { webhookSecret?: string } = {
    apiKey: apiKeyWithoutSecrets,
    secretKey,
  };

  // Include webhook secret only once at creation time
  if (webhookSecret) {
    response.webhookSecret = webhookSecret;
  }

  return response;
}

/**
 * Get API key by internal ID
 */
export async function getApiKeyById(id: number): Promise<ApiKey | null> {
  const [rows] = await pool.query<ApiKeyRow[]>(
    'SELECT * FROM api_keys WHERE id = ?',
    [id]
  );

  if (rows.length === 0) {
    return null;
  }

  return rowToApiKey(rows[0]);
}

/**
 * Get API key by public key ID
 */
export async function getApiKeyByKeyId(keyId: string): Promise<ApiKey | null> {
  const [rows] = await pool.query<ApiKeyRow[]>(
    'SELECT * FROM api_keys WHERE key_id = ?',
    [keyId]
  );

  if (rows.length === 0) {
    return null;
  }

  return rowToApiKey(rows[0]);
}

/**
 * Validate an API key and secret combination
 * Returns the API key if valid, throws AuthenticationError if not
 */
export async function validateApiKey(keyId: string, secretKey: string): Promise<ApiKey> {
  const apiKey = await getApiKeyByKeyId(keyId);

  if (!apiKey) {
    throw new AuthenticationError('Invalid API key', 'INVALID_API_KEY');
  }

  if (!apiKey.isActive) {
    throw new AuthenticationError('API key is inactive', 'API_KEY_INACTIVE');
  }

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    throw new AuthenticationError('API key has expired', 'API_KEY_EXPIRED');
  }

  const providedHash = sha256(secretKey);
  if (providedHash !== apiKey.keyHash) {
    throw new AuthenticationError('Invalid API key', 'INVALID_API_KEY');
  }

  return apiKey;
}

/**
 * Get API key by key ID (for HMAC validation where we don't have the secret)
 * Validates that the key exists and is active
 */
export async function getActiveApiKey(keyId: string): Promise<ApiKey> {
  const apiKey = await getApiKeyByKeyId(keyId);

  if (!apiKey) {
    throw new AuthenticationError('Invalid API key', 'INVALID_API_KEY');
  }

  if (!apiKey.isActive) {
    throw new AuthenticationError('API key is inactive', 'API_KEY_INACTIVE');
  }

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    throw new AuthenticationError('API key has expired', 'API_KEY_EXPIRED');
  }

  return apiKey;
}

/**
 * Update last used timestamp for an API key
 */
export async function updateLastUsed(keyId: string): Promise<void> {
  await pool.query(
    'UPDATE api_keys SET last_used_at = NOW() WHERE key_id = ?',
    [keyId]
  );
}

/**
 * List API keys for a merchant
 */
export async function listApiKeysByMerchant(merchantId: string): Promise<Omit<ApiKey, 'keyHash'>[]> {
  const [rows] = await pool.query<ApiKeyRow[]>(
    'SELECT * FROM api_keys WHERE merchant_id = ? ORDER BY created_at DESC',
    [merchantId]
  );

  return rows.map((row) => {
    const apiKey = rowToApiKey(row);
    const { keyHash: _, ...rest } = apiKey;
    return rest;
  });
}

/**
 * Revoke (deactivate) an API key
 */
export async function revokeApiKey(keyId: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    'UPDATE api_keys SET is_active = FALSE WHERE key_id = ?',
    [keyId]
  );

  return result.affectedRows > 0;
}

/**
 * Update API key settings
 */
export async function updateApiKey(
  keyId: string,
  updates: {
    name?: string;
    permissions?: string[];
    rateLimitTier?: 'standard' | 'premium' | 'unlimited';
    ipWhitelist?: string[] | null;
    webhookUrl?: string | null;
    sweepAddress?: string | null;
    settlementMode?: 'mongoro' | 'paystack' | 'self';
    confirmationThresholds?: Partial<Record<string, number>> | null;
  }
): Promise<ApiKey | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    setClauses.push('name = ?');
    values.push(updates.name);
  }

  if (updates.permissions !== undefined) {
    setClauses.push('permissions = ?');
    values.push(JSON.stringify(updates.permissions));
  }

  if (updates.rateLimitTier !== undefined) {
    setClauses.push('rate_limit_tier = ?');
    values.push(updates.rateLimitTier);
  }

  if (updates.ipWhitelist !== undefined) {
    setClauses.push('ip_whitelist = ?');
    values.push(updates.ipWhitelist ? JSON.stringify(updates.ipWhitelist) : null);
  }

  if (updates.webhookUrl !== undefined) {
    setClauses.push('webhook_url = ?');
    values.push(updates.webhookUrl);
    // Generate new webhook secret if URL is being set
    if (updates.webhookUrl) {
      setClauses.push('webhook_secret = ?');
      values.push(generateWebhookSecret());
    }
  }

  if (updates.sweepAddress !== undefined) {
    setClauses.push('sweep_address = ?');
    values.push(updates.sweepAddress);
  }

  if (updates.settlementMode !== undefined) {
    setClauses.push('settlement_mode = ?');
    values.push(updates.settlementMode);
  }

  if (updates.confirmationThresholds !== undefined) {
    setClauses.push('confirmation_thresholds = ?');
    values.push(updates.confirmationThresholds ? JSON.stringify(updates.confirmationThresholds) : null);
  }

  if (setClauses.length === 0) {
    return getApiKeyByKeyId(keyId);
  }

  values.push(keyId);

  await pool.query(
    `UPDATE api_keys SET ${setClauses.join(', ')} WHERE key_id = ?`,
    values
  );

  return getApiKeyByKeyId(keyId);
}

/**
 * Check if an API key has a specific permission
 */
export function hasPermission(apiKey: ApiKey, requiredPermission: string): boolean {
  if (!apiKey.permissions || apiKey.permissions.length === 0) {
    return false; // No permissions = no access
  }

  return apiKey.permissions.some((perm) => {
    // Exact match
    if (perm === requiredPermission) return true;

    // Wildcard match (e.g., "transfer.*" matches "transfer.create")
    if (perm.endsWith('.*')) {
      const prefix = perm.slice(0, -2);
      return requiredPermission.startsWith(prefix + '.');
    }

    // Full wildcard
    if (perm === '*') return true;

    return false;
  });
}

/**
 * Get webhook configuration for an API key
 * Returns null if webhook is not configured
 */
export async function getWebhookConfig(apiKeyId: number): Promise<{
  webhookUrl: string;
  webhookSecret: string;
  sweepAddress: string | null;
} | null> {
  const [rows] = await pool.query<ApiKeyRow[]>(
    'SELECT webhook_url, webhook_secret, sweep_address FROM api_keys WHERE id = ? AND is_active = TRUE',
    [apiKeyId]
  );

  if (rows.length === 0 || !rows[0].webhook_url || !rows[0].webhook_secret) {
    return null;
  }

  return {
    webhookUrl: rows[0].webhook_url,
    webhookSecret: rows[0].webhook_secret,
    sweepAddress: rows[0].sweep_address,
  };
}

/**
 * Update parent wallet addresses for an API key (user-provided sweep destinations)
 */
export async function updateParentWallets(
  keyId: string,
  wallets: {
    bitcoin?: string | null;
    ethereum?: string | null;
    tron?: string | null;
  }
): Promise<ApiKey | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (wallets.bitcoin !== undefined) {
    setClauses.push('parent_wallet_bitcoin = ?');
    values.push(wallets.bitcoin);
  }
  if (wallets.ethereum !== undefined) {
    setClauses.push('parent_wallet_ethereum = ?');
    values.push(wallets.ethereum);
  }
  if (wallets.tron !== undefined) {
    setClauses.push('parent_wallet_tron = ?');
    values.push(wallets.tron);
  }

  if (setClauses.length === 0) {
    return getApiKeyByKeyId(keyId);
  }

  values.push(keyId);
  await pool.query(
    `UPDATE api_keys SET ${setClauses.join(', ')} WHERE key_id = ?`,
    values
  );

  return getApiKeyByKeyId(keyId);
}

/**
 * Regenerate webhook secret for an API key
 * Returns the new secret (only shown once)
 */
export async function regenerateWebhookSecret(keyId: string): Promise<string | null> {
  const apiKey = await getApiKeyByKeyId(keyId);
  if (!apiKey || !apiKey.webhookUrl) {
    return null;
  }

  const newSecret = generateWebhookSecret();

  await pool.query(
    'UPDATE api_keys SET webhook_secret = ? WHERE key_id = ?',
    [newSecret, keyId]
  );

  return newSecret;
}
