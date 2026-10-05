export type { OtpDeliveryProvider } from './types';
export { emailOtpProvider } from './email.provider';
export { smsOtpProvider } from './sms.provider';
export { africasTalkingOtpProvider } from './africastalking.provider';
export { sendchampOtpProvider } from './sendchamp.provider';
export { twilioOtpProvider } from './twilio.provider';
export { createConsoleProvider } from './console.provider';

import { OtpChannel } from '../../types';
import { OtpDeliveryProvider } from './types';
import { emailOtpProvider } from './email.provider';
import { smsOtpProvider } from './sms.provider';
import { africasTalkingOtpProvider } from './africastalking.provider';
import { sendchampOtpProvider } from './sendchamp.provider';
import { twilioOtpProvider } from './twilio.provider';
import { createConsoleProvider } from './console.provider';

const CONSOLE_FALLBACKS: Record<OtpChannel, OtpDeliveryProvider> = {
  email: createConsoleProvider('email'),
  phone: createConsoleProvider('phone'),
};

// SMS has more than one real provider - checked in order, first one enabled wins.
const SMS_PROVIDERS: OtpDeliveryProvider[] = [
  africasTalkingOtpProvider,
  sendchampOtpProvider,
  twilioOtpProvider,
  smsOtpProvider,
];

/**
 * Returns the provider to use for a channel - the real (configured/enabled)
 * provider if there is one, otherwise the console fallback (dev mode).
 */
export function getOtpProvider(channel: OtpChannel): OtpDeliveryProvider {
  if (channel === 'email') {
    return emailOtpProvider.isEnabled() ? emailOtpProvider : CONSOLE_FALLBACKS.email;
  }

  const smsProvider = SMS_PROVIDERS.find((p) => p.isEnabled());
  return smsProvider || CONSOLE_FALLBACKS.phone;
}
