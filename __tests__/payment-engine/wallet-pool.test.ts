/**
 * Wallet Pool Tests
 *
 * Tests for wallet assignment and release.
 * These tests mock the database connection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assignWallet,
  releaseWallet,
  releaseWalletByAddress,
  getPoolStatus,
} from '@/services/payment-engine/wallet/wallet-pool';
import { WalletPoolEmptyError, DatabaseError } from '@/services/payment-engine/errors';

// ===========================================================================
// MOCKS
// ===========================================================================

// Create mock connection
const mockConnection = {
  beginTransaction: vi.fn(),
  query: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};

// Mock the MySQL pool
vi.mock('@/lib/mysql', () => ({
  default: {
    getConnection: vi.fn(() => Promise.resolve(mockConnection)),
    query: vi.fn(),
  },
}));

// ===========================================================================
// TEST HELPERS
// ===========================================================================

function resetMocks() {
  vi.clearAllMocks();
  mockConnection.beginTransaction.mockResolvedValue(undefined);
  mockConnection.commit.mockResolvedValue(undefined);
  mockConnection.rollback.mockResolvedValue(undefined);
  mockConnection.release.mockResolvedValue(undefined);
}

/**
 * Mock a wallet being available.
 */
function mockWalletAvailable(wallet: {
  id: number;
  bitcoin?: string;
  evm?: string;
  tron?: string;
}) {
  mockConnection.query.mockResolvedValueOnce([[wallet]]);
  mockConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
}

/**
 * Mock no wallets available.
 */
function mockNoWalletsAvailable() {
  mockConnection.query.mockResolvedValueOnce([[]]);
  // Mock the estimated wait time query
  mockConnection.query.mockResolvedValueOnce([[{ oldest_assigned: null }]]);
}

/**
 * Mock wallet with estimated wait time.
 */
