import pool from '../../lib/mysql';
import { generateApiKeyPair, sha256 } from '../utils/crypto';
import {
  ApiKey,
  CreateApiKeyInput,
  ApiKeyWithSecret,
  AuthenticationError,
} from '../types';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

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
}

/**
 * Convert database row to ApiKey object
 */
function rowToApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    keyId: row.key_id,
    keyHash: row.key_hash,
    merchantId: row.merchant_id,
    name: row.name,
    permissions: row.permissions ? JSON.parse(row.permissions) : [],
    rateLimitTier: row.rate_limit_tier,
    ipWhitelist: row.ip_whitelist ? JSON.parse(row.ip_whitelist) : null,
    isActive: row.is_active,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/**
 * Create a new API key for a merchant
 * Returns the secret key only once - it cannot be retrieved later
 */
export async function createApiKey(input: CreateApiKeyInput): Promise<ApiKeyWithSecret> {
  const { keyId, secretKey } = generateApiKeyPair();
  const keyHash = sha256(secretKey);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO api_keys (key_id, key_hash, merchant_id, name, permissions, rate_limit_tier, ip_whitelist, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      keyId,
      keyHash,
      input.merchantId,
      input.name,
      input.permissions ? JSON.stringify(input.permissions) : null,
      input.rateLimitTier || 'standard',
      input.ipWhitelist ? JSON.stringify(input.ipWhitelist) : null,
      input.expiresAt || null,
    ]
  );

  const apiKey = await getApiKeyById(result.insertId);
  if (!apiKey) {
    throw new Error('Failed to create API key');
  }

  const { keyHash: _, ...apiKeyWithoutHash } = apiKey;

  return {
    apiKey: apiKeyWithoutHash,
    secretKey,
  };
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
    return true; // No permissions = all access
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
