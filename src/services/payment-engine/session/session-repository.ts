/**
 * Session Repository
 */

import {
  PaymentSession,
  PaymentStatus,
  PaymentType,
  CryptoCurrency,
  Network,
  FiatCurrency,
} from '../types';
import { SessionNotFoundError, DatabaseError } from '../errors';

export interface CreateSessionData {
  id: string;
  reference: string;
  type: PaymentType;
  fiatAmount: number;
  fiatCurrency: FiatCurrency;
  cryptoAmount: number;
  crypto: CryptoCurrency;
  network: Network;
  rate: number;
  assetPrice: number;
  rateLockedAt: Date;
  chargeAmount: number;
  chargeCrypto: number;
  depositAddress: string;
  walletId: number;
  payerChatId: string;
  payerId?: number;
  receiverId?: number;
  merchantId?: string;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}

export interface UpdateSessionData {
  status?: PaymentStatus;
  txHash?: string;
  confirmations?: number;
  receivedAmount?: number;
  confirmedAt?: Date;
  settledAt?: Date;
  payerId?: number;
  receiverId?: number;
  cashbackAmount?: number;
  cashbackCredited?: boolean;
}

function rowToSession(row: any): PaymentSession {
  return {
    id: row.id,
    reference: row.reference,
    type: row.type as PaymentType,
    status: row.status as PaymentStatus,
    fiatAmount: Number(row.fiat_amount),
    fiatCurrency: row.fiat_currency as FiatCurrency,
    cryptoAmount: Number(row.crypto_amount),
    crypto: row.crypto_currency as CryptoCurrency,
    network: row.network as Network,
    rate: Number(row.rate),
    assetPrice: Number(row.asset_price),
    rateLockedAt: new Date(row.rate_locked_at),
    chargeAmount: Number(row.charge_amount),
    chargeCrypto: Number(row.charge_crypto),
    depositAddress: row.deposit_address,
    walletId: Number(row.wallet_id),
    payerId: row.payer_id ? Number(row.payer_id) : undefined,
    payerChatId: row.payer_chat_id,
    receiverId: row.receiver_id ? Number(row.receiver_id) : undefined,
    merchantId: row.merchant_id || undefined,
    txHash: row.tx_hash || undefined,
    confirmations: row.confirmations ? Number(row.confirmations) : undefined,
    receivedAmount: row.received_amount ? Number(row.received_amount) : undefined,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : undefined,
    settledAt: row.settled_at ? new Date(row.settled_at) : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    cashbackAmount: row.cashback_amount ? Number(row.cashback_amount) : undefined,
    cashbackCredited: row.cashback_credited ? Boolean(row.cashback_credited) : undefined,
  };
}

