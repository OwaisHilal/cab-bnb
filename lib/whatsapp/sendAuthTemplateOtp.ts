import "server-only";

import {
  buildMsg91AuthOtpComponents,
  resolveMsg91OtpTemplateConfig,
  sendMsg91TemplateMessage,
} from "@/lib/msg91";

export interface SendOtpChannelResult {
  configured: boolean;
  success: boolean;
  error?: string;
}

/**
 * MSG91 WhatsApp authentication-template send (Checklist 2.3, Plan §5
 * step 4). Returns a result object instead of throwing on missing config,
 * so app/api/otp/send/route.ts can offer Phone.Email when prefer=whatsapp fails.
 *
 * Components follow MSG91 OTP docs: `body_1` + `button_1` (copy-code URL
 * subtype). Template name/language fall back to `otp_verification` /
 * `en_US` when env is blank — that is a documented default, not a Green
 * approval claim. Namespace is omitted when `MSG91_OTP_TEMPLATE_NAMESPACE`
 * is empty rather than invented.
 *
 * There is no Meta Graph fallback. Missing MSG91 credentials return
 * `{ configured: false }` so the OTP route can offer Phone.Email.
 */
export async function sendWhatsAppOtp(phoneE164: string, code: string): Promise<SendOtpChannelResult> {
  const template = resolveMsg91OtpTemplateConfig({
    MSG91_OTP_TEMPLATE_NAME: process.env.MSG91_OTP_TEMPLATE_NAME,
    MSG91_OTP_TEMPLATE_NAMESPACE: process.env.MSG91_OTP_TEMPLATE_NAMESPACE,
    MSG91_OTP_TEMPLATE_LANGUAGE: process.env.MSG91_OTP_TEMPLATE_LANGUAGE,
  });

  const result = await sendMsg91TemplateMessage({
    toE164: phoneE164,
    templateName: template.templateName,
    languageCode: template.languageCode,
    namespace: template.namespace,
    components: buildMsg91AuthOtpComponents(code),
  });

  console.info("[otp wa] result", {
    configured: result.configured,
    success: result.success,
    error: result.error,
    templateName: template.templateName,
  });

  return {
    configured: result.configured,
    success: result.success,
    error: result.error,
  };
}
