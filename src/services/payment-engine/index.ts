/**
 * Payment Engine
 */

// Main exports
export { PaymentEngine, paymentEngine } from './payment-engine';

// Types
export {
  type PaymentType,
  type PaymentStatus,
  type CryptoCurrency,
  type Network,
  type FiatCurrency,
  type PayerInput,
  type ReceiverInput,
  type CreatePaymentInput,
  type RateLock,
  type PaymentSession,
  type WalletAssignment,
  type PaymentEngineConfig,
  DEFAULT_CONFIG,
  NETWORK_TO_CHAIN,
  getRequiredConfirmations,
} from './types';

// Errors
export {
  PaymentEngineError,
  InvalidInputError,
  UnsupportedCryptoNetworkError,
  SessionNotFoundError,
  InvalidSessionStateError,
  RateLockExpiredError,
  WalletPoolEmptyError,
  RateServiceUnavailableError,
  SettlementFailedError,
  DatabaseError,
  isPaymentEngineError,
  toPaymentEngineError,
} from './errors';

// Rate service
export {
  getExchangeRate,
  getAssetPrice,
  lockRate,
  isRateLockValid,
  fiatToCrypto,
  cryptoToFiat,
  clearRateCache,
} from './rate';

// Charge calculator
export {
  type FeeTier,
  type ChargeResult,
  DEFAULT_FEE_TIERS,
  getFeeTier,
  getFiatCharge,
  fiatChargeToCrypto,
  calculateCharges,
  formatCryptoAmount,
  formatFiatAmount,
} from './charges';

// Wallet pool
export {
  assignWallet,
  releaseWallet,
  releaseWalletByAddress,
  getPoolStatus,
  releaseExpiredWallets,
} from './wallet';

// Session management
export {
  SessionManager,
  sessionManager,
  SessionRepository,
  sessionRepository,
} from './session';

// Utilities
export {
  generatePaymentId,
  generatePaymentReference,
  generatePaymentIds,
  isValidPaymentId,
  isValidPaymentReference,
} from './utils';
