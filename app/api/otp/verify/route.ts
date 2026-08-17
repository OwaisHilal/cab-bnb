import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { jsonError, jsonOk, jsonValidationError } from "@/lib/api/errors";
import { OTP_CODE_LENGTH, OTP_MAX_ATTEMPTS } from "@/lib/otp/config";
import { verifyOtpCode } from "@/lib/otp/hashOtpCode";
import { completePhoneVerification } from "@/lib/otp/completePhoneVerification";
import { phoneLast4 } from "@/lib/utils/phone";

const otpVerifySchema = z.object({
  session_id: z.string().min(1),
  phone_e164: z.string().min(1),
  otp_code: z.string().length(OTP_CODE_LENGTH).regex(/^\d+$/, "otp_code must be numeric"),
  // Checklist 2.4's body spec omits this, but Plan §5 step 5 needs to know
  // which trip_request to link tourist_id on — see the plan's documented
  // assumption. The frontend already has this from the 2.1 response.
  trip_request_id: z.string().uuid(),
});

/**
 * Checklist 2.4: verify OTP, upsert tourist, link trip_request, enqueue
 * send_quotes job (Plan §5 step 5). No inline WhatsApp send here — the
 * job_queue row is picked up by a worker in a later increment (Checklist
 * 2.8 / 3.10).
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  const parsed = otpVerifySchema.safeParse(body);
  if (!parsed.success) {
    return jsonValidationError(parsed.error);
  }

  const { session_id, phone_e164, otp_code, trip_request_id } = parsed.data;
  console.info("[otp verify] start", { last4: phoneLast4(phone_e164) });

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

  if (otpFetchError) {
    console.info("[otp verify] fetch fail");
    return jsonError(500, `Failed to fetch OTP: ${otpFetchError.message}`);
  }
  if (!otpRow) {
    console.info("[otp verify] no pending otp");
    return jsonError(404, "No pending OTP found for this phone number and session. Request a new one.");
  }
  if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
    console.info("[otp verify] too many attempts");
    return jsonError(429, "Too many incorrect attempts. Request a new OTP.");
  }

  const isMatch = await verifyOtpCode(otp_code, otpRow.otp_code_hash);

  if (!isMatch) {
    const { error: attemptsUpdateError } = await supabase
      .from("otp_verifications")
      .update({ attempts: otpRow.attempts + 1 })
      .eq("id", otpRow.id);

    if (attemptsUpdateError) {
      return jsonError(500, `Failed to record OTP attempt: ${attemptsUpdateError.message}`);
    }

    console.info("[otp verify] incorrect");
    return jsonError(400, "Incorrect OTP");
  }

  // Run the shared linking/enqueue step before marking the OTP row verified:
  // if this fails (e.g. session/trip_request mismatch), the code itself is
  // still untouched and the tourist can retry with the same OTP.
  const completionResult = await completePhoneVerification({
    supabase,
    sessionId: session_id,
    phoneE164: phone_e164,
    tripRequestId: trip_request_id,
    verifiedBy: "otp_code",
  });

  if (!completionResult.ok) {
    console.info("[otp verify] completion failed", completionResult.status);
    return jsonError(completionResult.status, completionResult.message);
  }

  const { error: otpVerifiedUpdateError } = await supabase
    .from("otp_verifications")
    .update({ verified: true })
    .eq("id", otpRow.id);

  if (otpVerifiedUpdateError) {
    return jsonError(500, `Failed to mark OTP verified: ${otpVerifiedUpdateError.message}`);
  }

  console.info("[otp verify] ok");
  return jsonOk({ verified: true, trip_request_id });
}
