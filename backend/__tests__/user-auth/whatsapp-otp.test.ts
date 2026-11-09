import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/lib/mysql', () => ({ default: { query }, pool: { query } }));

import config from '../../src/config';
import { whatsappOtpProvider } from '../../src/services/user-auth/otp/providers/whatsapp.provider';
import { getOtpProvider, resolveOtpDelivery } from '../../src/services/user-auth/otp/providers';
import { canBypassCooldown, requestOtp } from '../../src/services/user-auth/services/otp.service';
import { OtpRateLimitedError } from '../../src/services/user-auth/errors';
import { otpRequestSchema } from '../../src/validation/user-auth.schemas';

const whatsappConfig = {
  enabled: true,
  phoneNumberId: '1234567890',
  accessToken: 'EAAG-test',
  templateName: 'login_code',
  templateLanguage: 'en',
  graphVersion: 'v21.0',
  baseUrl: 'https://graph.facebook.test',
};

let originalWhatsapp: typeof config.auth.whatsapp;
let originalSmsEnabled: boolean;

beforeEach(() => {
  originalWhatsapp = { ...config.auth.whatsapp };
  originalSmsEnabled = config.auth.sms.enabled;
  Object.assign(config.auth.whatsapp, whatsappConfig);
  // config loads the real .env - never let a test reach a live SMS provider
  config.auth.sms.enabled = false;
  vi.spyOn(axios, 'post').mockRejectedValue(new Error('Unexpected network call in test'));
});

afterEach(() => {
  Object.assign(config.auth.whatsapp, originalWhatsapp);
  config.auth.sms.enabled = originalSmsEnabled;
  vi.restoreAllMocks();
  query.mockReset();
});

describe('whatsappOtpProvider', () => {
  it('is disabled unless enabled and fully configured', () => {
    expect(whatsappOtpProvider.isEnabled()).toBe(true);
    config.auth.whatsapp.accessToken = '';
    expect(whatsappOtpProvider.isEnabled()).toBe(false);
    config.auth.whatsapp.accessToken = 'EAAG-test';
    config.auth.whatsapp.enabled = false;
    expect(whatsappOtpProvider.isEnabled()).toBe(false);
  });

  it('sends the authentication template with the code in body and copy-code button', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { messages: [{ id: 'wamid.ABC' }] },
    });

    await whatsappOtpProvider.send('+2348012345678', '482913');

    const [url, body, options] = post.mock.calls[0] as [string, any, any];
    expect(url).toBe('https://graph.facebook.test/v21.0/1234567890/messages');
    expect(options.headers.Authorization).toBe('Bearer EAAG-test');
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '2348012345678',
      type: 'template',
      template: { name: 'login_code', language: { code: 'en' } },
    });
    expect(body.template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: '482913' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '482913' }] },
    ]);
  });

  it('surfaces the Graph API error instead of the generic axios message', async () => {
    const err = Object.assign(new Error('Request failed with status code 400'), {
      isAxiosError: true,
      response: {
        status: 400,
        data: { error: { code: 132001, message: '(#132001) Template name does not exist in the translation', error_data: { details: 'template name (login_code) does not exist in en' } } },
      },
    });
    vi.spyOn(axios, 'post').mockRejectedValue(err);
    vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    await expect(whatsappOtpProvider.send('2348012345678', '111111')).rejects.toThrow(
      'WhatsApp OTP failed: 132001 template name (login_code) does not exist in en'
    );
  });

  it('fails when Meta returns no message id', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    await expect(whatsappOtpProvider.send('2348012345678', '111111')).rejects.toThrow('no message id');
  });
});

describe('delivery routing', () => {
  it('resolves delivery from channel + via', () => {
    expect(resolveOtpDelivery('email')).toBe('email');
    expect(resolveOtpDelivery('phone')).toBe('sms');
    expect(resolveOtpDelivery('phone', 'whatsapp')).toBe('whatsapp');
  });

  it('uses the WhatsApp provider when enabled, console fallback otherwise', () => {
    expect(getOtpProvider('whatsapp')).toBe(whatsappOtpProvider);
    config.auth.whatsapp.enabled = false;
    expect(getOtpProvider('whatsapp')).not.toBe(whatsappOtpProvider);
  });
});

describe('otpRequestSchema', () => {
  it('accepts via for phone', () => {
    expect(otpRequestSchema.parse({ channel: 'phone', identifier: '+2348012345678', via: 'whatsapp' }).via).toBe('whatsapp');
  });

  it('rejects via for email', () => {
    expect(() => otpRequestSchema.parse({ channel: 'email', identifier: 'a@b.com', via: 'whatsapp' })).toThrow();
  });
});

describe('resend cooldown', () => {
  it('only lets WhatsApp fall back to SMS', () => {
    expect(canBypassCooldown('whatsapp', 'sms')).toBe(true);
    expect(canBypassCooldown('sms', 'whatsapp')).toBe(false);
    expect(canBypassCooldown('sms', 'sms')).toBe(false);
    expect(canBypassCooldown('whatsapp', 'whatsapp')).toBe(false);
    expect(canBypassCooldown(null, 'sms')).toBe(false);
  });

  const recentRow = (delivery_method: string | null) => [[{ id: 1, delivery_method, created_at: new Date() }]];

  it('sends an SMS straight after a WhatsApp code and records the delivery method', async () => {
    query.mockResolvedValueOnce(recentRow('whatsapp')).mockResolvedValueOnce([{}]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await requestOtp('phone', '+2348012345678', '1.2.3.4', 'sms');

    expect(result.delivery).toBe('sms');
    expect(axios.post).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toMatch(/^\[OTP:phone\] code for \+2348012345678/);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('delivery_method');
    expect(params[1]).toBe('sms');
  });

  it('still blocks a second WhatsApp code inside the cooldown', async () => {
    query.mockResolvedValueOnce(recentRow('whatsapp'));
    await expect(requestOtp('phone', '+2348012345678', undefined, 'whatsapp')).rejects.toBeInstanceOf(OtpRateLimitedError);
    expect(query).toHaveBeenCalledTimes(1);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('sends via WhatsApp when requested', async () => {
    query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([{}]);
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { messages: [{ id: 'wamid.X' }] } });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await requestOtp('phone', '+2348012345678', undefined, 'whatsapp');

    expect(result.delivery).toBe('whatsapp');
    expect(post).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[1][1][1]).toBe('whatsapp');
  });
});
