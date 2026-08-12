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

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

const otpSendSchema = z.object({
  session_id: z.string().min(1),
  phone_e164: z.string().regex(E164_REGEX, "phone_e164 must be in E.164 format, e.g. +919876543210"),
});

/**
 * Checklist 2.3: rate-limit, generate + hash OTP, send via WhatsApp auth
 * template with SMS fallback. The otp_verifications row is only inserted
 * once a channel actually accepts the send — an OTP nobody received isn't
 * useful to store, and it keeps rate-limit counts meaningful.
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

  const { session_id, phone_e164 } = parsed.data;

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  try {
    await checkOtpRateLimit(supabase, phone_e164);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return jsonError(429, error.message);
    }
    return jsonError(500, error instanceof Error ? error.message : "Rate limit check failed");
  }

  const code = generateOtpCode();

  const whatsappResult = await sendWhatsAppOtp(phone_e164, code);
  let channel: "whatsapp" | "sms" | null = null;

  if (whatsappResult.configured && whatsappResult.success) {
    channel = "whatsapp";
  } else {
    const smsResult = await sendOtpSms(phone_e164, code);
    if (smsResult.configured && smsResult.success) {
      channel = "sms";
    }
  }

  if (!channel) {
    // WhatsApp and SMS are both unavailable — surface a controlled fallback
    // signal (Plan §2) instead of a dead-end error, so the UI can offer
    // Phone.Email verification instead of the OTP code-entry step. No
    // otp_verifications row is written here since no code was delivered.
    return jsonOk({
      sent: false,
      channel: null,
      fallback: "phone_email" as const,
      message: "WhatsApp verification is unavailable. Verify securely with Phone.Email instead.",
    });
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
    return jsonError(500, `Failed to store OTP: ${insertError.message}`);
  }

  return jsonOk({ sent: true, channel });
}
