import "server-only";
import type { SendOtpChannelResult } from "@/lib/whatsapp/sendAuthTemplateOtp";

export interface SmsProvider {
  sendOtp(phoneE164: string, code: string): Promise<SendOtpChannelResult>;
}

/**
 * No SMS provider has been chosen yet (MSG91/Twilio/etc. — deferred per
 * product decision). This stub always reports `configured: false` so
 * app/api/otp/send/route.ts treats SMS as an unavailable channel rather
 * than a fake success. `SMS_PROVIDER_API_KEY` already exists as an env
 * placeholder for whichever provider gets picked.
 *
 * To wire a real provider: implement `SmsProvider` (e.g. `Msg91SmsProvider`
 * or `TwilioSmsProvider`) in this same directory and swap it in below.
 */
const unconfiguredSmsProvider: SmsProvider = {
  async sendOtp(): Promise<SendOtpChannelResult> {
    return {
      configured: false,
      success: false,
      error: "No SMS provider is configured yet",
    };
  },
};

export async function sendOtpSms(phoneE164: string, code: string): Promise<SendOtpChannelResult> {
  return unconfiguredSmsProvider.sendOtp(phoneE164, code);
}
