/**
 * Session Repository Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRepository } from '@/services/payment-engine/session/session-repository';
import { generateGiftId } from '@/services/payment-engine/utils/id-generator';

vi.mock('@/services/payment-engine/utils/id-generator', () => ({
  generateGiftId: vi.fn().mockReturnValue('2S-GIFT22'),
}));

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

  const paidGiftRow = {
    id: 'pay_gift', reference: 'GP-TRACK2', type: 'gift',
    status: 'confirmed', gift_id: '2S-GIFT22', fiat_amount: 2000,
    fiat_currency: 'NGN', created_at: new Date(), expires_at: new Date(),
  };

  describe('deferred gift IDs', () => {
    it('does not allocate a code when creating the payment session', async () => {
      const session = await repository.create({
        id: 'pay_gift', reference: 'GP-TRACK2', type: 'gift', fiatAmount: 2000,
        fiatCurrency: 'NGN', expiresAt: new Date(), depositAddress: '0xDeposit',
      });
      expect(session.giftId).toBeUndefined();
      expect(generateGiftId).not.toHaveBeenCalled();
      expect(mysqlMock.query.mock.calls[0][0]).not.toContain('gift_id');
    });

    it.each(['pending', 'confirming', 'expired', 'failed'] as const)(
      'does not allocate a code on %s updates', async (status) => {
        mysqlMock.query.mockResolvedValueOnce([{ affectedRows: 1 }])
          .mockResolvedValueOnce([[{ ...paidGiftRow, status, gift_id: null }]]);
        const session = await repository.update('pay_gift', { status });
        expect(session.giftId).toBeUndefined();
        expect(generateGiftId).not.toHaveBeenCalled();
        expect(mysqlMock.query.mock.calls[0][0]).not.toContain('gift_id =');
      }
    );

    it('allocates a code in the same update as confirmation', async () => {
      mysqlMock.query.mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[paidGiftRow]]);
      const session = await repository.update('pay_gift', { status: 'confirmed' });
      expect(mysqlMock.query.mock.calls[0][0]).toContain("CASE WHEN type = 'gift' THEN COALESCE(gift_id, ?)");
      expect(mysqlMock.query.mock.calls[0][1].slice(0, 2)).toEqual(['confirmed', '2S-GIFT22']);
      expect(session.giftId).toBe('2S-GIFT22');
      expect(session.reference).toBe('GP-TRACK2');
    });

    it('preserves an issued code across repeated or concurrent confirmations', async () => {
      let storedCode: string | undefined;
      mysqlMock.query.mockImplementation(async (sql: string, values: any[]) => {
        if (sql.startsWith('UPDATE')) {
          storedCode ??= values[1];
          return [{ affectedRows: 1 }];
        }
        return [[{ ...paidGiftRow, gift_id: storedCode }]];
      });
      const first = await repository.update('pay_gift', { status: 'confirmed' });
      vi.mocked(generateGiftId).mockReturnValueOnce('2S-OTHER2');
      const second = await repository.update('pay_gift', { status: 'confirmed' });
      expect(second.giftId).toBe(first.giftId);
    });

    it('retries a unique-code collision without regenerating a payment', async () => {
      mysqlMock.query.mockRejectedValueOnce({ code: 'ER_DUP_ENTRY' })
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[paidGiftRow]]);
      await repository.update('pay_gift', { status: 'confirmed' });
      expect(generateGiftId).toHaveBeenCalledTimes(2);
      expect(mysqlMock.query).toHaveBeenCalledTimes(3);
    });

    it('avoids a code already reserved by an old unpaid legacy gift', async () => {
      mysqlMock.query.mockResolvedValueOnce([{ affectedRows: 0 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[paidGiftRow]]);
      await repository.update('pay_gift', { status: 'confirmed' });
      expect(mysqlMock.query.mock.calls[0][0]).toContain('NOT EXISTS (SELECT 1 FROM gifts WHERE gift_id = ?)');
      expect(generateGiftId).toHaveBeenCalledTimes(2);
    });

    it('does not return a payment reference from a gift-code lookup', async () => {
      expect(await repository.findByGiftId('GP-TRACK2')).toBeNull();
      expect(mysqlMock.query).toHaveBeenCalledWith(
        expect.stringContaining("type = 'gift' AND gift_id = ?"), ['GP-TRACK2']
      );
    });

    it.each([null, { event: 'funded' }, JSON.stringify({ event: 'funded' })])(
      'reads metadata without breaking existing funded gift IDs', async (metadata) => {
        mysqlMock.query.mockResolvedValueOnce([[{ ...paidGiftRow, metadata }]]);
        expect((await repository.findByGiftId('2S-GIFT22'))?.giftId).toBe('2S-GIFT22');
      }
    );
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
