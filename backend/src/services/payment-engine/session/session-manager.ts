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
import { calculateCharges, calculateChargesFromCrypto } from '../charges';
import { assignWallet, releaseWallet } from '../wallet';
import { getHDWalletService } from '../hd-wallet';
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

  const hasFiat = input.fiatAmount !== undefined && input.fiatAmount > 0;
  const hasCryptoAmount = input.cryptoAmount !== undefined && input.cryptoAmount > 0;

  if (!hasFiat && !hasCryptoAmount) {
    throw new InvalidInputError(
      'Either fiatAmount or cryptoAmount must be provided and positive',
      'fiatAmount'
    );
  }

  // Crypto-first path constraints (only applies when fiatAmount is absent)
  if (!hasFiat && hasCryptoAmount) {
    if (input.type === 'request') {
      throw new InvalidInputError('cryptoAmount is not valid for request type', 'cryptoAmount');
    }
    if (!input.crypto) {
      throw new InvalidInputError('crypto is required when cryptoAmount is provided', 'crypto');
    }
    if (!input.network) {
      throw new InvalidInputError('network is required when cryptoAmount is provided', 'network');
    }
  }

  if (!input.fiatCurrency) {
    throw new InvalidInputError('Fiat currency is required', 'fiatCurrency');
  }

  // Type-specific payer/receiver validation
  if (input.type === 'transfer' || input.type === 'gift') {
    if (!input.payer?.chatId) {
      throw new InvalidInputError('Payer chat ID is required', 'payer.chatId');
    }
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

  // bank_confirmation: no payer/receiver required — bank manages its own users and fiat
  // crypto + network are enforced by the generic check above (type !== 'request')

  // Crypto/network required for transfer, gift, and bank_confirmation; optional for request
  if (input.type !== 'request') {
    if (!input.crypto) {
      throw new InvalidInputError('Crypto is required', 'crypto');
    }
    if (!input.network) {
      throw new InvalidInputError('Network is required', 'network');
    }
    validateCryptoNetwork(input.crypto, input.network);
  } else if (input.crypto && input.network) {
    // If crypto/network provided for request, validate compatibility
    validateCryptoNetwork(input.crypto, input.network);
  }
}

