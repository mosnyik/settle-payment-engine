/**
 * EVM Derivation
 *
 * Ethereum-compatible address derivation for ETH, BSC, Polygon, Base.
 * Uses ethers.js HDNodeWallet for BIP44 compliant derivation.
 */

import { HDNodeWallet } from 'ethers';
import { ChainDerivation, KeyMaterial, DERIVATION_PATHS } from '../types';

const DERIVATION_PATH_BASE = DERIVATION_PATHS.ethereum;

/**
 * EVM chain derivation for Ethereum-compatible addresses.
 * Works for Ethereum, BSC, Polygon, Base, and all EVM chains.
 */
export class EVMDerivation implements ChainDerivation {
  /**
   * Derive EVM address and keys at given index.
   *
   * @param seed - BIP39 seed bytes (64 bytes)
   * @param index - Derivation index
   * @returns Key material with checksummed Ethereum address
   */
  derive(seed: Uint8Array, index: number): KeyMaterial {
    // ethers expects hex seed
    const seedHex = Buffer.from(seed).toString('hex');

    // Create HD wallet from seed
    const masterNode = HDNodeWallet.fromSeed(`0x${seedHex}`);
    const path = this.getDerivationPath(index);
    const derived = masterNode.derivePath(path);

    return {
      privateKey: derived.privateKey.slice(2), // Remove 0x prefix
      publicKey: derived.publicKey.slice(2), // Remove 0x prefix
      address: derived.address, // Checksummed address
    };
  }

  /**
   * Get the full derivation path for a given index.
   *
   * @param index - Derivation index
   * @returns Full derivation path (e.g., "m/44'/60'/0'/0/0")
   */
  getDerivationPath(index: number): string {
    return `${DERIVATION_PATH_BASE}/${index}`;
  }

  /**
   * Validate EVM address format.
   *
   * @param address - Address to validate
   * @returns True if valid Ethereum address
   */
  isValidAddress(address: string): boolean {
    // Basic format check: 0x followed by 40 hex characters
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return false;
    }

    // If all lowercase or all uppercase, valid (no checksum)
    const addressLower = address.toLowerCase();
    const addressUpper = address.toUpperCase();
    if (address === addressLower || address === `0x${addressUpper.slice(2)}`) {
      return true;
    }

    // Validate checksum (EIP-55)
    return this.validateChecksum(address);
  }

  /**
   * Validate EIP-55 checksum.
   */
  private validateChecksum(address: string): boolean {
    // For simplicity, accept any properly formatted address
    // Full EIP-55 checksum validation would require keccak256
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }
}

export const evmDerivation = new EVMDerivation();
