/**
 * Console OTP Provider
 *
 * Dev-only fallback used when a real email/SMS provider isn't configured —
 * logs the code to the server console instead of sending it, so local
 * development works with zero external setup.
 */

import { OtpChannel } from '../../types';
import { OtpDeliveryProvider } from './types';

export function createConsoleProvider(channel: OtpChannel, via?: string): OtpDeliveryProvider {
  const label = via ? `${channel} via ${via}` : channel;
  return {
    channel,
    isEnabled(): boolean {
      return true;
    },
    async send(identifier: string, code: string): Promise<void> {
      console.log(`[OTP:${label}] code for ${identifier}: ${code}`);
    },
  };
}
