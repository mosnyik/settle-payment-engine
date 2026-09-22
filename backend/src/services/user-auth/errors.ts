/**
 * End-User Auth Errors
 */

export class UserAuthError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number = 401) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidOtpError extends UserAuthError {
  constructor(message: string = 'Invalid or expired code') {
    super(message, 'INVALID_OTP', 400);
  }
}

export class OtpRateLimitedError extends UserAuthError {
  constructor(retryAfterSec: number) {
    super(
      `Please wait ${retryAfterSec}s before requesting another code`,
      'OTP_RATE_LIMITED',
      429
    );
  }
}

export class OtpChannelDisabledError extends UserAuthError {
  constructor(channel: string) {
    super(`${channel} login is not currently available`, 'OTP_CHANNEL_DISABLED', 503);
  }
}

export class InvalidWalletSignatureError extends UserAuthError {
  constructor(message: string = 'Wallet signature verification failed') {
    super(message, 'INVALID_WALLET_SIGNATURE', 401);
  }
}

export class WalletNonceExpiredError extends UserAuthError {
  constructor() {
    super('Sign-in nonce expired or already used, request a new one', 'WALLET_NONCE_EXPIRED', 400);
  }
}

export class InvalidGoogleTokenError extends UserAuthError {
  constructor(message: string = 'Invalid Google ID token') {
    super(message, 'INVALID_GOOGLE_TOKEN', 401);
  }
}

export class InvalidRefreshTokenError extends UserAuthError {
  constructor() {
    super('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN', 401);
  }
}

export class UserNotFoundError extends UserAuthError {
  constructor() {
    super('User not found', 'USER_NOT_FOUND', 404);
  }
}

export class IdentityAlreadyLinkedError extends UserAuthError {
  constructor(type: string) {
    super(`This ${type} is already linked to a different account`, 'IDENTITY_ALREADY_LINKED', 409);
  }
}

export class MissingAccessTokenError extends UserAuthError {
  constructor() {
    super('Missing or invalid Authorization header', 'MISSING_ACCESS_TOKEN', 401);
  }
}

export class InvalidAccessTokenError extends UserAuthError {
  constructor() {
    super('Invalid or expired access token', 'INVALID_ACCESS_TOKEN', 401);
  }
}
