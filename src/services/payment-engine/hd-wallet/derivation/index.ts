/**
 * Chain Derivation Index
 *
 * Exports all chain-specific derivation implementations.
 */

export { BitcoinDerivation, bitcoinDerivation } from './bitcoin.derivation';
export { EVMDerivation, evmDerivation } from './evm.derivation';
export { TronDerivation, tronDerivation } from './tron.derivation';

import { ChainDerivation, HDChain } from '../types';
import { bitcoinDerivation } from './bitcoin.derivation';
import { evmDerivation } from './evm.derivation';
import { tronDerivation } from './tron.derivation';

/**
 * Get the derivation implementation for a given chain.
 *
 * @param chain - HD chain type
 * @returns Chain derivation implementation
 */
export function getDerivation(chain: HDChain): ChainDerivation {
  switch (chain) {
    case 'bitcoin':
      return bitcoinDerivation;
    case 'ethereum':
      return evmDerivation;
    case 'tron':
      return tronDerivation;
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}
