/**
 * Bitcoin Derivation
 *
 * BIP84 SegWit address derivation (bc1q... addresses).
 * Uses @scure/btc-signer for secure key derivation.
 */

import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { ChainDerivation, KeyMaterial, DERIVATION_PATHS } from '../types';
import { isValidBitcoinAddress } from '../../../../utils/address-validation';

const DERIVATION_PATH_BASE = DERIVATION_PATHS.bitcoin;

/**
 * Bitcoin BIP84 derivation for native SegWit addresses.
 */
export class BitcoinDerivation implements ChainDerivation {
  /**
   * Derive Bitcoin address and keys at given index.
   *
   * @param seed - BIP39 seed bytes (64 bytes)
   * @param index - Derivation index
   * @returns Key material with SegWit address
   */
  derive(seed: Uint8Array, index: number): KeyMaterial {
    const masterKey = HDKey.fromMasterSeed(seed);
    const path = this.getDerivationPath(index);
    const derived = masterKey.derive(path);

    if (!derived.privateKey || !derived.publicKey) {
      throw new Error('Failed to derive Bitcoin keys');
    }

    // Create P2WPKH (native SegWit) address
    const pubkey = derived.publicKey;
    const payment = btc.p2wpkh(pubkey);

    if (!payment.address) {
      throw new Error('Failed to generate Bitcoin address');
    }

    return {
      privateKey: Buffer.from(derived.privateKey).toString('hex'),
      publicKey: Buffer.from(pubkey).toString('hex'),
      address: payment.address,
    };
  }

  /**
   * Get the full derivation path for a given index.
   *
   * @param index - Derivation index
   * @returns Full derivation path (e.g., "m/84'/0'/0'/0/0")
   */
  getDerivationPath(index: number): string {
    return `${DERIVATION_PATH_BASE}/${index}`;
  }

  /**
   * Validate Bitcoin address format.
   * Supports bc1 (SegWit) and legacy (1..., 3...) addresses.
   *
   * @param address - Address to validate
   * @returns True if valid Bitcoin address
   */
  isValidAddress(address: string): boolean {
    // Full bech32/base58check checksum validation (shared with merchant wallets)
    return isValidBitcoinAddress(address);
  }
}

export const bitcoinDerivation = new BitcoinDerivation();
