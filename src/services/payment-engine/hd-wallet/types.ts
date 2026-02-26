/**
 * HD Wallet Types
 *
 * Type definitions for hierarchical deterministic wallet derivation.
 */

import { Network } from '../types';

// =============================================================================
// CHAIN TYPES
// =============================================================================

/** HD wallet chain types - maps to derivation path families */
export type HDChain = 'bitcoin' | 'ethereum' | 'tron';

/** Map network to its HD chain for derivation */
export const NETWORK_TO_HD_CHAIN: Record<Network, HDChain> = {
  bitcoin: 'bitcoin',
  ethereum: 'ethereum',
  bsc: 'ethereum', // Same derivation path as ETH (m/44'/60')
  polygon: 'ethereum',
  base: 'ethereum',
  erc20: 'ethereum',
  bep20: 'ethereum',
  tron: 'tron',
  trc20: 'tron',
};

/** Derivation paths per chain (BIP44/BIP84 compliant) */
export const DERIVATION_PATHS: Record<HDChain, string> = {
  bitcoin: "m/84'/0'/0'/0", // BIP84 SegWit (bc1q...)
  ethereum: "m/44'/60'/0'/0", // BIP44 Ethereum (0x...)
  tron: "m/44'/195'/0'/0", // BIP44 Tron (T...)
};

// =============================================================================
// DERIVATION TYPES
// =============================================================================

/** Result of deriving a new address */
export interface DerivationResult {
  address: string;
  derivationIndex: number;
  chain: HDChain;
  derivationPath: string;
}

/** HD wallet configuration from database */
export interface HDWalletConfig {
  id: number;
  chain: HDChain;
  derivationPathBase: string;
  nextIndex: number;
  hotWalletAddress: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Derived address record from database */
export interface DerivedAddress {
  id: number;
  chain: HDChain;
  derivationIndex: number;
  address: string;
  sessionId: string | null;
  derivedAt: Date;
  sweptAt: Date | null;
  sweepTxHash: string | null;
}

// =============================================================================
// KEY TYPES
// =============================================================================

/** Key material for signing transactions */
export interface KeyMaterial {
  privateKey: string;
  publicKey: string;
  address: string;
}

/** Chain-specific derivation interface */
export interface ChainDerivation {
  /** Derive address and keys at given index */
  derive(seed: Uint8Array, index: number): KeyMaterial;

  /** Get the derivation path for a given index */
  getDerivationPath(index: number): string;

  /** Validate an address format */
  isValidAddress(address: string): boolean;
}

// =============================================================================
// SERVICE TYPES
// =============================================================================

/** HD Wallet service configuration */
export interface HDWalletServiceConfig {
  enabled: boolean;
  seedEncrypted: string;
  seedEncryptionKey: string;
}

/** Hot wallet addresses per chain */
export interface HotWalletAddresses {
  bitcoin: string;
  ethereum: string;
  tron: string;
}
