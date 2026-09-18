import { beforeEach, describe, expect, it, vi } from 'vitest';
import router from '@/routes/payment.routes';
import { SessionNotFoundError } from '@/services/payment-engine/errors';
import { createPaymentSchema } from '@/validation/payment.schemas';

const mocks = vi.hoisted(() => ({
  engine: {
    createPayment: vi.fn(), getPayment: vi.fn(), setPayerId: vi.fn(),
    getPaymentByReference: vi.fn(), getPaymentByGiftId: vi.fn(), setReceiverId: vi.fn(),
  },
  settle: vi.fn(), sync: vi.fn(), resolve: vi.fn(),
}));
vi.mock('@/services/payment-engine', () => ({ paymentEngine: mocks.engine }));
vi.mock('@/services/payment-engine/participant', () => ({
  participantService: { getOrCreatePayer: vi.fn().mockResolvedValue(1), getOrCreateReceiver: vi.fn().mockResolvedValue(2) },
}));
vi.mock('@/services/payment-engine/session-owner', () => ({
  getSessionOwnerScope: () => 'test',
  sessionOwnerService: { getOrCreateSessionOwner: vi.fn().mockResolvedValue(1) },
}));
vi.mock('@/services/payment-engine/sync', () => ({ legacySyncService: { syncToLegacy: mocks.sync } }));
vi.mock('@/services/payment-engine/settlement/settlement.service', () => ({ settlementService: { settleSession: mocks.settle } }));
vi.mock('@/services/bank/bank.service', () => ({ bankService: { resolveAccount: mocks.resolve } }));
vi.mock('@/services/payment-engine/session/session-manager', () => ({ sessionManager: {} }));
vi.mock('@/services/payment-engine/payment-webhook.service', () => ({ sendPaymentWebhook: vi.fn() }));
vi.mock('@/security/middleware/authenticate', () => ({ requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next() }));

const giftInput = {
  type: 'gift', fiatAmount: 2000, fiatCurrency: 'NGN', crypto: 'USDT', network: 'erc20',
  chargeFrom: 'crypto', payer: { chatId: 'test-payer' },
};
const pending = {
  id: 'pay_gift', reference: 'GP-TRACK2', type: 'gift', status: 'pending', fiatAmount: 2000,
  fiatCurrency: 'NGN', crypto: 'USDT', network: 'erc20', depositAddress: '0xDeposit', cryptoAmount: 2,
};

// Invoke the actual route handler with response spies; no sockets or real DB.
function handler(method: string, path: string | string[]) {
  const route = (router as any).stack.find((layer: any) =>
    JSON.stringify(layer.route?.path) === JSON.stringify(path) && layer.route.methods[method]
  ).route;
  return route.stack[route.stack.length - 1].handle;
}
function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

describe('deferred gift API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.engine.createPayment.mockResolvedValue(pending);
    mocks.engine.getPayment.mockResolvedValue(pending);
    mocks.sync.mockResolvedValue(undefined);
    mocks.settle.mockResolvedValue(undefined);
  });

  it('returns payment instructions and giftId null before payment', async () => {
    const res = response();
    await handler('post', '/')({ body: giftInput }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      payment: expect.objectContaining({ reference: 'GP-TRACK2', giftId: null, depositAddress: '0xDeposit' }),
    }));
  });

  it('rejects autoSettle as a way to create a gift code before payment', () => {
    expect(createPaymentSchema.safeParse({ ...giftInput, autoSettle: true }).success).toBe(false);
  });

  it('returns the issued code when polling the funded tracking reference', async () => {
    mocks.engine.getPaymentByReference.mockResolvedValue({ ...pending, status: 'confirmed', giftId: '2S-GIFT22' });
    const res = response();
    await handler('get', ['/:reference', '/gifts/:giftId'])({ params: { reference: 'GP-TRACK2' } }, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      payment: expect.objectContaining({ reference: 'GP-TRACK2', giftId: '2S-GIFT22' }),
    }));
  });

  it('looks up recipient gift details by gift code, not tracking reference', async () => {
    mocks.engine.getPaymentByGiftId.mockResolvedValue({ ...pending, status: 'confirmed', giftId: '2S-GIFT22' });
    await handler('get', ['/:reference', '/gifts/:giftId'])({ params: { giftId: '2S-GIFT22' } }, response(), vi.fn());
    expect(mocks.engine.getPaymentByGiftId).toHaveBeenCalledWith('2S-GIFT22');
    expect(mocks.engine.getPaymentByReference).not.toHaveBeenCalled();
  });

  it('does not allow the internal tracking reference to be claimed', async () => {
    mocks.engine.getPaymentByGiftId.mockRejectedValue(new SessionNotFoundError('GP-TRACK2'));
    const res = response();
    await handler('post', '/gifts/:reference/claim/confirm')({
      params: { reference: 'GP-TRACK2' }, body: { bankCode: 'test-bank', accountNumber: '1234567890' },
    }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mocks.engine.getPaymentByReference).not.toHaveBeenCalled();
    expect(mocks.engine.setReceiverId).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });
});
