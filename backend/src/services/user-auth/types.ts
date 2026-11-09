/**
 * End-User Auth Module Types
 * Defines all data structures for phone/email/wallet/Google user login
 */

export type UserStatus = 'active' | 'suspended';
export type IdentityType = 'email' | 'phone' | 'wallet' | 'google';
export type OtpChannel = 'email' | 'phone';
// How a code physically reaches the user - 'phone' codes go by SMS or WhatsApp
export type OtpDelivery = 'email' | 'sms' | 'whatsapp';

export interface User {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserIdentity {
  id: number;
  userId: string;
  type: IdentityType;
  identifier: string;
  verifiedAt: Date | null;
  createdAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

export interface JwtPayload {
  sub: string; // user id
  iat?: number;
  exp?: number;
}

// =============================================================================
// REQUEST AUGMENTATION
// Extends Express Request with the authenticated end user
// =============================================================================

declare global {
  namespace Express {
    interface Request {
      endUser?: { id: string };
    }
  }
}
