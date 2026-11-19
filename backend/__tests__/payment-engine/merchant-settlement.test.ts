import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  executed: [] as Array<{ sql: string; params: unknown[] }>,
}));

vi.mock('../../src/lib/mysql', () => {
  const execute = vi.fn(async (sql: string, params: unknown[] = []) => {
    db.executed.push({ sql, params });
    if (sql.includes('FROM payment_sessions WHERE id = ?')) return [[db.session]];
    if (sql.includes('FROM receivers')) {
      return [[{ id: 3, bank_code: '058', account_number: '0987654321', account_name: 'Jane Smith', bank_name: 'GTBank' }]];
    }
    if (sql.includes('INSERT INTO settlement_attempts')) return [{ insertId: 1 }];
    return [{ affectedRows: 1 }];
  });
  const pool = { execute, query: execute };
  return { pool, default: pool };
});

const apiKeyMock = vi.hoisted(() => ({ getApiKeyById: vi.fn() }));
vi.mock('../../src/security/services/apiKey.service', () => apiKeyMock);

vi.mock('../../src/services/payment-engine/payment-webhook.service', () => ({
  sendPaymentWebhook: vi.fn().mockResolvedValue(undefined),
}));

import { SettlementService } from '../../src/services/payment-engine/settlement/settlement.service';
import {
  MerchantSettlementWhatsApp,
  buildTemplateParameters,
  computeMerchantSettlementAmounts,
  MerchantSettlementInstruction,
} from '../../src/services/payment-engine/settlement/merchant-settlement';
import type { SettlementConfig } from '../../src/services/payment-engine/settlement/types';

describe('computeMerchantSettlementAmounts', () => {
  it('recipient gets the payout; 2Settle gets the spread at market rate', () => {
    // 1% spread: market 1600, quoted 1584. 94.69697 USDT x 1584 = 150,000 payout.
    const amounts = computeMerchantSettlementAmounts({
      payoutFiat: 150000,
      cryptoReceived: 94.69697,
      assetPrice: 1,
      rate: 1584,
      marketRate: 1600,
      fallbackSpread: 0.01,
    });
    expect(amounts).toEqual({ recipientAmount: 150000, profitAmount: 1515.15, profitEstimated: false });
  });

  it('counts crypto received beyond the payout amount as profit', () => {
    // Payer sent ₦500 worth more crypto than the payout amount passed in
    const cryptoReceived = (150000 + 500) / 1584;
    const { profitAmount } = computeMerchantSettlementAmounts({
      payoutFiat: 150000, cryptoReceived, assetPrice: 1, rate: 1584, marketRate: 1600, fallbackSpread: 0.01,
    });
    // ₦500 extra + 1% spread on the whole ₦150,500 (₦1,520.20)
    expect(profitAmount).toBeCloseTo(2020.20, 2);
  });

  it('re-derives the market rate from the current spread for older sessions, flagged as estimated', () => {
    const amounts = computeMerchantSettlementAmounts({
      payoutFiat: 150000, cryptoReceived: 94.69697, assetPrice: 1, rate: 1584, marketRate: null, fallbackSpread: 0.01,
    });
    expect(amounts.profitAmount).toBeCloseTo(1515.15, 1);
    expect(amounts.profitEstimated).toBe(true);
  });

  it('never reports a negative profit', () => {
    const { profitAmount } = computeMerchantSettlementAmounts({
      payoutFiat: 150000, cryptoReceived: 90, assetPrice: 1, rate: 1584, marketRate: 1600, fallbackSpread: 0.01,
    });
    expect(profitAmount).toBe(0);
  });
});

const instruction: MerchantSettlementInstruction = {
  reference: '2S-ABC123',
  fiatCurrency: 'NGN',
  crypto: 'BTC',
  network: 'bitcoin',
  cryptoReceived: 0.0015,
  txHash: 'abc123',
  recipient: { accountName: 'Jane\nSmith', bankName: 'GTBank', accountNumber: '0987654321' },
  recipientAmount: 150000,
  profitAmount: 1515.15,
  profitAccount: { accountName: '2Settle Ltd', bankName: 'Providus', accountNumber: '1234567890' },
};

describe('buildTemplateParameters', () => {
  it('produces the 12 template parameters in order, WhatsApp-safe', () => {
    expect(buildTemplateParameters(instruction)).toEqual([
      '2S-ABC123',
      '0.0015 BTC',
      'abc123',
      'https://mempool.space/tx/abc123',
      'NGN 150,000.00',
      'Jane Smith', // newline removed - not allowed in template params
      'GTBank',
      '0987654321',
      'NGN 1,515.15',
      '2Settle Ltd',
      'Providus',
      '1234567890',
    ]);
  });
});