function mockNoWalletsWithWaitTime(waitMinutes: number) {
  mockConnection.query.mockResolvedValueOnce([[]]);
  // Mock the estimated wait time query
  const oldestAssigned = new Date(Date.now() - (30 - waitMinutes) * 60 * 1000);
  mockConnection.query.mockResolvedValueOnce([[{ oldest_assigned: oldestAssigned }]]);
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('Wallet Pool', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ===========================================================================
  // assignWallet
  // ===========================================================================

  describe('assignWallet', () => {
    describe('for Bitcoin', () => {
      it('should assign an available Bitcoin wallet', async () => {
        mockWalletAvailable({
          id: 1,
          bitcoin: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        });

        const result = await assignWallet('bitcoin');

        expect(result.address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
        expect(result.walletId).toBe(1);
        expect(result.assignedAt).toBeInstanceOf(Date);
        expect(result.expiresAt).toBeInstanceOf(Date);
      });

      it('should use bitcoin_flag column for bitcoin network', async () => {
        mockWalletAvailable({ id: 1, bitcoin: 'bc1q...' });

        await assignWallet('bitcoin');

        // Check that the query used bitcoin_flag
        expect(mockConnection.query).toHaveBeenCalledWith(
          expect.stringContaining('bitcoin_flag'),
          expect.anything()
        );
      });
    });

    describe('for EVM chains', () => {
      it('should assign wallet for ethereum', async () => {
        mockWalletAvailable({
          id: 2,
          evm: '0x742d35Cc6634C0532925a3b844Bc9e7595f3eA42',
        });

        const result = await assignWallet('ethereum');

        expect(result.address).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f3eA42');
        expect(result.walletId).toBe(2);
      });

      it('should assign wallet for bsc', async () => {
        mockWalletAvailable({
          id: 3,
          evm: '0x742d35Cc6634C0532925a3b844Bc9e7595f3eA42',
        });

        const result = await assignWallet('bsc');

        expect(result.address).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f3eA42');
      });

      it('should assign wallet for erc20', async () => {
        mockWalletAvailable({
          id: 4,
          evm: '0x123...',
        });

        const result = await assignWallet('erc20');

        expect(result.address).toBe('0x123...');
      });

      it('should assign wallet for bep20', async () => {
        mockWalletAvailable({
          id: 5,
          evm: '0x456...',
        });

        const result = await assignWallet('bep20');

        expect(result.address).toBe('0x456...');
      });
    });

    describe('for TRON', () => {
      it('should assign wallet for tron', async () => {
        mockWalletAvailable({
          id: 6,
          tron: 'TJYeasTPa6gpRBpzHqvgFgJdw9NXNS6EBL',
        });

        const result = await assignWallet('tron');

        expect(result.address).toBe('TJYeasTPa6gpRBpzHqvgFgJdw9NXNS6EBL');
      });

      it('should assign wallet for trc20', async () => {
        mockWalletAvailable({
          id: 7,
          tron: 'T...',
        });

        const result = await assignWallet('trc20');

        expect(result.address).toBe('T...');
      });
    });

    describe('when no wallets available', () => {
      it('should throw WalletPoolEmptyError', async () => {
        mockNoWalletsAvailable();

        await expect(assignWallet('bitcoin')).rejects.toThrow(WalletPoolEmptyError);
      });

      it('should include network in error', async () => {
        mockNoWalletsAvailable();

        try {
          await assignWallet('bep20');
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(WalletPoolEmptyError);
          expect((error as WalletPoolEmptyError).network).toBe('bep20');
        }
      });

      it('should include estimated wait time when available', async () => {
        mockNoWalletsWithWaitTime(5); // 5 minutes wait

        try {
          await assignWallet('bitcoin');
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(WalletPoolEmptyError);
          // Should have some wait time
          expect((error as WalletPoolEmptyError).estimatedWaitSeconds).toBeDefined();
        }
      });
    });

    describe('transaction handling', () => {
      it('should begin transaction before querying', async () => {
        mockWalletAvailable({ id: 1, bitcoin: 'bc1q...' });

        await assignWallet('bitcoin');

        // Verify transaction was started
        expect(mockConnection.beginTransaction).toHaveBeenCalled();
        // Verify query was called after
        expect(mockConnection.query).toHaveBeenCalled();
      });

      it('should commit transaction on success', async () => {
        mockWalletAvailable({ id: 1, bitcoin: 'bc1q...' });

        await assignWallet('bitcoin');

        expect(mockConnection.commit).toHaveBeenCalled();
      });

      it('should rollback transaction on failure', async () => {
        mockNoWalletsAvailable();

        try {
          await assignWallet('bitcoin');
        } catch {
          // Expected
        }

        expect(mockConnection.rollback).toHaveBeenCalled();
      });

      it('should release connection after success', async () => {
        mockWalletAvailable({ id: 1, bitcoin: 'bc1q...' });

        await assignWallet('bitcoin');

        expect(mockConnection.release).toHaveBeenCalled();
      });

      it('should release connection after failure', async () => {
        mockNoWalletsAvailable();

        try {
          await assignWallet('bitcoin');
        } catch {
          // Expected
        }

        expect(mockConnection.release).toHaveBeenCalled();
      });
    });

    describe('expiry calculation', () => {
      it('should set expiry based on TTL', async () => {
        mockWalletAvailable({ id: 1, bitcoin: 'bc1q...' });

        const result = await assignWallet('bitcoin', 60); // 60 minutes

        const expectedExpiry = result.assignedAt.getTime() + 60 * 60 * 1000;
        expect(result.expiresAt.getTime()).toBeCloseTo(expectedExpiry, -3);
      });

      it('should use default TTL of 30 minutes', async () => {
        mockWalletAvailable({ id: 1, bitcoin: 'bc1q...' });

        const result = await assignWallet('bitcoin');

        const expectedExpiry = result.assignedAt.getTime() + 30 * 60 * 1000;
        expect(result.expiresAt.getTime()).toBeCloseTo(expectedExpiry, -3);
      });
    });
  });

  // ===========================================================================
  // releaseWallet
  // ===========================================================================

  describe('releaseWallet', () => {
    it('should release a Bitcoin wallet', async () => {
      const pool = (await import('@/lib/mysql')).default;
      (pool.query as any).mockResolvedValue([{ affectedRows: 1 }]);

      await releaseWallet(1, 'bitcoin');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('bitcoin_flag'),
        expect.arrayContaining([1])
      );
    });

    it('should release an EVM wallet for bep20', async () => {
      const pool = (await import('@/lib/mysql')).default;
      (pool.query as any).mockResolvedValue([{ affectedRows: 1 }]);

      await releaseWallet(2, 'bep20');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('bep20_flag'),
        expect.arrayContaining([2])
      );
    });

    it('should release a TRON wallet', async () => {
      const pool = (await import('@/lib/mysql')).default;
      (pool.query as any).mockResolvedValue([{ affectedRows: 1 }]);

      await releaseWallet(3, 'tron');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('tron_flag'),
        expect.arrayContaining([3])
      );
    });

    it('should throw DatabaseError on failure', async () => {
      const pool = (await import('@/lib/mysql')).default;
      (pool.query as any).mockRejectedValue(new Error('DB error'));

      await expect(releaseWallet(1, 'bitcoin')).rejects.toThrow(DatabaseError);
    });
  });

  // ===========================================================================
  // releaseWalletByAddress
  // ===========================================================================

  describe('releaseWalletByAddress', () => {
    it('should release wallet by Bitcoin address', async () => {
      const pool = (await import('@/lib/mysql')).default;
      (pool.query as any).mockResolvedValue([{ affectedRows: 1 }]);

      await releaseWalletByAddress('bc1q...', 'bitcoin');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringMatching(/bitcoin_flag.*bitcoin/s),
        expect.arrayContaining(['bc1q...'])
      );
    });

    it('should release wallet by EVM address', async () => {
      const pool = (await import('@/lib/mysql')).default;
      (pool.query as any).mockResolvedValue([{ affectedRows: 1 }]);

      await releaseWalletByAddress('0x123...', 'bep20');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringMatching(/bep20_flag.*evm/s),
        expect.arrayContaining(['0x123...'])
      );
    });
  });

  // ===========================================================================
  // getPoolStatus
  // ===========================================================================

  describe('getPoolStatus', () => {
    it('should return status for all networks', async () => {
      const pool = (await import('@/lib/mysql')).default;
      (pool.query as any).mockResolvedValue([[{
        btc_available: 3,
        btc_in_use: 2,
        eth_available: 4,
        eth_in_use: 1,
        bsc_available: 5,
        bsc_in_use: 0,
        tron_available: 3,
        tron_in_use: 2,
        erc20_available: 4,
        erc20_in_use: 1,
        bep20_available: 5,
        bep20_in_use: 0,
        trc20_available: 3,
        trc20_in_use: 2,
      }]]);

      const status = await getPoolStatus();

      expect(status.bitcoin).toEqual({ available: 3, inUse: 2 });
      expect(status.ethereum).toEqual({ available: 4, inUse: 1 });
      expect(status.bsc).toEqual({ available: 5, inUse: 0 });
      expect(status.tron).toEqual({ available: 3, inUse: 2 });
      expect(status.erc20).toEqual({ available: 4, inUse: 1 });
      expect(status.bep20).toEqual({ available: 5, inUse: 0 });
      expect(status.trc20).toEqual({ available: 3, inUse: 2 });
    });
  });
});
