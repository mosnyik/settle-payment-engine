/**
 * Payment Engine Errors
 */

export class PaymentEngineError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number = 500) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Input validation errors (400)
export class InvalidInputError extends PaymentEngineError {
  readonly field?: string;
  readonly value?: unknown;

  constructor(message: string, field?: string, value?: unknown) {
    super(message, 'INVALID_INPUT', 400);
    this.field = field;
    this.value = value;
  }
}

export class UnsupportedCryptoNetworkError extends PaymentEngineError {
  readonly crypto: string;
  readonly network: string;

  constructor(crypto: string, network: string) {
    super(
      `${crypto} is not supported on ${network}`,
      'UNSUPPORTED_CRYPTO_NETWORK',
      400
    );
    this.crypto = crypto;
    this.network = network;
  }
}

// Not found errors (404)
export class SessionNotFoundError extends PaymentEngineError {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Payment session not found: ${sessionId}`, 'SESSION_NOT_FOUND', 404);
    this.sessionId = sessionId;
  }
}

// State errors (409)
export class InvalidSessionStateError extends PaymentEngineError {
  readonly currentStatus: string;
  readonly attemptedAction: string;
  readonly validStatuses: string[];

  constructor(
    currentStatus: string,
    attemptedAction: string,
    validStatuses: string[]
  ) {
    super(
      `Cannot ${attemptedAction} session in '${currentStatus}' status. ` +
        `Valid statuses: ${validStatuses.join(', ')}`,
      'INVALID_SESSION_STATE',
      409
    );
    this.currentStatus = currentStatus;
    this.attemptedAction = attemptedAction;
    this.validStatuses = validStatuses;
  }
}

export class RateLockExpiredError extends PaymentEngineError {
  readonly lockedAt: Date;
  readonly expiredAt: Date;

  constructor(lockedAt: Date, expiredAt: Date) {
    super(
      'Rate lock has expired. Please create a new payment session.',
      'RATE_LOCK_EXPIRED',
      409
    );
    this.lockedAt = lockedAt;
    this.expiredAt = expiredAt;
  }
}

export class DepositAddressInUseError extends PaymentEngineError {
  readonly depositAddress: string;
  readonly activeSessionId: string;

  constructor(depositAddress: string, activeSessionId: string) {
    super(
      `Deposit address ${depositAddress} is already assigned to active session ${activeSessionId}`,
      'DEPOSIT_ADDRESS_IN_USE',
      409
    );
    this.depositAddress = depositAddress;
    this.activeSessionId = activeSessionId;
  }
}

export class ReceiverWalletInUseError extends DepositAddressInUseError {}

// Resource unavailable errors (503)
export class WalletPoolEmptyError extends PaymentEngineError {
  readonly network: string;
  readonly estimatedWaitSeconds?: number;

  constructor(network: string, estimatedWaitSeconds?: number) {
    const waitMsg = estimatedWaitSeconds
      ? ` Try again in ${estimatedWaitSeconds} seconds.`
      : ' Please try again later.';

    super(
      `No wallets available for ${network}.${waitMsg}`,
      'WALLET_POOL_EMPTY',
      503
    );
    this.network = network;
    this.estimatedWaitSeconds = estimatedWaitSeconds;
  }
}

export class RateServiceUnavailableError extends PaymentEngineError {
  readonly cause?: Error;

  constructor(message: string = 'Rate service is temporarily unavailable', cause?: Error) {
    super(message, 'RATE_SERVICE_UNAVAILABLE', 503);
    this.cause = cause;
  }
}

// Settlement errors (500/503)
export class SettlementFailedError extends PaymentEngineError {
  readonly sessionId: string;
  readonly providerError?: string;

  constructor(sessionId: string, providerError?: string) {
    super(
      `Settlement failed for session ${sessionId}` +
        (providerError ? `: ${providerError}` : ''),
      'SETTLEMENT_FAILED',
      500
    );
    this.sessionId = sessionId;
    this.providerError = providerError;
  }
}

// Database errors (500)
export class DatabaseError extends PaymentEngineError {
  readonly operation: string;
  readonly cause?: Error;

  constructor(operation: string, cause?: Error) {
    super(
      `Database error during ${operation}`,
      'DATABASE_ERROR',
      500
    );
    this.operation = operation;
    this.cause = cause;
  }
}

// Helper functions
export function isPaymentEngineError(error: unknown): error is PaymentEngineError {
  return error instanceof PaymentEngineError;
}

export function toPaymentEngineError(error: unknown): PaymentEngineError {
  if (isPaymentEngineError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new PaymentEngineError(error.message, 'UNKNOWN_ERROR', 500);
  }

  return new PaymentEngineError(String(error), 'UNKNOWN_ERROR', 500);
}
