import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";
import { OTP_EXPIRY_SECONDS } from "@/lib/otp/config";
import { checkOtpRateLimit, RateLimitError } from "@/lib/otp/checkOtpRateLimit";
import { generateOtpCode } from "@/lib/otp/generateOtpCode";
import { hashOtpCode } from "@/lib/otp/hashOtpCode";
import { sendWhatsAppOtp } from "@/lib/whatsapp/sendAuthTemplateOtp";
import { sendOtpSms } from "@/lib/sms/sendOtpSms";
import { phoneLast4 } from "@/lib/utils/phone";

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

const otpSendSchema = z.object({
  session_id: z.string().min(1),
  phone_e164: z.string().regex(E164_REGEX, "phone_e164 must be in E.164 format, e.g. +919876543210"),
  prefer: z.enum(["whatsapp"]).optional(),
});

/**
 * OTP send: MSG91 SMS SendOTP first; Phone.Email if SMS fails.
 * WhatsApp template OTP only when prefer=whatsapp (explicit UI retry).
 * Hash is stored only after a channel accepts the send.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = otpSendSchema.safeParse(body);
  if (!parsed.success) {
    return jsonValidationError(parsed.error);
  }

  const { session_id, phone_e164, prefer } = parsed.data;
  console.info("[otp send] parsed", { last4: phoneLast4(phone_e164), prefer: prefer ?? "sms" });

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  try {
    await checkOtpRateLimit(supabase, phone_e164);
    console.info("[otp send] rate-limit ok");
  } catch (error) {
    if (error instanceof RateLimitError) {
      console.info("[otp send] rate-limit 429");
      return jsonError(429, error.message);
    }
    return jsonError(500, error instanceof Error ? error.message : "Rate limit check failed");
  }

  const code = generateOtpCode();
  let channel: "whatsapp" | "sms" | null = null;

  if (prefer === "whatsapp") {
    console.info("[otp send] branch", "whatsapp");
    const whatsappResult = await sendWhatsAppOtp(phone_e164, code);
    console.info("[otp send] MSG91 WhatsApp", {
      configured: whatsappResult.configured,
      success: whatsappResult.success,
      error: whatsappResult.error,
    });
    if (whatsappResult.configured && whatsappResult.success) {
      channel = "whatsapp";
    }
  } else {
    console.info("[otp send] branch", "sms");
    const smsResult = await sendOtpSms(phone_e164, code);
    console.info("[otp send] MSG91 SMS", {
      configured: smsResult.configured,
      success: smsResult.success,
      httpStatus: smsResult.httpStatus,
      type: smsResult.msg91Type,
      message: smsResult.msg91Message,
      requestId: smsResult.requestId,
      bodyKeys: smsResult.bodyKeys,
      body: smsResult.sanitizedBody,
    });
    if (smsResult.configured && smsResult.success) {
      channel = "sms";
    }
  }

  if (!channel) {
    const message =
      prefer === "whatsapp"
        ? "WhatsApp verification is unavailable. Verify securely with Phone.Email instead."
        : "SMS verification is unavailable. Verify securely with Phone.Email instead.";
    const payload = {
      sent: false,
      channel: null,
      fallback: "phone_email" as const,
      message,
    };
    console.info("[otp send] response", payload);
    return jsonOk(payload);
  }

  const otpCodeHash = await hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000).toISOString();

  const { error: insertError } = await supabase.from("otp_verifications").insert({
    session_id,
    phone_e164,
    otp_code_hash: otpCodeHash,
    channel,
    expires_at: expiresAt,
  });

  if (insertError) {
    console.info("[otp send] hash insert fail", insertError.message);
    return jsonError(500, `Failed to store OTP: ${insertError.message}`);
  }

  console.info("[otp send] hash insert ok");
  const payload = { sent: true, channel };
  console.info("[otp send] response", payload);
  return jsonOk(payload);
}
