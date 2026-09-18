import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LegacySyncService } from '@/services/payment-engine/sync/legacy-sync.service';
import type { PaymentSession } from '@/services/payment-engine/types';

const mysqlMock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/mysql', () => ({ default: mysqlMock }));

const gift: PaymentSession = {
  id: 'pay_gift', reference: 'GP-TRACK2', type: 'gift', status: 'pending',
  fiatAmount: 2000, fiatCurrency: 'NGN', createdAt: new Date(), expiresAt: new Date(),
};

describe('gift legacy sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mysqlMock.query.mockResolvedValue([[]]);
  });

  it('creates neither a legacy gift nor summary before code issuance', async () => {
    await new LegacySyncService().syncToLegacy(gift);
    expect(mysqlMock.query).not.toHaveBeenCalled();
  });

  it('mirrors the funded claim code, not the tracking reference', async () => {
    await new LegacySyncService().syncToLegacy({ ...gift, status: 'confirmed', giftId: '2S-GIFT22' });
    const insert = mysqlMock.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO gifts'))!;
    expect(insert[1][0]).toBe('2S-GIFT22');
    expect(insert[1][1]).toBe('Not claimed');
    expect(insert[1][16]).toBe('Successful');
    expect(mysqlMock.query.mock.calls[2][1]).toEqual(['2S-GIFT22']);
  });
});