describe('SettlementService - merchant-collected session', () => {
  const settlementConfig = {
    enabled: true,
    merchantCollection: {
      whatsapp: { enabled: true, templateName: 'merchant_settlement', templateLanguage: 'en' },
      profitAccount: { bankName: 'Providus', accountNumber: '1234567890', accountName: '2Settle Ltd' },
    },
  } as unknown as SettlementConfig;

  let router: { dispatch: ReturnType<typeof vi.fn> };
  let telegram: { sendMessage: ReturnType<typeof vi.fn> };
  let whatsapp: { send: ReturnType<typeof vi.fn> };
  let service: SettlementService;

  beforeEach(() => {
    db.executed = [];
    db.session = {
      id: 'pay_1',
      reference: '2S-ABC123',
      status: 'confirmed',
      fiat_amount: '150000',
      settled_fiat_amount: null,
      fiat_currency: 'NGN',
      receiver_id: 3,
      api_key_id: 9,
      is_sandbox: 0,
      description: null,
      collection_mode: 'merchant',
      crypto: 'USDT',
      network: 'trc20',
      crypto_amount: '94.69697',
      received_amount: '94.69697',
      rate: '1584',
      market_rate: '1600',
      asset_price: '1',
      tx_hash: 'deadbeef',
    };
    apiKeyMock.getApiKeyById.mockResolvedValue({ settlementMode: 'mongoro', whatsappPhone: '+2348012345678' });
    router = { dispatch: vi.fn() };
    telegram = { sendMessage: vi.fn().mockResolvedValue(true) };
    whatsapp = { send: vi.fn().mockResolvedValue('wamid.123') };
    service = new SettlementService(
      settlementConfig,
      router as any,
      telegram as any,
      {} as any,
      whatsapp as unknown as MerchantSettlementWhatsApp
    );
  });

  const sqlRan = (fragment: string) => db.executed.filter((e) => e.sql.includes(fragment));

  it('WhatsApps the merchant the recipient + profit instruction and pays nothing out', async () => {
    await service.settleSession('pay_1');

    expect(router.dispatch).not.toHaveBeenCalled();
    expect(whatsapp.send).toHaveBeenCalledWith('+2348012345678', expect.objectContaining({
      reference: '2S-ABC123',
      txHash: 'deadbeef',
      recipientAmount: 150000,
      profitAmount: 1515.15,
      recipient: { accountName: 'Jane Smith', bankName: 'GTBank', accountNumber: '0987654321' },
      profitAccount: { bankName: 'Providus', accountNumber: '1234567890', accountName: '2Settle Ltd' },
    }));

    // stays 'settling' (admin marks settled), never 'settled'
    expect(sqlRan("SET status = ?").map((e) => e.params[0])).toEqual(['settling']);
    expect(sqlRan("status = 'settled'")).toHaveLength(0);

    const attempt = sqlRan('INSERT INTO settlement_attempts')[0].params;
    expect(attempt[1]).toBe('merchant_whatsapp');
    expect(attempt[2]).toBe('wamid.123');
    expect(attempt[3]).toBe('pending');
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('falls back to a Telegram alert with the full instruction when WhatsApp fails', async () => {
    whatsapp.send.mockRejectedValue(new Error('WhatsApp settlement message failed: 132001 template not found'));

    await service.settleSession('pay_1');

    expect(router.dispatch).not.toHaveBeenCalled();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    const alert = telegram.sendMessage.mock.calls[0][0] as string;
    expect(alert).toContain('2S-ABC123');
    expect(alert).toContain('deadbeef');
    expect(alert).toContain('NGN 150,000.00');
    expect(alert).toContain('NGN 1,515.15');
    expect(alert).toContain('template not found');

    const attempt = sqlRan('INSERT INTO settlement_attempts')[0].params;
    expect(attempt[3]).toBe('failed');
  });

  it('alerts Telegram when the merchant has no WhatsApp number', async () => {
    apiKeyMock.getApiKeyById.mockResolvedValue({ settlementMode: 'mongoro', whatsappPhone: null });

    await service.settleSession('pay_1');

    expect(whatsapp.send).not.toHaveBeenCalled();
    expect(telegram.sendMessage.mock.calls[0][0]).toContain('no WhatsApp number');
  });

  it('leaves HD-collected sessions on the normal payout path', async () => {
    db.session = { ...db.session, collection_mode: 'hd' };
    router.dispatch.mockResolvedValue({
      provider: 'hyparrow',
      result: { success: true, reference: 'hp-1', message: 'ok' },
    });

    await service.settleSession('pay_1');

    expect(router.dispatch).toHaveBeenCalledTimes(1);
    expect(whatsapp.send).not.toHaveBeenCalled();
  });
});
