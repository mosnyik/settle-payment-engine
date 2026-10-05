/**
 * SMS OTP Provider (Twilio Programmable Messaging)
 *
 * Calls Twilio's REST API directly (no SDK): a form-encoded POST to
 * /Accounts/{AccountSid}/Messages.json, auth'd with HTTP Basic using the
 * Account SID + Auth Token (or an API Key SID + secret - set
 * TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET to use those instead).
 *
 * We generate and verify our own OTP codes, so this uses plain Messaging,
 * not Twilio Verify. The sender is either a Messaging Service
 * (TWILIO_MESSAGING_SERVICE_SID - preferred, handles sender selection and
 * alphanumeric IDs per country) or a single Twilio number (TWILIO_FROM).
 *
 * Get credentials from the Twilio Console (Account Info on the dashboard).
 * Trial accounts can only send to verified caller IDs.
 */

import axios from 'axios';
import config from '../../../../config';
import { OtpDeliveryProvider } from './types';

interface TwilioMessageResponse {
  sid: string;
  status: string;
  error_code: number | null;
  error_message: string | null;
}

export const twilioOtpProvider: OtpDeliveryProvider = {
  channel: 'phone',

  isEnabled(): boolean {
    const { sms } = config.auth;
    const { twilio } = sms;
    return (
      sms.enabled &&
      sms.provider === 'twilio' &&
      !!twilio.accountSid &&
      (!!twilio.authToken || (!!twilio.apiKeySid && !!twilio.apiKeySecret)) &&
      (!!twilio.messagingServiceSid || !!twilio.from)
    );
  },

  async send(identifier: string, code: string): Promise<void> {
    const { sms, otp } = config.auth;
    const { twilio } = sms;
    // Twilio requires E.164 with the leading "+"; PHONE_REGEX allows it to
    // be omitted, so add it back.
    const to = identifier.startsWith('+') ? identifier : `+${identifier}`;

    const params = new URLSearchParams({
      To: to,
      Body: `Your 2Settle login code is ${code}. It expires in ${Math.round(otp.expiresInSec / 60)} minutes.`,
    });
    if (twilio.messagingServiceSid) {
      params.set('MessagingServiceSid', twilio.messagingServiceSid);
    } else {
      params.set('From', twilio.from);
    }

    const auth = twilio.apiKeySid
      ? { username: twilio.apiKeySid, password: twilio.apiKeySecret }
      : { username: twilio.accountSid, password: twilio.authToken };

    try {
      const { data } = await axios.post<TwilioMessageResponse>(
        `${twilio.baseUrl}/Accounts/${twilio.accountSid}/Messages.json`,
        params.toString(),
        {
          auth,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
        }
      );

      if (data?.error_code) {
        throw new Error(`Twilio SMS failed: ${data.error_code} ${data.error_message || ''}`.trim());
      }

      // "queued"/"accepted" only means Twilio took the message - delivery
      // status arrives later (via StatusCallback, which we don't use yet).
      console.log(`[twilio] queued OTP sms to=${to} sid=${data?.sid} status=${data?.status}`);
    } catch (err) {
      // Twilio returns 4xx with { code, message, more_info } - surface it
      // instead of axios's generic "Request failed with status code 400".
      if (axios.isAxiosError(err) && err.response?.data) {
        const { code: twilioCode, message } = err.response.data as { code?: number; message?: string };
        throw new Error(`Twilio SMS failed: ${twilioCode ?? err.response.status} ${message || ''}`.trim());
      }
      throw err;
    }
  },
};
