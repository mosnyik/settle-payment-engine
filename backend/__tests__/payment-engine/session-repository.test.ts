/**
 * Session Repository Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRepository } from '@/services/payment-engine/session/session-repository';

const mysqlMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('@/lib/mysql', () => ({
  default: mysqlMock,
}));

describe('SessionRepository', () => {
  let repository: SessionRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mysqlMock.query.mockResolvedValue([[]]);
    repository = new SessionRepository();
  });

  describe('findActiveByDepositAddress', () => {
    it('filters active address lookup by asset', async () => {
      await repository.findActiveByDepositAddress('TReusableAddress', 'USDT');

      expect(mysqlMock.query).toHaveBeenCalledWith(
        expect.stringContaining('AND crypto = ?'),
        ['TReusableAddress', 'USDT']
      );
    });

    it('keeps excluded session after the asset parameter', async () => {
      await repository.findActiveByDepositAddress('0xReusableAddress', 'ETH', 'pay_request');

      expect(mysqlMock.query).toHaveBeenCalledWith(
        expect.stringContaining('AND id <> ?'),
        ['0xReusableAddress', 'ETH', 'pay_request']
      );
    });
  });
});
