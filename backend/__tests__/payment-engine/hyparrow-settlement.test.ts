import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HyparrowService,
  verifyHyparrowSignature,
} from '../../src/services/payment-engine/settlement/hyparrow.service';
import {
  HyparrowSettlementProvider,
  toKobo,
} from '../../src/services/payment-engine/settlement/providers/hyparrow.provider';
import { HyparrowConfig, SettlementRequest } from '../../src/services/payment-engine/settlement/types';

const hyparrowConfig: HyparrowConfig = {
  baseUrl: 'https://sandbox.hyparrow.test/api/v1',
  apiKey: 'pk_test_1',
  apiSecret: 'sk_test_1',
  webhookSecret: 'whsec',
  senderPhone: '08030000000',
  senderEmail: 'ops@2settle.test',
  senderLastname: 'Settle',
  senderOthernames: 'Two',
  timeoutMs: 1000,
};

const request: SettlementRequest = {
  sessionId: 'sess-1',
  amount: 5000.5,
  currency: 'NGN',
  accountNumber: '0123456789',
  bankCode: '058',
  accountName: 'Jane Doe',
  narration: '2Settle 2S-ABC',
};

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HyparrowService.send', () => {
  const service = new HyparrowService(hyparrowConfig);
  const send = () => service.send({
    amount: '500050',
    recipientAccount: '0123456789',
    recipientBankCode: '058',
    recipientName: 'JANE DOE',
    senderPhone: '08030000000',
    senderEmail: 'ops@2settle.test',
    senderLastname: 'Settle',
    senderOthernames: 'Two',
    clientReference: '2S-sess-1',
  });

  it('treats 202 (network did not answer) as accepted, not failed', async () => {
    mockFetch(202, { success: true, data: { TransferCode: '145', Status: 'pending', Fee: 2500 } });
    await expect(send()).resolves.toMatchObject({ kind: 'accepted', transferCode: '145', fee: 2500 });
  });

  it('treats an idempotent replay of a reversed transfer as rejected', async () => {
    mockFetch(200, { success: true, data: { TransferCode: '145', Status: 'reversed' } });
    await expect(send()).resolves.toMatchObject({ kind: 'rejected' });
  });

  it('treats 4xx as rejected', async () => {
    mockFetch(409, { success: false, error: 'conflict', code: 'CLIENT_REFERENCE_CONFLICT' });
    await expect(send()).resolves.toMatchObject({ kind: 'rejected', message: 'conflict' });
  });

  it('treats a 502 that says reversed as rejected', async () => {
    mockFetch(502, { success: false, error: 'Transfer rejected by network', status: 'reversed' });
    await expect(send()).resolves.toMatchObject({ kind: 'rejected' });
  });

  it('treats an unexplained 5xx as unknown', async () => {
    mockFetch(503, { success: false });
    await expect(send()).resolves.toMatchObject({ kind: 'unknown' });
  });

  it('treats a dropped connection as unknown', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket hang up'));
    await expect(send()).resolves.toMatchObject({ kind: 'unknown' });
  });

  it('sends credentials and the clientReference', async () => {
    const fetchSpy = mockFetch(200, { success: true, data: { TransferCode: '1', Status: 'pending' } });
    await send();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://sandbox.hyparrow.test/api/v1/money-transfer/send');
    expect((init?.headers as Record<string, string>)['X-API-Key']).toBe('pk_test_1');
    expect(JSON.parse(init?.body as string).clientReference).toBe('2S-sess-1');
  });
});

