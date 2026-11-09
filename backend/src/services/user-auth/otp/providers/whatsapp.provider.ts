/**
 * WhatsApp OTP Provider (Meta WhatsApp Cloud API)
 *
 * Calls the Graph API directly (no BSP, no SDK): a JSON POST to
 * /{version}/{PhoneNumberId}/messages, auth'd with a System User token.
 *
 * The user hasn't messaged us first, so a free-form text isn't allowed -
 * the code goes out as an approved Authentication template. Meta fixes that
 * template's wording ("{{1}} is your verification code.") and requires a
 * Copy code / One-tap button, whose parameter is the code again.
 *
 * Setup: WhatsApp Manager -> Message templates -> category Authentication,
 * named WHATSAPP_OTP_TEMPLATE_NAME, with a Copy code button. Meta bills each
 * delivered authentication message.
 *
 * A 200 here only means Meta accepted the message. A number that isn't on
 * WhatsApp is usually still accepted and fails later (status webhook, which
 * we don't consume) - the client offers "send by SMS instead" for that.
 */

import axios from 'axios';
import config from '../../../../config';
import { OtpDeliveryProvider } from './types';

interface WhatsAppMessageResponse {
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string; message_status?: string }>;
}

interface GraphApiError {
  error?: {
    message?: string;
    code?: number;
    error_data?: { details?: string };
  };
}

export const whatsappOtpProvider: OtpDeliveryProvider = {
  channel: 'phone',

  isEnabled(): boolean {
    const { whatsapp } = config.auth;
    return (
      whatsapp.enabled &&
      !!whatsapp.phoneNumberId &&
      !!whatsapp.accessToken &&
      !!whatsapp.templateName
    );
  },

  async send(identifier: string, code: string): Promise<void> {
    const { whatsapp } = config.auth;
    // Cloud API wants the number with country code and no "+"
    const to = identifier.replace(/^\+/, '');

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: whatsapp.templateName,
        language: { code: whatsapp.templateLanguage },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: code }],
          },
        ],
      },
    };

    try {
      const { data } = await axios.post<WhatsAppMessageResponse>(
        `${whatsapp.baseUrl}/${whatsapp.graphVersion}/${whatsapp.phoneNumberId}/messages`,
        body,
        {
          headers: {
            Authorization: `Bearer ${whatsapp.accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      const messageId = data?.messages?.[0]?.id;
      if (!messageId) {
        throw new Error('WhatsApp OTP failed: no message id in response');
      }

      console.log(`[whatsapp] accepted OTP to=${to} id=${messageId}`);
    } catch (err) {
      // Graph API returns { error: { message, code, error_data } } - surface
      // it instead of axios's generic "Request failed with status code 400".
      if (axios.isAxiosError(err) && err.response?.data) {
        const { error } = err.response.data as GraphApiError;
        const detail = error?.error_data?.details || error?.message || '';
        throw new Error(`WhatsApp OTP failed: ${error?.code ?? err.response.status} ${detail}`.trim());
      }
      throw err;
    }
  },
};
