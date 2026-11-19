/**
 * EVM Derivation
 *
 * Ethereum-compatible address derivation for ETH, BSC, Polygon, Base.
 * Uses ethers.js HDNodeWallet for BIP44 compliant derivation.
 */

import { HDNodeWallet } from 'ethers';
import { ChainDerivation, KeyMaterial, DERIVATION_PATHS } from '../types';
import { isValidEvmAddress } from '../../../../utils/address-validation';

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
    // EIP-55 checksum validation (shared with merchant wallets)
    return isValidEvmAddress(address);
  }

}

export const evmDerivation = new EVMDerivation();
