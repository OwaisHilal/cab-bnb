import "server-only";

import { OTP_CODE_LENGTH, OTP_EXPIRY_SECONDS } from "@/lib/otp/config";
import { resolveMsg91OtpSmsCredentials, sendMsg91OtpSmsWithConfig, type SendOtpSmsResult } from "./pure";
import { lookupMsg91OtpDelivery } from "./lookupOtpDelivery";
import { phoneLast4 } from "@/lib/utils/phone";

export interface SmsProvider {
  sendOtp(phoneE164: string, code: string): Promise<SendOtpSmsResult>;
}

const otpExpiryMinutes = Math.max(1, Math.round(OTP_EXPIRY_SECONDS / 60));

/**
 * MSG91 SendOTP (SMS). docs.msg91.com/otp/sendotp
 * Requires MSG91_AUTH_KEY + MSG91_OTP_TEMPLATE_ID (OTP section template id,
 * not the WhatsApp template name). We generate the code and pass it as `otp`
 * so app/api/otp/verify can keep local hash verification.
 */
export async function sendOtpSms(phoneE164: string, code: string): Promise<SendOtpSmsResult> {
  const authKeySet = Boolean(process.env.MSG91_AUTH_KEY?.trim());
  const templateId = process.env.MSG91_OTP_TEMPLATE_ID?.trim() || null;
  const last4 = phoneLast4(phoneE164);
  console.info("[otp sms] config", { authKeySet, templateId });

  const result = await sendMsg91OtpSmsWithConfig(
    phoneE164,
    code,
    resolveMsg91OtpSmsCredentials({
      MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY,
      MSG91_OTP_TEMPLATE_ID: process.env.MSG91_OTP_TEMPLATE_ID,
    }),
    { otpLength: OTP_CODE_LENGTH, otpExpiryMinutes },
  );

  console.info("[otp sms] result", {
    configured: result.configured,
    success: result.success,
    httpStatus: result.httpStatus,
    type: result.msg91Type,
    message: result.msg91Message,
    requestId: result.requestId,
    bodyKeys: result.bodyKeys,
    body: result.sanitizedBody,
  });

  const authKey = process.env.MSG91_AUTH_KEY?.trim();
  if (authKey && result.requestId) {
    try {
      const delivery = await lookupMsg91OtpDelivery({
        authKey,
        requestId: result.requestId,
        last4,
      });
      console.info("[otp sms] delivery lookup", {
        httpStatus: delivery.httpStatus,
        rowCount: delivery.rowCount,
        matchByRequestId: delivery.matchByRequestId,
        matchByLast4: delivery.matchByLast4,
        smsHttpStatus: delivery.smsHttpStatus,
        smsRowCount: delivery.smsRowCount,
        smsMatchByRequestId: delivery.smsMatchByRequestId,
        smsMatchByLast4: delivery.smsMatchByLast4,
      });
    } catch (error) {
      console.info("[otp sms] delivery lookup failed", error instanceof Error ? error.message : "unknown");
    }
  }

  return result;
}
