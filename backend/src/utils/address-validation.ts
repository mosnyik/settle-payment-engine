/**
 * Mainnet wallet address validation with full checksum verification.
 *
 * Used for addresses typed in by people (merchant collection wallets), where
 * a one-character typo would send real funds to an address nobody controls.
 * Prefix/length regexes are not enough for that - every check here decodes
 * the address and verifies its checksum.
 *
 * - Bitcoin: bech32/bech32m (bc1q / bc1p) and base58check (1... / 3...),
 *   mainnet only (testnet tb1/m/n/2 are rejected).
 * - EVM (ETH, BNB, ERC20, BEP20): 0x + 40 hex; mixed-case must pass EIP-55.
 *   The zero address is rejected.
 * - Tron: base58check "T..." form with the 0x41 mainnet prefix.
 */

import * as btc from '@scure/btc-signer';
import { isAddress as isEvmAddressLib, ZeroAddress } from 'ethers';
import { TronWeb } from 'tronweb';
import type { Network } from '../services/payment-engine/types';

/** The three address families a wallet can belong to. */
export type WalletChain = 'bitcoin' | 'ethereum' | 'tron';

const bitcoinMainnet = btc.Address(btc.NETWORK);

export function isValidBitcoinAddress(address: string): boolean {
  if (typeof address !== 'string' || address !== address.trim() || !address) return false;
  try {
    bitcoinMainnet.decode(address);
    return true;
  } catch {
    return false;
  }
}

export function isValidEvmAddress(address: string): boolean {
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  if (address.toLowerCase() === ZeroAddress) return false;
  // ethers accepts all-lower / all-upper, and enforces EIP-55 on mixed case
  return isEvmAddressLib(address);
}

export function isValidTronAddress(address: string): boolean {
  // TronWeb.isAddress also accepts the hex "41..." form; only the base58 T-form
  // is something a merchant should be pasting.
  if (typeof address !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return false;
  try {
    return TronWeb.isAddress(address);
  } catch {
    return false;
  }
}

export function isValidAddressForChain(chain: WalletChain, address: string): boolean {
  switch (chain) {
    case 'bitcoin':
      return isValidBitcoinAddress(address);
    case 'ethereum':
      return isValidEvmAddress(address);
    case 'tron':
      return isValidTronAddress(address);
  }
}

/** Which address family a network's deposit address belongs to. */
export function walletChainForNetwork(network: Network): WalletChain {
  switch (network) {
    case 'bitcoin':
      return 'bitcoin';
    case 'tron':
    case 'trc20':
      return 'tron';
    case 'ethereum':
    case 'erc20':
    case 'bsc':
    case 'bep20':
    case 'polygon':
    case 'base':
      return 'ethereum';
  }
}

export const WALLET_CHAIN_LABEL: Record<WalletChain, string> = {
  bitcoin: 'Bitcoin mainnet',
  ethereum: 'EVM (ETH/BSC)',
  tron: 'Tron mainnet',
};
