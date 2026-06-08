import { describe, expect, it, vi } from 'vitest';
import { TelegramService } from '../../src/services/payment-engine/settlement/telegram.service';

describe('TelegramService', () => {
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
    expect(message).toContain('NGN&lt;&amp;&gt; 12,500');
    expect(message).toContain('012&lt;345&amp;678');
    expect(message).toContain('Access &amp; Diamond &lt;Bank&gt;');
    expect(message).toContain('Ada &amp; Co &lt;Ops&gt;');
    expect(message).toContain('Provider returned &lt;invalid&gt; &amp; retry failed');
    expect(message).not.toContain('Provider returned <invalid> & retry failed');
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