const VALID_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  created: ['pending', 'expired', 'failed'], // 'pending' when request is fulfilled with crypto
  pending: ['confirming', 'expired', 'failed'],
  confirming: ['confirmed', 'failed'],
  confirmed: ['settling', 'failed'],
  settling: ['settled', 'failed', 'settlement_reversed'],
  settled: [],
  expired: [],
  failed: [],
  settlement_reversed: [],
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

    // ---- Crypto-first: resolve fiatAmount before the rest of the flow ----
    // Triggered only when fiatAmount is absent and cryptoAmount is present.
    // We lock the rate here and carry it forward so lockRate is not called twice.
    let preLockedRate: import('../types').RateLock | undefined;
    let resolvedInput: CreatePaymentInput = input;

    if (input.fiatAmount === undefined && input.cryptoAmount !== undefined) {
      preLockedRate = await lockRate(
        input.crypto!,
        input.fiatCurrency,
        this.config.rateLockTtlMinutes
      );
      const reverseResult = calculateChargesFromCrypto(
        input.cryptoAmount,
        input.crypto!,
        preLockedRate
      );
      resolvedInput = { ...input, fiatAmount: reverseResult.derivedFiatAmount };
    }

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

    // For requests without crypto/network, create session without wallet assignment
    // Crypto amount and rate will be calculated at fulfillment time
    if (resolvedInput.type === 'request' && (!resolvedInput.crypto || !resolvedInput.network)) {
      const expiresAt = new Date(Date.now() + this.config.sessionTtlMinutes * 60 * 1000);

      const sessionData: CreateSessionData = {
        id: ids.id,
        reference: ids.reference,
        type: resolvedInput.type,
        fiatAmount: resolvedInput.fiatAmount!, // guaranteed: request type always uses fiatAmount
        fiatCurrency: resolvedInput.fiatCurrency,
        // These will be set at fulfillment
        cryptoAmount: undefined,
        crypto: undefined,
        network: undefined,
        rate: undefined,
        assetPrice: undefined,
        chargeAmount: undefined,
        depositAddress: undefined,
        merchantId: resolvedInput.merchantId,
        apiKeyId: resolvedInput.apiKeyId,
        fundingWalletIndex: resolvedInput.fundingWalletIndex,
        parentWallet: resolvedInput.parentWallet,
        expiresAt,
        metadata: resolvedInput.metadata,
        bankRef: resolvedInput.bankRef,
      };

      return this.repository.create(sessionData);
    }

    // For transfers, gifts, and requests with crypto specified.
    // Reuse the rate lock from the crypto-first reverse-calc if already obtained.
    const rateLock = preLockedRate ?? await lockRate(
      resolvedInput.crypto!,
      resolvedInput.fiatCurrency,
      this.config.rateLockTtlMinutes
    );

    const charges = calculateCharges(
      resolvedInput.fiatAmount!,
      resolvedInput.crypto!,
      rateLock,
      undefined,
      resolvedInput.chargeFrom ?? 'crypto'
    );

    // Try HD wallet first, fall back to legacy wallet pool
    const hdWallet = getHDWalletService();
    let depositAddress: string;
    let walletId: number | undefined;
    let derivationIndex: number | undefined;
    let hdChain: string | undefined;
    let expiresAt: Date;

    if (hdWallet?.isEnabled()) {
      // Use HD wallet derivation
      const derivation = await hdWallet.deriveNextAddress(resolvedInput.network!);
      depositAddress = derivation.address;
      derivationIndex = derivation.derivationIndex;
      hdChain = derivation.chain;
      expiresAt = new Date(Date.now() + this.config.sessionTtlMinutes * 60 * 1000);
    } else {
      // Fall back to legacy wallet pool
      const wallet = await assignWallet(
        resolvedInput.network!,
        this.config.sessionTtlMinutes
      );
      depositAddress = wallet.address;
      walletId = wallet.walletId;
      expiresAt = wallet.expiresAt;
    }

    const sessionData: CreateSessionData = {
      id: ids.id,
      reference: ids.reference,
      type: resolvedInput.type,
      fiatAmount: charges.netFiatAmount,
      fiatCurrency: resolvedInput.fiatCurrency,
      transactionUsd: rateLock.rate ? charges.netFiatAmount / rateLock.rate : undefined,
      cryptoAmount: charges.totalCryptoAmount,
      crypto: resolvedInput.crypto,
      network: resolvedInput.network,
      rate: rateLock.rate,
      assetPrice: rateLock.assetPrice,
      chargeAmount: charges.fiatCharge,
      depositAddress,
      walletId,
      derivationIndex,
      hdChain: hdChain as any,
      fundingWalletIndex: resolvedInput.fundingWalletIndex,
      parentWallet: resolvedInput.parentWallet,
      merchantId: resolvedInput.merchantId,
      apiKeyId: resolvedInput.apiKeyId,
      expiresAt,
      metadata: resolvedInput.metadata,
      bankRef: resolvedInput.bankRef,
    };

    const session = await this.repository.create(sessionData);

    // Link address to session for HD wallet audit trail
    if (hdWallet?.isEnabled() && derivationIndex !== undefined) {
      await hdWallet.linkAddressToSession(depositAddress, session.id);
    }

    // Notify deposit watcher to start monitoring this session
    // Only watch if we have all required crypto fields (not for requests without crypto)
    const watcher = getDepositWatcher();
    if (watcher?.isActive() && session.depositAddress && session.network && session.crypto && session.cryptoAmount) {
      watcher.watch({
        sessionId: session.id,
        type: session.type,
        depositAddress: session.depositAddress,
        network: session.network,
        cryptoCurrency: session.crypto,
        expectedAmount: session.cryptoAmount,
        walletId: session.walletId,
        derivationIndex: session.derivationIndex,
        hdChain: session.hdChain,
        fundingWalletIndex: session.fundingWalletIndex,
        toAddress: session.parentWallet,
        expiresAt: session.expiresAt,
        confirmationThresholds: resolvedInput.confirmationThresholds,
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

    // Only release wallet if using legacy wallet pool (not HD wallet)
    if (session.walletId && !session.derivationIndex && session.network) {
      await releaseWallet(session.walletId, session.network);
    }

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

    // Allow expiring 'created' (unfulfilled requests) or 'pending' sessions
    if (session.status !== 'pending' && session.status !== 'created') {
      throw new InvalidSessionStateError(
        session.status,
        'expire',
        ['pending', 'created']
      );
    }

    // Only release wallet if using legacy wallet pool (not HD wallet) and has network
    if (session.walletId && !session.derivationIndex && session.network) {
      await releaseWallet(session.walletId, session.network);
    }

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

    // Only release wallet if using legacy wallet pool (not HD wallet) and has network
    if ((session.status === 'pending' || session.status === 'confirming') &&
        session.walletId && !session.derivationIndex && session.network) {
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

  /**
   * Fulfill a request by setting crypto/network and assigning a deposit address.
   * This locks the rate and calculates the crypto amount based on current rates.
   */
  async fulfillRequest(
    sessionId: string,
    crypto: string,
    network: string
  ): Promise<PaymentSession> {
    const session = await this.getSession(sessionId);

    if (session.type !== 'request') {
      throw new InvalidSessionStateError(
        session.status,
        'fulfill (not a request)',
        []
      );
    }

    // If already has crypto/deposit address, it's already been fulfilled
    if (session.depositAddress) {
      throw new InvalidSessionStateError(
        session.status,
        'fulfill (already has deposit address)',
        []
      );
    }

    validateCryptoNetwork(crypto, network);

    // Lock rate at fulfillment time
    const rateLock = await lockRate(
      crypto as any,
      session.fiatCurrency,
      this.config.rateLockTtlMinutes
    );

    const charges = calculateCharges(
      session.fiatAmount,
      crypto as any,
      rateLock
    );

    // Assign wallet (HD or legacy)
    const hdWallet = getHDWalletService();
    let depositAddress: string;
    let walletId: number | undefined;
    let derivationIndex: number | undefined;
    let hdChain: string | undefined;
    let expiresAt: Date;

    if (hdWallet?.isEnabled()) {
      const derivation = await hdWallet.deriveNextAddress(network as any);
      depositAddress = derivation.address;
      derivationIndex = derivation.derivationIndex;
      hdChain = derivation.chain;
      expiresAt = new Date(Date.now() + this.config.sessionTtlMinutes * 60 * 1000);
    } else {
      const wallet = await assignWallet(
        network as any,
        this.config.sessionTtlMinutes
      );
      depositAddress = wallet.address;
      walletId = wallet.walletId;
      expiresAt = wallet.expiresAt;
    }

    // Update session with crypto details and transition to pending
    const updatedSession = await this.repository.update(sessionId, {
      status: 'pending', // Transition from 'created' to 'pending'
      crypto: crypto as any,
      network: network as any,
      cryptoAmount: charges.totalCryptoAmount,
      rate: rateLock.rate,
      assetPrice: rateLock.assetPrice,
      chargeAmount: charges.fiatCharge,
      transactionUsd: rateLock.rate ? charges.netFiatAmount / rateLock.rate : undefined,
      depositAddress,
      walletId,
      derivationIndex,
      hdChain: hdChain as any,
      expiresAt,
    });

    // Link address to session for HD wallet audit trail
    if (hdWallet?.isEnabled() && derivationIndex !== undefined) {
      await hdWallet.linkAddressToSession(depositAddress, sessionId);
    }

    // Start watching for deposits - we just set all these values so they're non-null
    const watcher = getDepositWatcher();
    if (watcher?.isActive()) {
      watcher.watch({
        sessionId: updatedSession.id,
        type: updatedSession.type,
        depositAddress: depositAddress,
        network: network as any,
        cryptoCurrency: crypto as any,
        expectedAmount: charges.totalCryptoAmount,
        walletId: updatedSession.walletId,
        derivationIndex: updatedSession.derivationIndex,
        hdChain: updatedSession.hdChain,
        fundingWalletIndex: updatedSession.fundingWalletIndex,
        toAddress: updatedSession.parentWallet,
        expiresAt: expiresAt,
      });
    }

    return updatedSession;
  }
}

export const sessionManager = new SessionManager();
