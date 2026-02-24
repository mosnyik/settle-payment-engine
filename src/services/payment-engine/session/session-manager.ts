/**
 * Session Manager
 */

import {
  CreatePaymentInput,
  PaymentSession,
  PaymentStatus,
  DEFAULT_CONFIG,
  PaymentEngineConfig,
} from '../types';
import {
  InvalidInputError,
  InvalidSessionStateError,
  SessionNotFoundError,
  UnsupportedCryptoNetworkError,
} from '../errors';
import { generatePaymentIds } from '../utils';
import { lockRate } from '../rate';
import { calculateCharges } from '../charges';
import { assignWallet, releaseWallet } from '../wallet';
import { SessionRepository, sessionRepository, CreateSessionData } from './session-repository';
import { getDepositWatcher } from '../watcher';

const VALID_CRYPTO_NETWORKS: Record<string, string[]> = {
  BTC: ['bitcoin'],
  ETH: ['ethereum'],
  BNB: ['bsc'],
  TRX: ['tron'],
  USDT: ['ethereum', 'erc20', 'bsc', 'bep20', 'tron', 'trc20'],
};

function validateCryptoNetwork(crypto: string, network: string): void {
  const validNetworks = VALID_CRYPTO_NETWORKS[crypto];

  if (!validNetworks) {
    throw new InvalidInputError(`Unsupported cryptocurrency: ${crypto}`, 'crypto', crypto);
  }

  if (!validNetworks.includes(network)) {
    throw new UnsupportedCryptoNetworkError(crypto, network);
  }
}

function validateCreateInput(input: CreatePaymentInput): void {
  if (!input.type) {
    throw new InvalidInputError('Payment type is required', 'type');
  }

  if (!input.fiatAmount || input.fiatAmount <= 0) {
    throw new InvalidInputError('Fiat amount must be positive', 'fiatAmount', input.fiatAmount);
  }

  if (!input.fiatCurrency) {
    throw new InvalidInputError('Fiat currency is required', 'fiatCurrency');
  }

  if (!input.crypto) {
    throw new InvalidInputError('Crypto is required', 'crypto');
  }

  if (!input.network) {
    throw new InvalidInputError('Network is required', 'network');
  }

  if (!input.payer?.chatId) {
    throw new InvalidInputError('Payer chat ID is required', 'payer.chatId');
  }

  if (input.type === 'transfer') {
    if (!input.receiver) {
      throw new InvalidInputError('Receiver is required for transfers', 'receiver');
    }
    if (!input.receiver.bankCode) {
      throw new InvalidInputError('Receiver bank code is required', 'receiver.bankCode');
    }
    if (!input.receiver.accountNumber) {
      throw new InvalidInputError('Receiver account number is required', 'receiver.accountNumber');
    }
    if (!input.receiver.accountName) {
      throw new InvalidInputError('Receiver account name is required', 'receiver.accountName');
    }
  }

  validateCryptoNetwork(input.crypto, input.network);
}

const VALID_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  created: ['pending', 'expired', 'failed'],
  pending: ['confirming', 'expired', 'failed'],
  confirming: ['confirmed', 'failed'],
  confirmed: ['settling', 'failed'],
  settling: ['settled', 'failed'],
  settled: [],
  expired: [],
  failed: [],
};

function isValidTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export class SessionManager {
  private repository: SessionRepository;
  private config: PaymentEngineConfig;

  constructor(
    repository: SessionRepository = sessionRepository,
    config: PaymentEngineConfig = DEFAULT_CONFIG
  ) {
    this.repository = repository;
    this.config = config;
  }

  async createSession(input: CreatePaymentInput): Promise<PaymentSession> {
    validateCreateInput(input);

    const rateLock = await lockRate(
      input.crypto,
      input.fiatCurrency,
      this.config.rateLockTtlMinutes
    );

    const charges = calculateCharges(
      input.fiatAmount,
      input.crypto,
      rateLock
    );

    const wallet = await assignWallet(
      input.network,
      this.config.sessionTtlMinutes
    );

    let ids = generatePaymentIds();
    let attempts = 0;
    const maxAttempts = 5;

    while (await this.repository.referenceExists(ids.reference)) {
      attempts++;
      if (attempts >= maxAttempts) {
        throw new Error('Failed to generate unique reference after multiple attempts');
      }
      ids = generatePaymentIds();
    }

    const sessionData: CreateSessionData = {
      id: ids.id,
      reference: ids.reference,
      type: input.type,
      fiatAmount: input.fiatAmount,
      fiatCurrency: input.fiatCurrency,
      cryptoAmount: charges.totalCryptoAmount,
      crypto: input.crypto,
      network: input.network,
      rate: rateLock.rate,
      assetPrice: rateLock.assetPrice,
      rateLockedAt: rateLock.lockedAt,
      chargeAmount: charges.fiatCharge,
      chargeCrypto: charges.cryptoCharge,
      depositAddress: wallet.address,
      walletId: wallet.walletId,
      payerChatId: input.payer.chatId,
      merchantId: input.merchantId,
      expiresAt: wallet.expiresAt,
      metadata: input.metadata,
    };

    const session = await this.repository.create(sessionData);

    // Notify deposit watcher to start monitoring this session
    const watcher = getDepositWatcher();
    if (watcher?.isActive()) {
      watcher.watch({
        sessionId: session.id,
        depositAddress: session.depositAddress,
        network: session.network,
        cryptoCurrency: session.crypto,
        expectedAmount: session.cryptoAmount,
        walletId: session.walletId,
        expiresAt: session.expiresAt,
      });
    }

    return session;
  }

  async getSession(id: string): Promise<PaymentSession> {
    const session = await this.repository.findById(id);

    if (!session) {
      throw new SessionNotFoundError(id);
    }

    return session;
  }

  async getSessionByReference(reference: string): Promise<PaymentSession> {
    const session = await this.repository.findByReference(reference);

    if (!session) {
      throw new SessionNotFoundError(reference);
    }

    return session;
  }

  async updateStatus(id: string, newStatus: PaymentStatus): Promise<PaymentSession> {
    const session = await this.getSession(id);

    if (!isValidTransition(session.status, newStatus)) {
      throw new InvalidSessionStateError(
        session.status,
        `transition to ${newStatus}`,
        VALID_TRANSITIONS[session.status]
      );
    }

    return this.repository.update(id, { status: newStatus });
  }

  async markDeposit(
    id: string,
    txHash: string,
    receivedAmount: number
  ): Promise<PaymentSession> {
    const session = await this.getSession(id);

    if (session.status !== 'pending') {
      throw new InvalidSessionStateError(
        session.status,
        'mark deposit',
        ['pending']
      );
    }

    return this.repository.update(id, {
      status: 'confirming',
      txHash,
      receivedAmount,
    });
  }

  async confirmDeposit(id: string, confirmations: number): Promise<PaymentSession> {
    const session = await this.getSession(id);

    if (session.status !== 'confirming') {
      throw new InvalidSessionStateError(
        session.status,
        'confirm deposit',
        ['confirming']
      );
    }

    await releaseWallet(session.walletId, session.network);

    return this.repository.update(id, {
      status: 'confirmed',
      confirmations,
      confirmedAt: new Date(),
    });
  }

  async markSettling(id: string): Promise<PaymentSession> {
    return this.updateStatus(id, 'settling');
  }

  async markSettled(id: string): Promise<PaymentSession> {
    const session = await this.getSession(id);

    if (session.status !== 'settling') {
      throw new InvalidSessionStateError(
        session.status,
        'mark settled',
        ['settling']
      );
    }

    return this.repository.update(id, {
      status: 'settled',
      settledAt: new Date(),
    });
  }

  async expireSession(id: string): Promise<PaymentSession> {
    const session = await this.getSession(id);

    if (session.status !== 'pending') {
      throw new InvalidSessionStateError(
        session.status,
        'expire',
        ['pending']
      );
    }

    await releaseWallet(session.walletId, session.network);

    // Stop watching this session
    const watcher = getDepositWatcher();
    watcher?.unwatchSession(id);

    return this.repository.update(id, { status: 'expired' });
  }

  async failSession(id: string): Promise<PaymentSession> {
    const session = await this.getSession(id);

    if (!isValidTransition(session.status, 'failed')) {
      throw new InvalidSessionStateError(
        session.status,
        'fail',
        VALID_TRANSITIONS[session.status]
      );
    }

    if (session.status === 'pending' || session.status === 'confirming') {
      await releaseWallet(session.walletId, session.network);
    }

    // Stop watching this session
    const watcher = getDepositWatcher();
    watcher?.unwatchSession(id);

    return this.repository.update(id, { status: 'failed' });
  }

  async expireStale(): Promise<number> {
    const expiredSessions = await this.repository.findExpiredPending(100);

    let count = 0;
    for (const session of expiredSessions) {
      try {
        await this.expireSession(session.id);
        count++;
      } catch (error) {
        console.error(`Failed to expire session ${session.id}:`, error);
      }
    }

    return count;
  }

  async setPayerId(sessionId: string, payerId: number): Promise<PaymentSession> {
    return this.repository.update(sessionId, { payerId });
  }

  async setReceiverId(sessionId: string, receiverId: number): Promise<PaymentSession> {
    return this.repository.update(sessionId, { receiverId });
  }

  async setCashback(sessionId: string, amount: number): Promise<PaymentSession> {
    return this.repository.update(sessionId, { cashbackAmount: amount });
  }

  async creditCashback(sessionId: string): Promise<PaymentSession> {
    return this.repository.update(sessionId, { cashbackCredited: true });
  }
}

export const sessionManager = new SessionManager();
