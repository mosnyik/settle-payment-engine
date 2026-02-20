/**
 * Session Manager Tests
 *
 * Tests for the session lifecycle and state transitions.
 * Mocks all dependencies (rate, charges, wallet, repository).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '@/services/payment-engine/session/session-manager';
import {
  InvalidInputError,
  InvalidSessionStateError,
  SessionNotFoundError,
  UnsupportedCryptoNetworkError,
} from '@/services/payment-engine/errors';
import type { PaymentSession, CreatePaymentInput } from '@/services/payment-engine/types';

// ===========================================================================
// MOCKS
// ===========================================================================

// Mock rate service
vi.mock('@/services/payment-engine/rate', () => ({
  lockRate: vi.fn().mockResolvedValue({
    rate: 1600,
    assetPrice: 1,
    lockedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  }),
  isRateLockValid: vi.fn().mockReturnValue(true),
}));

// Mock charge calculator
vi.mock('@/services/payment-engine/charges', () => ({
  calculateCharges: vi.fn().mockReturnValue({
    fiatCharge: 500,
    cryptoCharge: 0.3125,
    tierName: 'basic',
    netFiatAmount: 50000,
    totalCryptoAmount: 31.5625,
  }),
}));

// Mock wallet pool
vi.mock('@/services/payment-engine/wallet', () => ({
  assignWallet: vi.fn().mockResolvedValue({
    address: '0x742d35Cc6634C0532925a3b844Bc9e7595f3eA42',
    walletId: 1,
    assignedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  }),
  releaseWallet: vi.fn().mockResolvedValue(undefined),
}));

// Mock ID generator
vi.mock('@/services/payment-engine/utils', () => ({
  generatePaymentIds: vi.fn().mockReturnValue({
    id: 'pay_test123456789012345678901',
    reference: '2S-TEST12',
  }),
}));

// ===========================================================================
// MOCK REPOSITORY
// ===========================================================================

function createMockRepository() {
  const sessions = new Map<string, PaymentSession>();

  return {
    create: vi.fn().mockImplementation(async (data) => {
      const session: PaymentSession = {
        ...data,
        status: 'pending',
        createdAt: new Date(),
      };
      sessions.set(data.id, session);
      return session;
    }),

    findById: vi.fn().mockImplementation(async (id) => {
      return sessions.get(id) || null;
    }),

    findByReference: vi.fn().mockImplementation(async (ref) => {
      for (const session of sessions.values()) {
        if (session.reference === ref) return session;
      }
      return null;
    }),

    findByStatus: vi.fn().mockResolvedValue([]),

    findExpiredPending: vi.fn().mockResolvedValue([]),

    update: vi.fn().mockImplementation(async (id, data) => {
      const session = sessions.get(id);
      if (!session) throw new SessionNotFoundError(id);

      const updated = { ...session, ...data };
      sessions.set(id, updated);
      return updated;
    }),

    referenceExists: vi.fn().mockResolvedValue(false),

    // Helper for tests
    _sessions: sessions,
    _addSession: (session: PaymentSession) => sessions.set(session.id, session),
  };
}

// ===========================================================================
// TEST DATA
// ===========================================================================

const validInput: CreatePaymentInput = {
  type: 'transfer',
  fiatAmount: 50000,
  fiatCurrency: 'NGN',
  crypto: 'USDT',
  network: 'bep20',
  payer: {
    chatId: 'user123',
    phone: '08012345678',
  },
  receiver: {
    bankCode: '058',
    accountNumber: '1234567890',
    accountName: 'John Doe',
  },
};

function createMockSession(overrides: Partial<PaymentSession> = {}): PaymentSession {
  return {
    id: 'pay_test123456789012345678901',
    reference: '2S-TEST12',
    type: 'transfer',
    status: 'pending',
    fiatAmount: 50000,
    fiatCurrency: 'NGN',
    cryptoAmount: 31.5625,
    crypto: 'USDT',
    network: 'bep20',
    rate: 1600,
    assetPrice: 1,
    rateLockedAt: new Date(),
    chargeAmount: 500,
    chargeCrypto: 0.3125,
    depositAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f3eA42',
    walletId: 1,
    payerChatId: 'user123',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    ...overrides,
  };
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('SessionManager', () => {
  let manager: SessionManager;
  let mockRepo: ReturnType<typeof createMockRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo = createMockRepository();
    manager = new SessionManager(mockRepo as any);
  });

  // ===========================================================================
  // createSession
  // ===========================================================================

  describe('createSession', () => {
    it('should create a session with valid input', async () => {
      const session = await manager.createSession(validInput);

      expect(session.id).toBe('pay_test123456789012345678901');
      expect(session.reference).toBe('2S-TEST12');
      expect(session.status).toBe('pending');
      expect(session.fiatAmount).toBe(50000);
      expect(session.crypto).toBe('USDT');
      expect(session.network).toBe('bep20');
    });

    it('should lock the rate', async () => {
      const { lockRate } = await import('@/services/payment-engine/rate');

      await manager.createSession(validInput);

      expect(lockRate).toHaveBeenCalledWith('USDT', 'NGN', expect.any(Number));
    });

    it('should calculate charges', async () => {
      const { calculateCharges } = await import('@/services/payment-engine/charges');

      await manager.createSession(validInput);

      expect(calculateCharges).toHaveBeenCalledWith(
        50000,
        'USDT',
        expect.objectContaining({ rate: 1600 })
      );
    });

    it('should assign a wallet', async () => {
      const { assignWallet } = await import('@/services/payment-engine/wallet');

      await manager.createSession(validInput);

      expect(assignWallet).toHaveBeenCalledWith('bep20', expect.any(Number));
    });

    it('should save session to repository', async () => {
      await manager.createSession(validInput);

      expect(mockRepo.create).toHaveBeenCalled();
    });

    describe('input validation', () => {
      it('should throw InvalidInputError for missing type', async () => {
        const input = { ...validInput, type: undefined as any };

        await expect(manager.createSession(input)).rejects.toThrow(InvalidInputError);
      });

      it('should throw InvalidInputError for negative amount', async () => {
        const input = { ...validInput, fiatAmount: -100 };

        await expect(manager.createSession(input)).rejects.toThrow(InvalidInputError);
      });

      it('should throw InvalidInputError for zero amount', async () => {
        const input = { ...validInput, fiatAmount: 0 };

        await expect(manager.createSession(input)).rejects.toThrow(InvalidInputError);
      });

      it('should throw InvalidInputError for missing payer', async () => {
        const input = { ...validInput, payer: undefined as any };

        await expect(manager.createSession(input)).rejects.toThrow(InvalidInputError);
      });

      it('should throw InvalidInputError for missing receiver on transfer', async () => {
        const input = { ...validInput, receiver: undefined };

        await expect(manager.createSession(input)).rejects.toThrow(InvalidInputError);
      });

      it('should throw UnsupportedCryptoNetworkError for invalid combination', async () => {
        const input = { ...validInput, crypto: 'BTC' as const, network: 'tron' as const };

        await expect(manager.createSession(input)).rejects.toThrow(UnsupportedCryptoNetworkError);
      });
    });
  });

  // ===========================================================================
  // getSession
  // ===========================================================================

  describe('getSession', () => {
    it('should return session by ID', async () => {
      const mockSession = createMockSession();
      mockRepo._addSession(mockSession);

      const session = await manager.getSession(mockSession.id);

      expect(session.id).toBe(mockSession.id);
    });

    it('should throw SessionNotFoundError for non-existent ID', async () => {
      await expect(manager.getSession('pay_nonexistent')).rejects.toThrow(SessionNotFoundError);
    });
  });

  // ===========================================================================
  // getSessionByReference
  // ===========================================================================

  describe('getSessionByReference', () => {
    it('should return session by reference', async () => {
      const mockSession = createMockSession();
      mockRepo._addSession(mockSession);

      const session = await manager.getSessionByReference(mockSession.reference);

      expect(session.reference).toBe(mockSession.reference);
    });

    it('should throw SessionNotFoundError for non-existent reference', async () => {
      await expect(manager.getSessionByReference('2S-NOTFOUND')).rejects.toThrow(SessionNotFoundError);
    });
  });

  // ===========================================================================
  // State Transitions
  // ===========================================================================

  describe('state transitions', () => {
    describe('markDeposit', () => {
      it('should transition from pending to confirming', async () => {
        const mockSession = createMockSession({ status: 'pending' });
        mockRepo._addSession(mockSession);

        const updated = await manager.markDeposit(mockSession.id, '0xabc...', 31.5);

        expect(updated.status).toBe('confirming');
        expect(updated.txHash).toBe('0xabc...');
        expect(updated.receivedAmount).toBe(31.5);
      });

      it('should throw for non-pending session', async () => {
        const mockSession = createMockSession({ status: 'confirmed' });
        mockRepo._addSession(mockSession);

        await expect(manager.markDeposit(mockSession.id, '0xabc...', 31.5))
          .rejects.toThrow(InvalidSessionStateError);
      });
    });

    describe('confirmDeposit', () => {
      it('should transition from confirming to confirmed', async () => {
        const mockSession = createMockSession({ status: 'confirming' });
        mockRepo._addSession(mockSession);

        const updated = await manager.confirmDeposit(mockSession.id, 15);

        expect(updated.status).toBe('confirmed');
        expect(updated.confirmations).toBe(15);
        expect(updated.confirmedAt).toBeDefined();
      });

      it('should release the wallet', async () => {
        const mockSession = createMockSession({ status: 'confirming' });
        mockRepo._addSession(mockSession);
        const { releaseWallet } = await import('@/services/payment-engine/wallet');

        await manager.confirmDeposit(mockSession.id, 15);

        expect(releaseWallet).toHaveBeenCalledWith(mockSession.walletId, mockSession.network);
      });

      it('should throw for non-confirming session', async () => {
        const mockSession = createMockSession({ status: 'pending' });
        mockRepo._addSession(mockSession);

        await expect(manager.confirmDeposit(mockSession.id, 15))
          .rejects.toThrow(InvalidSessionStateError);
      });
    });

    describe('markSettling', () => {
      it('should transition from confirmed to settling', async () => {
        const mockSession = createMockSession({ status: 'confirmed' });
        mockRepo._addSession(mockSession);

        const updated = await manager.markSettling(mockSession.id);

        expect(updated.status).toBe('settling');
      });
    });

    describe('markSettled', () => {
      it('should transition from settling to settled', async () => {
        const mockSession = createMockSession({ status: 'settling' });
        mockRepo._addSession(mockSession);

        const updated = await manager.markSettled(mockSession.id);

        expect(updated.status).toBe('settled');
        expect(updated.settledAt).toBeDefined();
      });

      it('should throw for non-settling session', async () => {
        const mockSession = createMockSession({ status: 'confirmed' });
        mockRepo._addSession(mockSession);

        await expect(manager.markSettled(mockSession.id))
          .rejects.toThrow(InvalidSessionStateError);
      });
    });

    describe('expireSession', () => {
      it('should transition from pending to expired', async () => {
        const mockSession = createMockSession({ status: 'pending' });
        mockRepo._addSession(mockSession);

        const updated = await manager.expireSession(mockSession.id);

        expect(updated.status).toBe('expired');
      });

      it('should release the wallet', async () => {
        const mockSession = createMockSession({ status: 'pending' });
        mockRepo._addSession(mockSession);
        const { releaseWallet } = await import('@/services/payment-engine/wallet');

        await manager.expireSession(mockSession.id);

        expect(releaseWallet).toHaveBeenCalledWith(mockSession.walletId, mockSession.network);
      });

      it('should throw for non-pending session', async () => {
        const mockSession = createMockSession({ status: 'confirmed' });
        mockRepo._addSession(mockSession);

        await expect(manager.expireSession(mockSession.id))
          .rejects.toThrow(InvalidSessionStateError);
      });
    });

    describe('failSession', () => {
      it('should transition from pending to failed', async () => {
        const mockSession = createMockSession({ status: 'pending' });
        mockRepo._addSession(mockSession);

        const updated = await manager.failSession(mockSession.id);

        expect(updated.status).toBe('failed');
      });

      it('should transition from confirming to failed', async () => {
        const mockSession = createMockSession({ status: 'confirming' });
        mockRepo._addSession(mockSession);

        const updated = await manager.failSession(mockSession.id);

        expect(updated.status).toBe('failed');
      });

      it('should release wallet when failing pending session', async () => {
        const mockSession = createMockSession({ status: 'pending' });
        mockRepo._addSession(mockSession);
        const { releaseWallet } = await import('@/services/payment-engine/wallet');

        await manager.failSession(mockSession.id);

        expect(releaseWallet).toHaveBeenCalled();
      });

      it('should throw for terminal states', async () => {
        const mockSession = createMockSession({ status: 'settled' });
        mockRepo._addSession(mockSession);

        await expect(manager.failSession(mockSession.id))
          .rejects.toThrow(InvalidSessionStateError);
      });
    });
  });

  // ===========================================================================
  // Crypto/Network Validation
  // ===========================================================================

  describe('crypto/network validation', () => {
    it('should accept BTC on bitcoin', async () => {
      const input = { ...validInput, crypto: 'BTC' as const, network: 'bitcoin' as const };

      await expect(manager.createSession(input)).resolves.toBeDefined();
    });

    it('should accept USDT on erc20', async () => {
      const input = { ...validInput, crypto: 'USDT' as const, network: 'erc20' as const };

      await expect(manager.createSession(input)).resolves.toBeDefined();
    });

    it('should accept USDT on bep20', async () => {
      const input = { ...validInput, crypto: 'USDT' as const, network: 'bep20' as const };

      await expect(manager.createSession(input)).resolves.toBeDefined();
    });

    it('should accept USDT on trc20', async () => {
      const input = { ...validInput, crypto: 'USDT' as const, network: 'trc20' as const };

      await expect(manager.createSession(input)).resolves.toBeDefined();
    });

    it('should reject BTC on bep20', async () => {
      const input = { ...validInput, crypto: 'BTC' as const, network: 'bep20' as const };

      await expect(manager.createSession(input)).rejects.toThrow(UnsupportedCryptoNetworkError);
    });

    it('should reject ETH on bitcoin', async () => {
      const input = { ...validInput, crypto: 'ETH' as const, network: 'bitcoin' as const };

      await expect(manager.createSession(input)).rejects.toThrow(UnsupportedCryptoNetworkError);
    });
  });

  // ===========================================================================
  // Helper methods
  // ===========================================================================

  describe('helper methods', () => {
    describe('setPayerId', () => {
      it('should update payer ID', async () => {
        const mockSession = createMockSession();
        mockRepo._addSession(mockSession);

        const updated = await manager.setPayerId(mockSession.id, 123);

        expect(updated.payerId).toBe(123);
      });
    });

    describe('setReceiverId', () => {
      it('should update receiver ID', async () => {
        const mockSession = createMockSession();
        mockRepo._addSession(mockSession);

        const updated = await manager.setReceiverId(mockSession.id, 456);

        expect(updated.receiverId).toBe(456);
      });
    });

    describe('setCashback', () => {
      it('should set cashback amount', async () => {
        const mockSession = createMockSession();
        mockRepo._addSession(mockSession);

        const updated = await manager.setCashback(mockSession.id, 250);

        expect(updated.cashbackAmount).toBe(250);
      });
    });

    describe('creditCashback', () => {
      it('should mark cashback as credited', async () => {
        const mockSession = createMockSession({ cashbackAmount: 250 });
        mockRepo._addSession(mockSession);

        const updated = await manager.creditCashback(mockSession.id);

        expect(updated.cashbackCredited).toBe(true);
      });
    });
  });
});
