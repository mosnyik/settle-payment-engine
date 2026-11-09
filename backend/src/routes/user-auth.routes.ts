/**
 * User Auth Routes — /v1/users/auth
 *
 * Public routes (no HMAC, see config.security.publicPaths) for end-user
 * login via email/phone OTP, wallet signature, or Google ID token, plus
 * refresh-token rotation and logout.
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  otpRequestSchema,
  otpVerifySchema,
  walletNonceSchema,
  walletVerifySchema,
  googleAuthSchema,
  refreshTokenSchema,
} from '../validation/user-auth.schemas';
import { requestOtp, verifyOtp } from '../services/user-auth/services/otp.service';
import { createNonce, verifySignature } from '../services/user-auth/services/wallet-auth.service';
import { verifyGoogleIdToken } from '../services/user-auth/services/google-auth.service';
import {
  issueTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
} from '../services/user-auth/services/token.service';
import { touchLastLogin } from '../services/user-auth/services/user.service';
import { authenticateUser } from '../services/user-auth/middleware/authenticateUser';
import { User } from '../services/user-auth/types';

const router = Router();

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/**
 * A slow email/SMS provider or DB call can outlast connect-timeout, which
 * already sent a 503 and marked the response as sent. Guard every response
 * with this instead of calling res.json directly, or the late response
 * throws ERR_HTTP_HEADERS_SENT and crashes the process.
 */
function sendJson(res: Response, body: unknown): void {
  if (!res.headersSent) {
    res.json(body);
  }
}

async function respondWithSession(user: User, req: Request, res: Response): Promise<void> {
  await touchLastLogin(user.id);
  const tokens = await issueTokens(user.id, req.headers['user-agent'], getClientIp(req));
  sendJson(res, { success: true, data: { user, ...tokens } });
}

router.post('/otp/request', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { channel, identifier, via } = otpRequestSchema.parse(req.body);
    const result = await requestOtp(channel, identifier, getClientIp(req), via);
    sendJson(res, { success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/otp/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { channel, identifier, code } = otpVerifySchema.parse(req.body);
    const user = await verifyOtp(channel, identifier, code);
    await respondWithSession(user, req, res);
  } catch (err) {
    next(err);
  }
});

router.post('/wallet/nonce', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address } = walletNonceSchema.parse(req.body);
    const result = await createNonce(address);
    sendJson(res, { success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/wallet/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address, signature } = walletVerifySchema.parse(req.body);
    const user = await verifySignature(address, signature);
    await respondWithSession(user, req, res);
  } catch (err) {
    next(err);
  }
});

router.post('/google', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { idToken } = googleAuthSchema.parse(req.body);
    const user = await verifyGoogleIdToken(idToken);
    await respondWithSession(user, req, res);
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = refreshTokenSchema.parse(req.body);
    const tokens = await rotateRefreshToken(refreshToken, req.headers['user-agent'], getClientIp(req));
    sendJson(res, { success: true, data: tokens });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = refreshTokenSchema.parse(req.body);
    await revokeRefreshToken(refreshToken);
    sendJson(res, { success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Logout of every device/session at once. Requires the access token
 * (rather than a single refresh token) since it acts on the whole account.
 */
router.post('/logout-all', authenticateUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await revokeAllRefreshTokens(req.endUser!.id);
    sendJson(res, { success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
