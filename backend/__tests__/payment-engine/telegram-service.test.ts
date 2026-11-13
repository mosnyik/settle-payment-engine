import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramService } from '../../src/services/payment-engine/settlement/telegram.service';

describe('TelegramService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const multiGroupService = () => new TelegramService({
    enabled: true,
    botToken: '123:test-token',
    chatId: ' -100111, -100222, -100111, , ',
    webhookSecret: '',
  });

  it('sends the same alert and buttons to each unique configured group', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const multi = multiGroupService();
    const keyboard = multi.manualSettlementKeyboard(session, receiver);

    expect(await multi.sendMessage('Alert', keyboard)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => JSON.parse(call[1].body))).toEqual(
      ['-100111', '-100222'].map((chatId) => ({
        chat_id: chatId, text: 'Alert', parse_mode: 'HTML', reply_markup: keyboard,
      }))
    );
  });

  it.each(['http', 'network'])('continues delivery after a %s failure', async (failure) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn();
    if (failure === 'http') {
      fetchMock.mockResolvedValueOnce({ ok: false, text: async () => 'Forbidden' });
    } else {
      fetchMock.mockRejectedValueOnce(new Error('Network unavailable'));
    }
    fetchMock.mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    expect(await multiGroupService().sendMessage('Alert')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).chat_id).toBe('-100222');
  });

  it('allows callbacks only from configured groups', () => {
    const multi = multiGroupService();
    expect(multi.isAllowedChat(-100111)).toBe(true);
    expect(multi.isAllowedChat('-100222')).toBe(true);
    expect(multi.isAllowedChat('-100333')).toBe(false);
  });

  it('preserves single-chat delivery', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    expect(await service.sendMessage('Alert')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).chat_id).toBe('456');
  });

  it('disables delivery when the list contains no chat IDs', async () => {
    const empty = new TelegramService({ enabled: true, botToken: 'token', chatId: ' , ', webhookSecret: '' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(empty.isEnabled()).toBe(false);
    expect(empty.isAllowedChat('')).toBe(false);
    expect(await empty.sendMessage('Alert')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  const service = new TelegramService({
    enabled: true,
    botToken: '123:test-token',
    chatId: '456',
    webhookSecret: '',
  });

  const session = {
    reference: 'sess<&>1',
    fiatAmount: 12500,
    fiatCurrency: 'NGN<&>',
  };

  const receiver = {
    accountNumber: '012<345&678',
    bankCode: '044',
    bankName: 'Access & Diamond <Bank>',
    accountName: 'Ada & Co <Ops>',
  };

  it('escapes dynamic values in settlement failure HTML messages', () => {
    const message = service.formatSettlementFailure(
      session,
      receiver,
      'Provider returned <invalid> & retry failed'
    );

    expect(message).toContain('sess&lt;&amp;&gt;1');
    expect(message).toContain('<b>Amount (NGN&lt;&amp;&gt;):</b> <code>12500</code>');
    expect(message).toContain('<code>012&lt;345&amp;678</code>');
    expect(message).toContain('<code>Access &amp; Diamond &lt;Bank&gt;</code>');
    expect(message).toContain('Ada &amp; Co &lt;Ops&gt;');
    expect(message).toContain('Provider returned &lt;invalid&gt; &amp; retry failed');
    expect(message).not.toContain('Provider returned <invalid> & retry failed');
  });

  it('adds a copy button per payout field with raw (unescaped) values', () => {
    const keyboard = service.manualSettlementKeyboard(session, receiver);

    expect(keyboard.inline_keyboard).toEqual([
      [
        { text: 'Copy amount', copy_text: { text: '12500' } },
        { text: 'Copy account', copy_text: { text: '012<345&678' } },
      ],
      [{ text: 'Copy bank', copy_text: { text: 'Access & Diamond <Bank>' } }],
      [{ text: 'Settlement completed', callback_data: 'settle:sess<&>1' }],
    ]);
  });

  it('falls back to bank code for the copy bank button', () => {
    const keyboard = service.manualSettlementKeyboard(session, { ...receiver, bankName: undefined });

    expect(keyboard.inline_keyboard[1]).toEqual([
      { text: 'Copy bank', copy_text: { text: '044' } },
    ]);
  });

  it('escapes dynamic values in settlement reversal HTML messages', () => {
    const message = service.formatSettlementReversal(
      session,
      'trf<&>1',
      'Bank said <reversed> & refunded'
    );

    expect(message).toContain('sess&lt;&amp;&gt;1');
    expect(message).toContain('NGN&lt;&amp;&gt; 12,500');
    expect(message).toContain('trf&lt;&amp;&gt;1');
    expect(message).toContain('Bank said &lt;reversed&gt; &amp; refunded');
  });

});
