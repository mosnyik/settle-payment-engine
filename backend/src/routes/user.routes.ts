/**
 * User Routes — /v1/users/me
 * Protected by authenticateUser (JWT bearer), mounted separately from the
 * merchant-scoped /v1/me routes.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../lib/mysql';
import { RowDataPacket } from 'mysql2';
import {
  getUserById,
  getIdentitiesForUser,
  updateUserProfile,
} from '../services/user-auth/services/user.service';
import { verifyOtpForLinking } from '../services/user-auth/services/otp.service';
import { verifySignatureForLinking } from '../services/user-auth/services/wallet-auth.service';
import { UserNotFoundError } from '../services/user-auth/errors';
import { normalizePhone, phoneVariants } from '../utils/phone';
import {
  updateProfileSchema,
  otpVerifySchema,
  walletVerifySchema,
} from '../validation/user-auth.schemas';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.endUser!.id;
    const user = await getUserById(userId);
    if (!user) throw new UserNotFoundError();

    const identities = await getIdentitiesForUser(userId);
    res.json({
      success: true,
      data: {
        user,
        identities: identities.map(({ type, identifier, verifiedAt }) => ({ type, identifier, verifiedAt })),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /v1/users/me
 *
 * Update the caller's own display name and/or avatar URL. Both fields are
 * optional but at least one must be present.
 */
router.patch('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: parsed.error.flatten(),
      });
    }

    const user = await updateUserProfile(req.endUser!.id, parsed.data);
    res.json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/users/me/identities/otp/verify
 *
 * Link a phone or email to the caller's account. Request the code first via
 * the existing public POST /v1/users/auth/otp/request (same endpoint used
 * for login) — there's no separate linking-specific send step. Verifying
 * the code here proves ownership and attaches the identity to req.endUser
 * instead of logging into whichever account it resolves to.
 *
 * 409s if the identifier is already linked to a different account.
 */
router.post('/identities/otp/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { channel, identifier, code } = otpVerifySchema.parse(req.body);
    const identity = await verifyOtpForLinking(req.endUser!.id, channel, identifier, code);
    res.json({ success: true, data: { identity } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/users/me/identities/wallet/verify
 *
 * Link a wallet address to the caller's account. Request the nonce first via
 * the existing public POST /v1/users/auth/wallet/nonce (same endpoint used
 * for login), sign it with the wallet, then verify here to attach it to
 * req.endUser instead of logging into whichever account it resolves to.
 *
 * 409s if the wallet is already linked to a different account.
 */
router.post('/identities/wallet/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address, signature } = walletVerifySchema.parse(req.body);
    const identity = await verifySignatureForLinking(req.endUser!.id, address, signature);
    res.json({ success: true, data: { identity } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/users/me/payments
 *
 * Payment history for the authenticated end-user - every payment_session
 * where one of their verified phone identities is the payer or the receiver.
 * There's no link table between user_auth and the payment engine, so this
 * matches by phone string equality against payers.phone / receivers.phone.
 *
 * Query params: status, type, from, to, limit (default 20, max 200), offset
 */
router.get('/payments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.endUser!.id;
    const identities = await getIdentitiesForUser(userId);
    const loginPhones = identities
      .filter((identity) => identity.type === 'phone' && identity.verifiedAt)
      .map((identity) => identity.identifier);

    // The DB has no normalization, so payer/receiver phones may be stored in
    // a different format than the login identifier (0801... vs +234801...).
    // Expand each login phone to its plausible stored variants for both the
    // SQL match and the sent/received/both classification below, so the two
    // stay consistent with each other.
    const queryPhones = [...new Set(loginPhones.flatMap((phone) => phoneVariants(phone)))];
    const matchSet = new Set(
      queryPhones.map((phone) => normalizePhone(phone)).filter((p): p is string => p !== null)
    );

    const {
      status,
      type,
      from,
      to,
      limit: limitStr = '20',
      offset: offsetStr = '0',
    } = req.query as Record<string, string>;

    const limit = Math.min(parseInt(limitStr) || 20, 200);
    const offset = parseInt(offsetStr) || 0;

    if (queryPhones.length === 0) {
      return res.json({ success: true, data: { payments: [], total: 0, limit, offset } });
    }

    const inClause = queryPhones.map(() => '?').join(',');
    const conditions: string[] = [`(p.phone IN (${inClause}) OR r.phone IN (${inClause}))`];
    const values: unknown[] = [...queryPhones, ...queryPhones];

    if (status) { conditions.push('ps.status = ?'); values.push(status); }
    if (type) { conditions.push('ps.type = ?'); values.push(type); }
    if (from) { conditions.push('ps.created_at >= ?'); values.push(new Date(from)); }
    if (to) { conditions.push('ps.created_at <= ?'); values.push(new Date(to)); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT ps.id, ps.reference, ps.type, ps.status,
              ps.fiat_amount, ps.fiat_currency,
              ps.crypto, ps.crypto_amount, ps.network,
              ps.rate, ps.charge_amount,
              ps.tx_hash, ps.confirmations,
              ps.received_amount, ps.settled_fiat_amount,
              ps.created_at, ps.confirmed_at, ps.settled_at,
              r.bank_account AS receiver_account_number, r.account_name AS receiver_account_name,
              r.bank_code AS receiver_bank_code, r.bank_name AS receiver_bank_name, r.phone AS receiver_phone,
              p.chat_id AS payer_chat_id, p.phone AS payer_phone
       FROM payment_sessions ps
       LEFT JOIN payers p ON p.id = ps.payer_id
       LEFT JOIN receivers r ON r.id = ps.receiver_id
       ${where}
       ORDER BY ps.created_at DESC
       LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    );

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM payment_sessions ps
       LEFT JOIN payers p ON p.id = ps.payer_id
       LEFT JOIN receivers r ON r.id = ps.receiver_id
       ${where}`,
      values
    );

    const payments = rows.map((row) => {
      const isPayer = matchSet.has(normalizePhone(row.payer_phone as string) ?? '');
      const isReceiver = matchSet.has(normalizePhone(row.receiver_phone as string) ?? '');
      const direction = isPayer && isReceiver ? 'both' : isPayer ? 'sent' : 'received';
      return { ...row, direction };
    });

    return res.json({
      success: true,
      data: {
        payments,
        total: (countRows[0] as { total: number }).total,
        limit,
        offset,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
