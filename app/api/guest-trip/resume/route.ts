import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";
import { findCurrentGuestTrip, rememberGuestSession } from "@/lib/guest-trip/findCurrentGuestTrip";
import { loadGuestTrip } from "@/lib/guest-trip/loadGuestTrip";
import { OTP_CODE_LENGTH, OTP_MAX_ATTEMPTS } from "@/lib/otp/config";
import { verifyOtpCode } from "@/lib/otp/hashOtpCode";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const resumeSchema = z.object({
  session_id: z.string().min(1),
  phone_e164: z.string().min(1),
  otp_code: z.string().length(OTP_CODE_LENGTH).regex(/^\d+$/, "otp_code must be numeric"),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = resumeSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const { session_id, phone_e164, otp_code } = parsed.data;

  let supabase;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Supabase is not configured");
  }

  const { data: otpRow, error: otpFetchError } = await supabase
    .from("otp_verifications")
    .select("id, otp_code_hash, attempts")
    .eq("session_id", session_id)
    .eq("phone_e164", phone_e164)
    .eq("verified", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (otpFetchError) return jsonError(500, `Failed to fetch OTP: ${otpFetchError.message}`);
  if (!otpRow) return jsonError(404, "No pending OTP found for this phone number and session. Request a new one.");
  if (otpRow.attempts >= OTP_MAX_ATTEMPTS) return jsonError(429, "Too many incorrect attempts. Request a new OTP.");

  const isMatch = await verifyOtpCode(otp_code, otpRow.otp_code_hash);
  if (!isMatch) {
    const { error: attemptsUpdateError } = await supabase
      .from("otp_verifications")
      .update({ attempts: otpRow.attempts + 1 })
      .eq("id", otpRow.id);
    if (attemptsUpdateError) return jsonError(500, `Failed to record OTP attempt: ${attemptsUpdateError.message}`);
    return jsonError(400, "Incorrect OTP");
  }

  const { error: otpVerifiedUpdateError } = await supabase
    .from("otp_verifications")
    .update({ verified: true })
    .eq("id", otpRow.id);

  if (otpVerifiedUpdateError) return jsonError(500, `Failed to mark OTP verified: ${otpVerifiedUpdateError.message}`);

  const { data: tourist, error: touristError } = await supabase
    .from("tourists")
    .select("id")
    .eq("phone_e164", phone_e164)
    .maybeSingle();

  if (touristError) return jsonError(500, `Failed to fetch tourist: ${touristError.message}`);
  if (!tourist?.id) return jsonError(404, "No trip for this phone");

  try {
    const current = await findCurrentGuestTrip(supabase, tourist.id as string);
    if (!current) return jsonError(404, "No trip for this phone");
    await rememberGuestSession(supabase, session_id, current.id);
    const snapshot = await loadGuestTrip(supabase, { sessionId: session_id, confirming: null });
    if (!snapshot) return jsonError(404, "No trip for this phone");
    return jsonOk(snapshot);
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Failed to resume trip");
  }
}
