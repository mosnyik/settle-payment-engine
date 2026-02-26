/**
 * Cryptographic Utilities
 *
 * AES-256-GCM encryption/decryption for seed phrase storage.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt a string using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt
 * @param keyHex - 32-byte key as hex string (64 characters)
 * @returns Encrypted data as base64 string (iv:authTag:ciphertext)
 */
export function encryptAES256(plaintext: string, keyHex: string): string {
  if (keyHex.length !== 64) {
    throw new Error('Encryption key must be 32 bytes (64 hex characters)');
  }

  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt a string using AES-256-GCM.
 *
 * @param encryptedData - Encrypted data as base64 string (iv:authTag:ciphertext)
 * @param keyHex - 32-byte key as hex string (64 characters)
 * @returns Decrypted plaintext
 */
export function decryptAES256(encryptedData: string, keyHex: string): string {
  if (keyHex.length !== 64) {
    throw new Error('Encryption key must be 32 bytes (64 hex characters)');
  }

  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format (expected iv:authTag:ciphertext)');
  }

  const [ivBase64, authTagBase64, ciphertext] = parts;

  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
  }

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: expected ${AUTH_TAG_LENGTH}, got ${authTag.length}`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generate a random 32-byte encryption key.
 *
 * @returns 32-byte key as hex string (64 characters)
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Securely compare two strings in constant time.
 *
 * @param a - First string
 * @param b - Second string
 * @returns True if strings are equal
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }

  return result === 0;
}
