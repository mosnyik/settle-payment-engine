/**
 * Deposit Watcher Module
 *
 * Monitors blockchain networks for incoming deposits and tracks confirmations.
 */

// Types
export * from './types';

// Adapters
export {
  ChainAdapter,
  BitcoinAdapter,
  EthereumAdapter,
  BscAdapter,
  TronAdapter,
} from './adapters';

// State management
export { ProcessedTxStore, getProcessedTxStore } from './state';

// Main watcher service
export {
  DepositWatcher,
  createDepositWatcher,
  getDepositWatcher,
  stopDepositWatcher,
} from './deposit-watcher';