export class SessionRepository {
  async create(data: CreateSessionData): Promise<PaymentSession> {
    const pool = (await import('../../../lib/mysql')).default;
    const now = new Date();

    try {
      await pool.query(
        `INSERT INTO payment_sessions (
          id, reference, type, status,
          fiat_amount, fiat_currency, crypto_amount, crypto_currency, network,
          rate, asset_price, rate_locked_at,
          charge_amount, charge_crypto,
          deposit_address, wallet_id,
          payer_chat_id, payer_id, receiver_id, merchant_id,
          expires_at, created_at, updated_at,
          metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.id,
          data.reference,
          data.type,
          'pending',
          data.fiatAmount,
          data.fiatCurrency,
          data.cryptoAmount,
          data.crypto,
          data.network,
          data.rate,
          data.assetPrice,
          data.rateLockedAt,
          data.chargeAmount,
          data.chargeCrypto,
          data.depositAddress,
          data.walletId,
          data.payerChatId,
          data.payerId || null,
          data.receiverId || null,
          data.merchantId || null,
          data.expiresAt,
          now,
          now,
          data.metadata ? JSON.stringify(data.metadata) : null,
        ]
      );

      return {
        ...data,
        status: 'pending',
        createdAt: now,
      } as PaymentSession;
    } catch (error) {
      throw new DatabaseError('create session', error instanceof Error ? error : undefined);
    }
  }

  async findById(id: string): Promise<PaymentSession | null> {
    const pool = (await import('../../../lib/mysql')).default;

    try {
      const [rows] = await pool.query<any[]>(
        'SELECT * FROM payment_sessions WHERE id = ?',
        [id]
      );

      if (!rows || rows.length === 0) {
        return null;
      }

      return rowToSession(rows[0]);
    } catch (error) {
      throw new DatabaseError('find session by id', error instanceof Error ? error : undefined);
    }
  }

  async findByReference(reference: string): Promise<PaymentSession | null> {
    const pool = (await import('../../../lib/mysql')).default;

    try {
      const [rows] = await pool.query<any[]>(
        'SELECT * FROM payment_sessions WHERE reference = ?',
        [reference]
      );

      if (!rows || rows.length === 0) {
        return null;
      }

      return rowToSession(rows[0]);
    } catch (error) {
      throw new DatabaseError('find session by reference', error instanceof Error ? error : undefined);
    }
  }

  async findByStatus(status: PaymentStatus, limit: number = 100): Promise<PaymentSession[]> {
    const pool = (await import('../../../lib/mysql')).default;

    try {
      const [rows] = await pool.query<any[]>(
        'SELECT * FROM payment_sessions WHERE status = ? ORDER BY created_at ASC LIMIT ?',
        [status, limit]
      );

      return (rows || []).map(rowToSession);
    } catch (error) {
      throw new DatabaseError('find sessions by status', error instanceof Error ? error : undefined);
    }
  }

  async findExpiredPending(limit: number = 100): Promise<PaymentSession[]> {
    const pool = (await import('../../../lib/mysql')).default;
    const now = new Date();

    try {
      const [rows] = await pool.query<any[]>(
        `SELECT * FROM payment_sessions
         WHERE status = 'pending'
           AND expires_at < ?
         ORDER BY expires_at ASC
         LIMIT ?`,
        [now, limit]
      );

      return (rows || []).map(rowToSession);
    } catch (error) {
      throw new DatabaseError('find expired pending sessions', error instanceof Error ? error : undefined);
    }
  }

  async update(id: string, data: UpdateSessionData): Promise<PaymentSession> {
    const pool = (await import('../../../lib/mysql')).default;

    const updates: string[] = [];
    const values: any[] = [];

    if (data.status !== undefined) {
      updates.push('status = ?');
      values.push(data.status);
    }
    if (data.txHash !== undefined) {
      updates.push('tx_hash = ?');
      values.push(data.txHash);
    }
    if (data.confirmations !== undefined) {
      updates.push('confirmations = ?');
      values.push(data.confirmations);
    }
    if (data.receivedAmount !== undefined) {
      updates.push('received_amount = ?');
      values.push(data.receivedAmount);
    }
    if (data.confirmedAt !== undefined) {
      updates.push('confirmed_at = ?');
      values.push(data.confirmedAt);
    }
    if (data.settledAt !== undefined) {
      updates.push('settled_at = ?');
      values.push(data.settledAt);
    }
    if (data.payerId !== undefined) {
      updates.push('payer_id = ?');
      values.push(data.payerId);
    }
    if (data.receiverId !== undefined) {
      updates.push('receiver_id = ?');
      values.push(data.receiverId);
    }
    if (data.cashbackAmount !== undefined) {
      updates.push('cashback_amount = ?');
      values.push(data.cashbackAmount);
    }
    if (data.cashbackCredited !== undefined) {
      updates.push('cashback_credited = ?');
      values.push(data.cashbackCredited ? 1 : 0);
    }

    updates.push('updated_at = ?');
    values.push(new Date());

    values.push(id);

    if (updates.length === 1) {
      const session = await this.findById(id);
      if (!session) {
        throw new SessionNotFoundError(id);
      }
      return session;
    }

    try {
      await pool.query(
        `UPDATE payment_sessions SET ${updates.join(', ')} WHERE id = ?`,
        values
      );

      const session = await this.findById(id);
      if (!session) {
        throw new SessionNotFoundError(id);
      }

      return session;
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        throw error;
      }
      throw new DatabaseError('update session', error instanceof Error ? error : undefined);
    }
  }

  async referenceExists(reference: string): Promise<boolean> {
    const pool = (await import('../../../lib/mysql')).default;

    try {
      const [rows] = await pool.query<any[]>(
        'SELECT 1 FROM payment_sessions WHERE reference = ? LIMIT 1',
        [reference]
      );

      return rows && rows.length > 0;
    } catch (error) {
      throw new DatabaseError('check reference exists', error instanceof Error ? error : undefined);
    }
  }
}

export const sessionRepository = new SessionRepository();
