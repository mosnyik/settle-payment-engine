export type { OtpDeliveryProvider } from './types';
export { emailOtpProvider } from './email.provider';
export { smsOtpProvider } from './sms.provider';
export { africasTalkingOtpProvider } from './africastalking.provider';
export { sendchampOtpProvider } from './sendchamp.provider';
export { twilioOtpProvider } from './twilio.provider';
export { whatsappOtpProvider } from './whatsapp.provider';
export { createConsoleProvider } from './console.provider';

import { OtpChannel, OtpDelivery } from '../../types';
import { OtpDeliveryProvider } from './types';
import { emailOtpProvider } from './email.provider';
import { smsOtpProvider } from './sms.provider';
import { africasTalkingOtpProvider } from './africastalking.provider';
import { sendchampOtpProvider } from './sendchamp.provider';
import { twilioOtpProvider } from './twilio.provider';
import { whatsappOtpProvider } from './whatsapp.provider';
import { createConsoleProvider } from './console.provider';

const CONSOLE_FALLBACKS: Record<OtpDelivery, OtpDeliveryProvider> = {
  email: createConsoleProvider('email'),
  sms: createConsoleProvider('phone'),
  whatsapp: createConsoleProvider('phone', 'whatsapp'),
};

// SMS has more than one real provider - checked in order, first one enabled wins.
const SMS_PROVIDERS: OtpDeliveryProvider[] = [
  africasTalkingOtpProvider,
  sendchampOtpProvider,
  twilioOtpProvider,
  smsOtpProvider,
];

/**
 * How a code for this channel is delivered. Email is always email; phone
 * defaults to SMS unless the client asked for WhatsApp.
 */
export function resolveOtpDelivery(channel: OtpChannel, via?: 'sms' | 'whatsapp'): OtpDelivery {
  return channel === 'email' ? 'email' : via || 'sms';
}

/**
 * Returns the provider for a delivery method - the real (configured/enabled)
 * provider if there is one, otherwise the console fallback (dev mode).
 */
export function getOtpProvider(delivery: OtpDelivery): OtpDeliveryProvider {
  if (delivery === 'email') {
    return emailOtpProvider.isEnabled() ? emailOtpProvider : CONSOLE_FALLBACKS.email;
  }

  if (delivery === 'whatsapp') {
    return whatsappOtpProvider.isEnabled() ? whatsappOtpProvider : CONSOLE_FALLBACKS.whatsapp;
  }

  const smsProvider = SMS_PROVIDERS.find((p) => p.isEnabled());
  return smsProvider || CONSOLE_FALLBACKS.sms;
}
