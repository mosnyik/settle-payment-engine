/**
 * User Auth Schemas
 *
 * Zod validation schemas for the /v1/users/auth routes (phone/email/wallet/Google login).
 */

import { z } from 'zod';
import { PHONE_REGEX } from '../utils/phone';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WALLET_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function refineIdentifier(data: { channel: 'email' | 'phone'; identifier: string }, ctx: z.RefinementCtx) {
  if (data.channel === 'email' && !EMAIL_REGEX.test(data.identifier)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid email address', path: ['identifier'] });
  }
  if (data.channel === 'phone' && !PHONE_REGEX.test(data.identifier)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid phone number', path: ['identifier'] });
  }
}

export const otpRequestSchema = z.object({
  channel: z.enum(['email', 'phone']),
  identifier: z.string().min(1),
  // Phone only - how the code is delivered (defaults to SMS)
  via: z.enum(['sms', 'whatsapp']).optional(),
}).superRefine((data, ctx) => {
  refineIdentifier(data, ctx);
  if (data.via && data.channel !== 'phone') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '"via" is only supported for the phone channel', path: ['via'] });
  }
});

export const otpVerifySchema = z.object({
  channel: z.enum(['email', 'phone']),
  identifier: z.string().min(1),
  code: z.string().min(4).max(10),
}).superRefine(refineIdentifier);

export const walletNonceSchema = z.object({
  address: z.string().regex(WALLET_ADDRESS_REGEX, 'Invalid wallet address'),
});

export const walletVerifySchema = z.object({
  address: z.string().regex(WALLET_ADDRESS_REGEX, 'Invalid wallet address'),
  signature: z.string().min(1),
});

export const googleAuthSchema = z.object({
  idToken: z.string().min(1),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(255).nullable().optional(),
  avatarUrl: z.string().trim().url().max(500).nullable().optional(),
}).refine((data) => data.displayName !== undefined || data.avatarUrl !== undefined, {
  message: 'At least one of displayName or avatarUrl is required',
});
