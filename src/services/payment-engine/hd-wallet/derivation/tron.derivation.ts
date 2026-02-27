/**
 * Tron Derivation
 *
 * TRON address derivation using BIP44 path m/44'/195'/0'/0/{index}.
 * Uses TronWeb for address generation.
 */

import { HDKey } from '@scure/bip32';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { ChainDerivation, KeyMaterial, DERIVATION_PATHS } from '../types';

const DERIVATION_PATH_BASE = DERIVATION_PATHS.tron;

// Base58 alphabet for Tron
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encode bytes to Base58Check (Tron address format).
 */
function base58CheckEncode(data: Uint8Array): string {
  // Double SHA256 for checksum
  const sha256 = async (data: Uint8Array): Promise<Uint8Array> => {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hashBuffer);
  };

  // Synchronous SHA256 using crypto module
  const { createHash } = require('crypto');
  const hash1 = createHash('sha256').update(data).digest();
  const hash2 = createHash('sha256').update(hash1).digest();
  const checksum = hash2.slice(0, 4);

  // Append checksum
  const payload = Buffer.concat([Buffer.from(data), checksum]);

  // Convert to Base58
  let num = BigInt('0x' + Buffer.from(payload).toString('hex'));
  let result = '';

  while (num > 0n) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    result = BASE58_ALPHABET[remainder] + result;
  }

  // Add leading zeros
  for (const byte of payload) {
    if (byte === 0) {
      result = '1' + result;
    } else {
      break;
    }
  }

  return result;
}

/**
 * Tron derivation for T... addresses.
 */
export class TronDerivation implements ChainDerivation {
  /**
   * Derive Tron address and keys at given index.
   *
   * @param seed - BIP39 seed bytes (64 bytes)
   * @param index - Derivation index
   * @returns Key material with Tron address (T...)
   */
  derive(seed: Uint8Array, index: number): KeyMaterial {
    const masterKey = HDKey.fromMasterSeed(seed);
    const path = this.getDerivationPath(index);
    const derived = masterKey.derive(path);

    if (!derived.privateKey || !derived.publicKey) {
      throw new Error('Failed to derive Tron keys');
    }

    // Get uncompressed public key (65 bytes: 04 + x + y)
    // @scure/bip32 gives compressed pubkey, we need to decompress
    const privateKeyHex = Buffer.from(derived.privateKey).toString('hex');
    const address = this.privateKeyToAddress(privateKeyHex);

    return {
      privateKey: privateKeyHex,
      publicKey: Buffer.from(derived.publicKey).toString('hex'),
      address,
    };
  }

  /**
   * Convert private key to Tron address.
   */
  private privateKeyToAddress(privateKeyHex: string): string {
    // Use secp256k1 to get public key
    const { secp256k1 } = require('@noble/curves/secp256k1');

    const privateKey = Buffer.from(privateKeyHex, 'hex');
    const publicKey = secp256k1.getPublicKey(privateKey, false); // Uncompressed

    // Keccak256 of public key (without 04 prefix)
    const pubKeyWithoutPrefix = publicKey.slice(1);
    const hash = keccak_256(pubKeyWithoutPrefix);

    // Take last 20 bytes and add Tron prefix (0x41)
    const addressBytes = new Uint8Array(21);
    addressBytes[0] = 0x41; // Tron mainnet prefix
    addressBytes.set(hash.slice(12), 1);

    // Base58Check encode
    return base58CheckEncode(addressBytes);
  }

  /**
   * Get the full derivation path for a given index.
   *
   * @param index - Derivation index
   * @returns Full derivation path (e.g., "m/44'/195'/0'/0/0")
   */
  getDerivationPath(index: number): string {
    return `${DERIVATION_PATH_BASE}/${index}`;
  }

  /**
   * Validate Tron address format.
   *
   * @param address - Address to validate
   * @returns True if valid Tron address
   */
  isValidAddress(address: string): boolean {
    // Tron addresses start with T and are 34 characters
    if (!address.startsWith('T') || address.length !== 34) {
      return false;
    }

    // Check Base58 characters
    for (const char of address) {
      if (!BASE58_ALPHABET.includes(char)) {
        return false;
      }
    }

    return true;
  }
}

export const tronDerivation = new TronDerivation();