describe('HyparrowSettlementProvider.transfer', () => {
  function providerWith(overrides: Partial<Pick<HyparrowService, 'resolveAccount' | 'send' | 'getStatus'>>) {
    const service = new HyparrowService(hyparrowConfig);
    vi.spyOn(service, 'resolveAccount').mockResolvedValue({ ok: true, accountName: 'JANE DOE' });
    for (const [name, impl] of Object.entries(overrides)) {
      vi.spyOn(service, name as 'send').mockImplementation(impl as never);
    }
    return { provider: new HyparrowSettlementProvider(service, hyparrowConfig), service };
  }

  it('converts naira to kobo', () => {
    expect(toKobo(5000.5)).toBe('500050');
    expect(toKobo(0.1 + 0.2)).toBe('30');
  });

  it('uses a stable per-session reference and the bank-resolved name', async () => {
    const { provider, service } = providerWith({
      send: async () => ({ kind: 'accepted', status: 'pending', raw: {} }),
    });

    const result = await provider.transfer(request);

    expect(result).toMatchObject({ success: true, reference: '2S-sess-1' });
    expect(result.uncertain).toBeUndefined();
    expect(service.send).toHaveBeenCalledWith(expect.objectContaining({
      amount: '500050',
      recipientName: 'JANE DOE',
      clientReference: '2S-sess-1',
    }));
  });

  it('does not send when the account cannot be resolved', async () => {
    const { provider, service } = providerWith({
      resolveAccount: async () => ({ ok: false, message: 'could not verify' }),
      send: async () => ({ kind: 'accepted', status: 'pending', raw: {} }),
    });

    await expect(provider.transfer(request)).resolves.toMatchObject({ success: false });
    expect(service.send).not.toHaveBeenCalled();
  });

  it('fails on a definite rejection', async () => {
    const { provider } = providerWith({
      send: async () => ({ kind: 'rejected', message: 'Insufficient wallet balance' }),
    });

    await expect(provider.transfer(request)).resolves.toMatchObject({
      success: false,
      message: 'Insufficient wallet balance',
    });
  });

  it('recovers a lost response by looking the transfer up', async () => {
    const { provider } = providerWith({
      send: async () => ({ kind: 'unknown', message: 'timeout' }),
      getStatus: async () => ({ kind: 'found', settlementStatus: 'pending', raw: {} }),
    });

    const result = await provider.transfer(request);
    expect(result).toMatchObject({ success: true, reference: '2S-sess-1' });
    expect(result.uncertain).toBeUndefined();
  });

  it('fails when the looked-up transfer was reversed', async () => {
    const { provider } = providerWith({
      send: async () => ({ kind: 'unknown', message: 'timeout' }),
      getStatus: async () => ({ kind: 'found', settlementStatus: 'reversed', raw: {} }),
    });

    await expect(provider.transfer(request)).resolves.toMatchObject({ success: false });
  });

  it('holds as uncertain (never failed) when the outcome cannot be determined', async () => {
    const { provider } = providerWith({
      send: async () => ({ kind: 'unknown', message: 'timeout' }),
      getStatus: async () => ({ kind: 'error', message: 'timeout' }),
    });

    await expect(provider.transfer(request)).resolves.toMatchObject({
      success: true,
      uncertain: true,
      reference: '2S-sess-1',
    });
  });

  it('refuses non-NGN payouts', async () => {
    const { provider } = providerWith({});
    await expect(provider.transfer({ ...request, currency: 'GHS' })).resolves.toMatchObject({ success: false });
  });
});

describe('verifyHyparrowSignature', () => {
  const body = Buffer.from('{"event":"transfer.settled","data":{"clientReference":"2S-sess-1"}}');
  const now = 1_790_000_000;
  const sign = (ts: string, raw: Buffer) =>
    crypto.createHmac('sha256', 'whsec').update(`${ts}.${raw.toString()}`).digest('hex');

  it('accepts a fresh, correctly signed body', () => {
    expect(verifyHyparrowSignature(body, String(now), sign(String(now), body), 'whsec', now)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const tampered = Buffer.from(body.toString().replace('settled', 'reversed'));
    expect(verifyHyparrowSignature(tampered, String(now), sign(String(now), body), 'whsec', now)).toBe(false);
  });

  it('rejects a replay outside the 5 minute window', () => {
    const old = String(now - 301);
    expect(verifyHyparrowSignature(body, old, sign(old, body), 'whsec', now)).toBe(false);
  });

  it('rejects when headers or secret are missing', () => {
    expect(verifyHyparrowSignature(body, undefined, 'abc', 'whsec', now)).toBe(false);
    expect(verifyHyparrowSignature(body, String(now), sign(String(now), body), '', now)).toBe(false);
  });
});
